import { build, stop } from 'esbuild'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { cpus, arch, platform, release, totalmem } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = dirname(fileURLToPath(import.meta.url))
const root = resolve(directory, '../..')
const artifacts = resolve(root, '.artifacts/benchmarks')
await mkdir(artifacts, { recursive: true })
const bundle = resolve(artifacts, 'form-comparison-browser.js')
await build({
  entryPoints: [resolve(directory, 'client.jsx')],
  bundle: true,
  minify: true,
  outfile: bundle,
  platform: 'browser',
  format: 'esm',
  target: 'chrome130',
  jsx: 'automatic',
  jsxImportSource: 'react',
  tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'react' } },
  define: { 'process.env.NODE_ENV': '"production"' },
})
stop()
const versions = {}
for (const name of ['react', 'react-dom', 'react-hook-form', 'formik', 'esbuild'])
  versions[name] = JSON.parse(
    await readFile(resolve(directory, `node_modules/${name}/package.json`), 'utf8'),
  ).version
versions['ketjs-view'] = JSON.parse(
  await readFile(resolve(root, 'packages/ketjs-view/package.json'), 'utf8'),
).version
const digest = async (paths) => {
  const hash = createHash('sha256')
  for (const path of paths) {
    hash.update(path)
    hash.update(await readFile(resolve(root, path)))
  }
  return hash.digest('hex')
}
const runtimeFiles = ['form-session', 'form-dom', 'form', 'signal'].map(
  (name) => `packages/ketjs-view/dist/${name}.js`,
)
const metadata = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  runtimeDigest: await digest(runtimeFiles),
  harnessDigest: await digest([
    'bench/form-comparison/client.jsx',
    'bench/form-comparison/adapters.jsx',
    'bench/form-comparison/workload.mjs',
    'bench/form-comparison/trace.mjs',
  ]),
  versions,
  node: process.version,
  os: `${platform()} ${release()}`,
  arch: arch(),
  cpu: cpus()[0]?.model,
  memoryGiB: totalmem() / 2 ** 30,
}
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Form performance comparison</title>
<style>body{font:14px system-ui;margin:24px}button{font:inherit;padding:8px 12px}table{border-collapse:collapse;margin:20px 0}td,th{padding:6px;border:1px solid #ccc;text-align:right}td:first-child,td:nth-child(2){text-align:left}#fixture{height:300px;overflow:auto;border:1px solid #999;padding:8px}label{display:flex;gap:10px;margin:4px}label span{color:#b00}output{min-width:100px}input{width:140px}</style>
<h1>Form performance comparison</h1><p>Production bundles; shared validation schema; synthetic single-field edits. Timings exclude layout, paint, HTTP and database work. Counts come from separate diagnostic mounts.</p>
<button id="run" type="button">Run benchmark</button><p id="progress" role="status">Ready</p>
<table><thead><tr><th>Workload</th><th>Library</th><th>Edit p50 ms</th><th>Edit p95 ms</th><th>Invalid p50 ms</th><th>Submit p50 ms</th><th>Field renders</th><th>Unedited renders</th><th>Value writes</th><th>DOM records</th></tr></thead><tbody id="results"></tbody></table>
<div id="fixture" aria-label="Current benchmark form"></div>
<script>window.benchmarkMetadata=${JSON.stringify(metadata).replaceAll('<', '\\u003c')}</script><script type="module" src="/browser.js"></script></html>`
const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(html)
    } else if (request.method === 'GET' && request.url === '/browser.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' })
      response.end(await readFile(bundle))
    } else if (request.method === 'POST' && request.url === '/results') {
      const chunks = []
      let size = 0
      for await (const chunk of request) {
        size += chunk.length
        if (size > 2 ** 21) {
          response.writeHead(413)
          response.end()
          return
        }
        chunks.push(chunk)
      }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (result.status !== 'passed' || result.results?.length !== 18 || !result.correctnessChecks)
        throw new Error('incomplete benchmark result')
      const name = `form-comparison-${result.startedAt.replaceAll(/[^a-zA-Z0-9]/g, '-')}.json`
      const text = `${JSON.stringify(result, null, 2)}\n`
      await writeFile(resolve(artifacts, name), text)
      await writeFile(resolve(artifacts, 'form-comparison-latest.json'), text)
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ path: `.artifacts/benchmarks/${name}` }))
      console.log(`Saved ${name}: ${result.correctnessChecks} checks`)
    } else {
      response.writeHead(404)
      response.end()
    }
  } catch (error) {
    console.error(error.message)
    response.writeHead(500)
    response.end(error.message)
  }
})
server.listen(Number(process.env.FORM_BENCH_PORT ?? 39751), '127.0.0.1', () => {
  console.log(`Form benchmark: http://127.0.0.1:${server.address().port}/ (pid ${process.pid})`)
})
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)))
