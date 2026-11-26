import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { test } from 'node:test'
import { createIslandCompiler } from '../packages/ketjs-view-tools/src/island-build.ts'

test('the island compiler invalidates only graphs that read a changed source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ket-dev-island-graph-'))
  const compiler = await createIslandCompiler(root, {
    islands: { counter: { entry: 'counter.ts' }, note: { entry: 'note.ts' } },
  })
  try {
    await writeFile(join(root, 'counter.ts'), 'export { count as default } from "./shared"')
    await writeFile(join(root, 'note.ts'), 'export default "note"')
    await writeFile(join(root, 'shared.ts'), 'export const count = 1')
    assert.deepEqual([...(await compiler.build(new Set())).keys()], ['counter', 'note'])
    await writeFile(join(root, 'shared.ts'), 'export const count = 2')
    assert.deepEqual([...(await compiler.build(new Set([join(root, 'shared.ts')]))).keys()], ['counter'])
    assert.equal((await compiler.build(new Set([join(root, 'server.ts')]))).size, 0)
    assert.deepEqual([...(await compiler.build(new Set(), true)).keys()], ['counter', 'note'])
  } finally {
    await compiler.close()
    await rm(root, { force: true, recursive: true })
  }
})

test('npm run dev in a scaffold rebuilds one browser island and keeps the server running', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ket-native-dev-'))
  t.after(() => rm(root, { force: true, recursive: true }))
  const packages = resolve('packages')
  const cli = join(packages, 'ketjs/dist/cli.js')
  const scaffold = spawn(process.execPath, [cli, 'new', 'shop', '--dir', root], { stdio: 'ignore' })
  const [scaffoldStatus] = await once(scaffold, 'exit')
  assert.equal(scaffoldStatus, 0)

  const modules = join(root, 'node_modules')
  const link = async (name: string, from: string) => {
    const to = join(modules, name)
    await mkdir(dirname(to), { recursive: true })
    await symlink(from, to)
  }
  await link('@ketvietlab/ketjs', join(packages, 'ketjs'))
  await link('@ketvietlab/ketjs-view', join(packages, 'ketjs-view'))
  await link('@ketvietlab/ketjs-view-tools', join(packages, 'ketjs-view-tools'))
  for (const name of ['typescript', 'tsx', '@types/node']) await link(name, resolve('node_modules', name))
  await link('.bin/ket', cli)
  assert.match(await readFile(join(root, 'package.json'), 'utf8'), /ket dev --source/)

  await mkdir(join(root, 'modules', 'browser'))
  await mkdir(join(root, 'modules', 'assets'))
  const client = (text: string) => 'export default () => () => <div>' + text + '</div>'
  const counter = join(root, 'modules/browser/counter.tsx')
  await writeFile(counter, client('initial counter'))
  await writeFile(join(root, 'modules/browser/note.tsx'), client('initial note'))
  await writeFile(
    join(root, 'ket.dev.json'),
    JSON.stringify({
      islands: {
        counter: { entry: 'modules/browser/counter.tsx', output: 'modules/assets/counter.mjs' },
        note: { entry: 'modules/browser/note.tsx', output: 'modules/assets/note.mjs' },
      },
      browserOnly: ['modules/browser'],
    }),
  )
  await writeFile(
    join(root, 'ket.workspace.ts'),
    [
      'import { defineDeployment, defineModule, json, page } from "@ketvietlab/ketjs"',
      'import { html, renderIsland, trustedMarkup } from "@ketvietlab/ketjs-view"',
      'const counter = () => () => html`<div>initial counter</div>`',
      'const note = () => () => html`<div>initial note</div>`',
      'const module = defineModule({ name: "shop", assets: new URL("./modules/assets/", import.meta.url),',
      '  islands: { counter: { view: counter, client: "counter.mjs" }, note: { view: note, client: "note.mjs" } } })',
      'export const deployment = defineDeployment({ name: "shop", modules: [module], headless: true,',
      '  serve: { routes: () => ({',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Interpolation belongs to the generated workspace.
      '    "/": async () => page({ body: html`<main>${trustedMarkup(renderIsland("counter", counter, {}))}${trustedMarkup(renderIsland("note", note, {}))}</main>` }),',
      '    "/probe": async () => json({ pid: process.pid, round: 1 }),',
      '  }) } })',
      'export const deployments = [deployment]',
    ].join('\n'),
  )

  const socket = createServer().listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const address = socket.address()
  assert.ok(address && typeof address !== 'string')
  await new Promise<void>((done) => socket.close(() => done()))
  const base = `http://127.0.0.1:${address.port}`
  const dev = spawn('npm', ['run', 'dev', '--', '--port', String(address.port)], {
    cwd: root,
    detached: process.platform !== 'win32',
    env: { ...process.env, HOST: '127.0.0.1' },
  })
  let logs = ''
  for (const stream of [dev.stdout, dev.stderr])
    stream?.on('data', (chunk) => {
      logs += String(chunk)
    })
  const stopped = once(dev, 'exit')
  const wait = async <T>(probe: () => Promise<T | undefined>): Promise<T> => {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const result = await probe().catch(() => undefined)
      if (result !== undefined) return result
      await setTimeout(50)
    }
    throw new Error(logs)
  }
  type Snapshot = { runtime: string; islands: { counter: string; note: string } }
  const manifest = '/_ket/dev/islands/manifest.json'
  const snapshot = async () => (await (await fetch(base + manifest)).json()) as Snapshot
  const runtime = async () => (await (await fetch(base + '/probe')).json()) as { pid: number; round: number }
  try {
    const before = await wait(snapshot)
    const original = await runtime()
    assert.match(await (await fetch(base)).text(), /initial counter/u)
    assert.match(await (await fetch(base + '/_ket/islands.js')).text(), /refreshDevIslands/u)
    await writeFile(counter, 'const broken: number = "invalid"; ' + client('broken counter'))
    await wait(async () => logs.includes('TS2322') || undefined)
    assert.deepEqual(await snapshot(), before)
    assert.equal((await runtime()).pid, original.pid)
    await writeFile(counter, client('updated counter'))
    const after = await wait(async () => {
      const value = await snapshot()
      return value.islands.counter === before.islands.counter ? undefined : value
    })
    assert.equal(after.runtime, before.runtime)
    assert.equal(after.islands.note, before.islands.note)
    assert.equal((await runtime()).pid, original.pid)
    assert.match(logs, /\[ket dev\] built islands: counter\r?\n/u)
    const bundle = await fetch(base + '/_ket/dev/islands/' + after.islands.counter + '.mjs')
    assert.match(await bundle.text(), /updated counter/u)
    assert.equal((await fetch(base + '/_ket/dev/islands/not-a-bundle.mjs')).status, 404)

    const workspace = join(root, 'ket.workspace.ts')
    await writeFile(workspace, (await readFile(workspace, 'utf8')).replace('round: 1', 'round: 2'))
    const restarted = await wait(async () => {
      const value = await runtime()
      return value.round === 2 ? value : undefined
    })
    assert.notEqual(restarted.pid, original.pid)
    assert.notEqual((await snapshot()).runtime, before.runtime)
  } finally {
    if (dev.pid && dev.exitCode === null && dev.signalCode === null) {
      if (process.platform === 'win32') dev.kill()
      else process.kill(-dev.pid, 'SIGTERM')
    }
    await stopped
  }
})
