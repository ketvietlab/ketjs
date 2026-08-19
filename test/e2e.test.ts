import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compose } from '../src/kernel/compose.ts'
import { sqliteAdapter } from '../src/data/sqlite.ts'
import { schemaFromManifest, planMigration, renderSql } from '../src/data/migrate.ts'
import { registerFunctions, _resetIdempotency } from '../src/server/fn.ts'
import { createKetServer } from '../src/server/http.ts'
import { createTheme } from '../src/theme/render.ts'
import catalog from '../examples/modules/catalog/index.ts'
import inventory from '../examples/modules/inventory/index.ts'
import checkout from '../examples/modules/checkout/index.ts'
import theme from '../examples/themes/default/index.ts'

const mods = [catalog, inventory, checkout, theme]

async function boot() {
  const manifest = compose(mods)
  const adapter = sqliteAdapter()
  await adapter.open()
  for (const sql of renderSql(planMigration(null, schemaFromManifest(manifest)), adapter)) await adapter.exec(sql)
  registerFunctions(mods)
  _resetIdempotency()
  const rt = createTheme(manifest, mods)
  const app = await createKetServer({
    manifest, adapter, theme: rt,
    pageScope: () => ({
      site: { title: 'Cửa hàng Ket', tagline: null },
      product: { id: 'p1', title: 'Áo thun', priceCents: 150000, leadTimeDays: 3 },
      related: [],
    }),
  })
  const port = await app.listen(0)
  return { app, adapter, base: `http://127.0.0.1:${port}` }
}

test('e2e: one declaration serves an HTTP endpoint', async () => {
  const { app, adapter, base } = await boot()
  const created = await fetch(`${base}/_ket/fn/catalog.createProduct`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'p1', title: 'Áo thun', priceCents: 150000, slug: 'ao-thun' }),
  }).then(r => r.json()) as { ok: boolean; value: { id: string } }
  assert.equal(created.ok, true)

  const got = await fetch(`${base}/_ket/fn/catalog.getProduct`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'p1' }),
  }).then(r => r.json()) as { value: { title: string } }
  assert.equal(got.value.title, 'Áo thun')
  await app.close(); await adapter.close()
})

test('e2e: the same declaration serves an agent descriptor', async () => {
  const { app, adapter, base } = await boot()
  const d = await fetch(`${base}/_ket/agent`).then(r => r.json()) as { tools: Array<{ name: string; mutates: boolean; dryRunnable: boolean }> }
  const tool = d.tools.find(t => t.name === 'checkout__placeOrder')!
  assert.equal(tool.mutates, true)
  assert.equal(tool.dryRunnable, true)
  await app.close(); await adapter.close()
})

test('e2e: a bad call returns a structured error an agent can act on', async () => {
  const { app, adapter, base } = await boot()
  const res = await fetch(`${base}/_ket/fn/catalog.getProduct`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wrong: 1 }),
  })
  assert.equal(res.status, 400)
  const body = await res.json() as { code: string; hint: string }
  assert.equal(body.code, 'E_INVALID_INPUT')
  assert.match(body.hint, /signature/)
  await app.close(); await adapter.close()
})

test('e2e: dry-run over HTTP reports writes and commits nothing', async () => {
  const { app, adapter, base } = await boot()
  const r = await fetch(`${base}/_ket/fn/catalog.createProduct?dryRun=1`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'p2', title: 'Quần', priceCents: 200000, slug: 'quan' }),
  }).then(r => r.json()) as { dryRun: boolean; writes: unknown[] }
  assert.equal(r.dryRun, true)
  assert.equal(r.writes.length, 1)
  assert.equal((await adapter.all('SELECT * FROM catalog_product', [])).length, 0)
  await app.close(); await adapter.close()
})

test('e2e: SSE stream resumes from a cursor after a reload', async () => {
  const { app, adapter, base } = await boot()
  await app.streams.open('gen1')
  await app.streams.write('gen1', 'Xin')
  await app.streams.write('gen1', ' chào')

  // first client reads what exists, then "reloads" (aborts)
  const ac = new AbortController()
  const res1 = await fetch(`${base}/_ket/stream/gen1?from=0`, { signal: ac.signal })
  const reader = res1.body!.getReader()
  let seen = ''
  while (!seen.includes('chào')) {
    const { value } = await reader.read()
    seen += new TextDecoder().decode(value)
  }
  const lastId = Number([...seen.matchAll(/^id: (\d+)$/gm)].pop()![1])
  ac.abort()

  // generation continues while nobody is listening
  await app.streams.write('gen1', ' bạn')
  await app.streams.end('gen1')

  const res2 = await fetch(`${base}/_ket/stream/gen1?from=${lastId + 1}`)
  const text = await res2.text()
  assert.match(text, /bạn/)
  assert.ok(!text.includes('Xin'), 'a resumed stream must not replay chunks the client already had')
  assert.match(text, /event: done/)
  await app.close(); await adapter.close()
})

test('e2e: a page renders through the theme, joint fills included', async () => {
  const { app, adapter, base } = await boot()
  const html = await fetch(`${base}/`).then(r => r.text())
  assert.match(html, /<title>Cửa hàng Ket<\/title>/)
  assert.match(html, /<h1>Áo thun<\/h1>/)
  assert.match(html, /Giao sau 3 ngày/)
  assert.match(html, /Chạy trên Ket/)
  await app.close(); await adapter.close()
})
