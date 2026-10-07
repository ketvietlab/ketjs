// A local interactive benchmark page. Browser controls trigger the public View runtime.
import { build } from 'esbuild'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const output = mkdtempSync(join(tmpdir(), 'ketjs-browser-bench-'))
await build({
  entryPoints: ['bench/browser-view.tsx'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  outfile: join(output, 'app.js'),
})
const server = createServer((req, res) => {
  if (req.url === '/app.js') {
    res.setHeader('Content-Type', 'text/javascript')
    res.end(readFileSync(join(output, 'app.js')))
    return
  }
  if (req.url !== '/') {
    res.writeHead(404)
    res.end()
    return
  }
  res.setHeader('Content-Type', 'text/html')
  res.end(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ketjs-view browser benchmark</title></head><body><script type="module" src="/app.js"></script></body></html>',
  )
})
server.listen(3701, '127.0.0.1', () => console.log('Browser benchmark: http://127.0.0.1:3701/'))
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(() => {
      rmSync(output, { recursive: true, force: true })
      process.exit()
    }),
  )
