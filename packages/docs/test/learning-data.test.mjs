import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { setTimeout as delay } from 'node:timers/promises'
import { buildSync } from 'esbuild'

test('the learning island owns requests, rejects stale responses and stops on disposal', async () => {
  const requests = []
  const context = {
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: (url, options) => new Promise((resolve) => requests.push({ url, ...options, resolve })),
  }
  const code = buildSync({
    stdin: {
      contents: `import factory from './tutorials/view/src/islands/task-search.tsx'; import * as view from './tutorials/view/node_modules/@ketvietlab/ketjs-view/dist/index.js'; export { factory, view };`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'iife',
    globalName: 'Lab',
    write: false,
    platform: 'browser',
    jsx: 'automatic',
    jsxImportSource: '@ketvietlab/ketjs-view',
  }).outputFiles[0].text
  runInNewContext(code, context)
  const { factory, view } = context.Lab
  const host = view.countingHost(),
    root = host.root()
  const island = factory({ endpoint: '/data/todos.json' })
  const mounted = view.mount(host, root, island.view)
  assert.equal(requests.length, 0, 'server/initial rendering must not fetch')
  const lifetime = new AbortController()
  island.mount({ root, lifetime: lifetime.signal })
  await delay(280)
  const find = (node, tag) =>
    node.tag === tag ? node : node.children?.map((child) => find(child, tag)).find(Boolean)
  host.fire(find(root, 'input'), 'input', { target: { value: 'Learn' } })
  assert.equal(requests[0].signal.aborted, true)
  await delay(280)
  requests[1].resolve({
    ok: true,
    json: async () => [{ id: 'new', title: 'Learn current data', done: false }],
  })
  await delay(0)
  requests[0].resolve({ ok: true, json: async () => [{ id: 'old', title: 'Obsolete data', done: false }] })
  await delay(0)
  assert.match(host.html(root), /Learn current data/)
  assert.doesNotMatch(host.html(root), /Obsolete data/)
  host.fire(find(root, 'button'), 'click', {})
  await delay(280)
  requests[2].resolve({ ok: false, status: 503 })
  await delay(0)
  assert.match(host.html(root), /Could not load tasks \(503\)/)
  host.fire(find(root, 'button'), 'click', {})
  await delay(280)
  lifetime.abort()
  const before = host.html(root)
  requests[3].resolve({
    ok: true,
    json: async () => [{ id: 'late', title: 'Learn after disposal', done: false }],
  })
  await delay(0)
  assert.equal(requests[3].signal.aborted, true)
  assert.equal(host.html(root), before)
  mounted.dispose()

  const hydrated = factory({ endpoint: '/data/todos.json', initial: [] })
  const controller = new AbortController()
  hydrated.mount({ root, lifetime: controller.signal })
  await delay(280)
  assert.equal(requests.length, 4, 'an empty SSR result must not cause a duplicate mount request')
  controller.abort()
})
