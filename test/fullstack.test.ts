import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compose } from '../src/kernel/compose.ts'
import { sqliteAdapter } from '../src/data/sqlite.ts'
import { schemaFromManifest, planMigration, renderSql, DestructiveMigrationError } from '../src/data/migrate.ts'
import { registerFunctions, callFn, _resetIdempotency } from '../src/server/fn.ts'
import { createStreams, createQueue } from '../src/server/stream.ts'
import { defineModule } from '../src/kernel/define.ts'
import catalog from '../examples/modules/catalog/index.ts'
import inventory from '../examples/modules/inventory/index.ts'
import checkout from '../examples/modules/checkout/index.ts'
import theme from '../examples/themes/default/index.ts'
import type { Adapter, Manifest } from '../src/types.ts'

const mods = [catalog, inventory, checkout, theme]

async function boot(): Promise<{ adapter: Adapter; manifest: Manifest }> {
  const manifest = compose(mods)
  const adapter = sqliteAdapter()
  await adapter.open()
  for (const sql of renderSql(planMigration(null, schemaFromManifest(manifest)), adapter)) await adapter.exec(sql)
  registerFunctions(mods)
  return { adapter, manifest }
}

test('fullstack: schema is derived from the composed manifest, extensions included', async () => {
  const { adapter } = await boot()
  const cols = (await adapter.introspect())['catalog_product']!
  assert.ok('title' in cols)
  assert.ok('leadTimeDays' in cols, 'the column inventory added to catalog.Product must exist')
  await adapter.close()
})

test('fullstack: destructive migrations are generated but refused by default', () => {
  const before = schemaFromManifest(compose(mods))
  const shrunk = defineModule({ name: 'catalog', models: { Product: { fields: { id: 'id', title: 'text' } } } })
  const after = schemaFromManifest(compose([shrunk]))
  assert.throws(() => planMigration(before, after), (e: unknown) => {
    const err = e as DestructiveMigrationError
    assert.equal(err.code, 'E_DESTRUCTIVE_MIGRATION')
    assert.match(err.message, /DROP_COLUMN catalog_product\.leadTimeDays \(contributed by inventory\)/)
    return true
  })
  const ops = planMigration(before, after, { allowDestructive: true })
  assert.ok(ops.some(o => o.op === 'DROP_COLUMN'))
})

test('fullstack: a server function cannot touch a model it did not declare', async () => {
  const { adapter, manifest } = await boot()
  const rogue = defineModule({
    name: 'rogue', depends: ['catalog'],
    functions: { peek: { effects: [], handler: (ctx) => ctx.db.select('catalog.Product') } },
  })
  const m2 = compose([...mods, rogue])
  registerFunctions([...mods, rogue])
  await assert.rejects(() => callFn('rogue.peek', {}, { adapter, manifest: m2 }), (e: unknown) => {
    assert.equal((e as { code: string }).code, 'E_EFFECT_NOT_DECLARED')
    assert.match((e as Error).message, /declares effects \[none\]/)
    return true
  })
  await adapter.close()
})

test('fullstack: input is validated against the declared signature', async () => {
  const { adapter, manifest } = await boot()
  await assert.rejects(
    () => callFn('catalog.createProduct', { id: 'p1', title: 'X', priceCents: 'nhieu', slug: 's' }, { adapter, manifest }),
    (e: unknown) => { assert.match((e as Error).message, /expects int \(number\), got string/); return true })
  await assert.rejects(
    () => callFn('catalog.getProduct', { id: 'p1', surprise: 1 }, { adapter, manifest }),
    (e: unknown) => { assert.match((e as Error).message, /unknown input "surprise"/); return true })
  await adapter.close()
})

test('agent safety: dry-run reports intended writes and commits nothing', async () => {
  const { adapter, manifest } = await boot()
  const res = await callFn('catalog.createProduct', { id: 'p9', title: 'Thu', priceCents: 1000, slug: 'thu' },
    { adapter, manifest, dryRun: true })
  assert.equal(res.dryRun, true)
  assert.equal(res.writes.length, 1)
  assert.equal(res.writes[0]!.model, 'catalog.Product')
  const rows = await adapter.all('SELECT * FROM catalog_product WHERE id = ?', ['p9'])
  assert.equal(rows.length, 0, 'dry-run must not commit')
  await adapter.close()
})

test('agent safety: an idempotency key makes a retry replay instead of double-apply', async () => {
  const { adapter, manifest } = await boot()
  const args = { id: 'o1', productId: 'p1', qty: 2 }
  await callFn('catalog.createProduct', { id: 'p1', title: 'Ao', priceCents: 5000, slug: 'ao' }, { adapter, manifest })
  const a = await callFn('checkout.placeOrder', args, { adapter, manifest, idempotencyKey: 'k1' })
  const b = await callFn('checkout.placeOrder', args, { adapter, manifest, idempotencyKey: 'k1' })
  assert.equal(b.replayed, true)
  assert.deepEqual(a.value, b.value)
  assert.equal((await adapter.all('SELECT * FROM checkout_order', [])).length, 1, 'retry must not create a second order')
  await adapter.close()
})

test('agent safety: an idempotency key on a non-idempotent function is refused', async () => {
  const { adapter, manifest } = await boot()
  await assert.rejects(
    () => callFn('catalog.listProducts', {}, { adapter, manifest, idempotencyKey: 'k' }),
    (e: unknown) => { assert.equal((e as { code: string }).code, 'E_NOT_IDEMPOTENT'); return true })
  await adapter.close()
})

test('streams: a client that reloads mid-generation resumes exactly where it stopped', async () => {
  const adapter = sqliteAdapter(); await adapter.open()
  const s = await createStreams(adapter)
  await s.open('gen'); await s.write('gen', 'Xin'); await s.write('gen', ' chao')
  const first = await s.since('gen', 0)
  assert.equal(first.chunks.map(c => c.data).join(''), 'Xin chao')
  assert.equal(first.done, false)

  // ... the browser reloads here; generation keeps running on the server
  await s.write('gen', ' ban'); await s.end('gen', { tokens: 3 })

  const resumed = await s.since('gen', first.nextSeq)
  assert.equal(resumed.chunks.map(c => c.data).join(''), ' ban', 'only the missed chunk, no duplicates')
  assert.equal(resumed.done, true)
  assert.deepEqual(resumed.summary, { tokens: 3 })
  await adapter.close()
})

test('streams: the job queue is the same log with a different state machine', async () => {
  const adapter = sqliteAdapter(); await adapter.open()
  const q = await createQueue(adapter)
  await q.enqueue('mail', { to: 'a@b.c' })
  await q.enqueue('mail', { to: 'd@e.f' })
  assert.equal(await q.pending('mail'), 2)
  const job = (await q.claim('mail'))!
  assert.deepEqual(job.data, { to: 'a@b.c' })
  await q.complete('mail', job.seq)
  assert.equal(await q.pending('mail'), 1)
  await adapter.close()
})
