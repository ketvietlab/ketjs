import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DestructiveMigrationError, _resetIdempotency, callFn, compose, createQueue, createStreams, dbStreamStore, defineModule, planMigration, registerFunctions, renderSql, schemaFromManifest, sqliteAdapter } from 'ketjs'
import type { Adapter, Manifest } from 'ketjs'
import { catalog, checkout, defaultTheme as theme, inventory } from 'ketsuite'

/** Every request acts as some company; these tests act as one. */
const SCOPE = { company: 'c1', branches: null }

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
  const shrunk = defineModule({ name: 'catalog', models: { Product: { scope: 'shared', fields: { id: 'id', title: 'text' } } } })
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
  const a = await callFn('checkout.placeOrder', args, { adapter, manifest, scope: SCOPE, idempotencyKey: 'k1' })
  const b = await callFn('checkout.placeOrder', args, { adapter, manifest, scope: SCOPE, idempotencyKey: 'k1' })
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
  const s = await createStreams(dbStreamStore(adapter))
  const w = await s.open('gen')
  w.write('Xin'); w.write(' chao')
  await w.flush()
  const first = await s.since('gen', 0)
  assert.equal(first.chunks.map(c => c.data).join(''), 'Xin chao')
  assert.equal(first.done, false)

  // ... the browser reloads here; generation keeps running on the server
  w.write(' ban')
  await w.end({ tokens: 3 })

  const resumed = await s.since('gen', first.nextSeq)
  assert.equal(resumed.chunks.map(c => c.data).join(''), ' ban', 'only what was missed, no duplicates')
  assert.equal(resumed.done, true)
  assert.deepEqual(resumed.summary, { tokens: 3 })
  await adapter.close()
})

test('streams: writes are batched, so a token is not a transaction', async () => {
  const adapter = sqliteAdapter(); await adapter.open()
  let inserts = 0
  const counting = { ...adapter, run: (s: string, p?: unknown[]) => { if (s.startsWith('INSERT INTO ket_stream')) inserts++; return adapter.run(s, p) } }
  const s = await createStreams(dbStreamStore(counting))
  const w = await s.open('g')
  for (let i = 0; i < 100; i++) w.write(`tok${i}`)
  await w.end()
  assert.ok(inserts <= 6, `100 chunks must not cost 100 inserts, got ${inserts}`)
  assert.equal((await s.since('g', 0)).chunks.length, 100, 'every chunk still arrives')
  await adapter.close()
})

test('streams: a finished stream is swept after its grace period', async () => {
  const adapter = sqliteAdapter(); await adapter.open()
  const s = await createStreams(dbStreamStore(adapter))
  const w = await s.open('old'); w.write('x'); await w.end()
  assert.equal(await s.sweep(10 * 60_000), 0, 'still inside the grace period')
  assert.equal(await s.sweep(0) > 0, true, 'past it, the rows go')
  assert.equal((await s.since('old', 0)).chunks.length, 0)
  await adapter.close()
})

test('streams: a reader on the same instance is woken, not polled', async () => {
  const s = await createStreams()
  const w = await s.open('live')
  const seen: unknown[] = []
  const reader = (async () => { for await (const c of s.tail('live', 0, { pollMs: 60_000 })) seen.push(c.data) })()
  w.write('a'); await w.flush()
  await new Promise(r => setTimeout(r, 20))
  await w.end()
  await reader
  assert.deepEqual(seen, ['a'], 'with a 60s poll interval this only works if the writer woke the reader')
})

test('queue: jobs live in their own table, claimed one at a time', async () => {
  const adapter = sqliteAdapter(); await adapter.open()
  const q = await createQueue(adapter)
  await q.enqueue('mail', { to: 'a@b.c' })
  await q.enqueue('mail', { to: 'd@e.f' })
  assert.equal(await q.pending('mail'), 2)
  const job = (await q.claim('mail'))!
  assert.deepEqual(job.payload, { to: 'a@b.c' })
  assert.equal(job.attempts, 1)
  await q.complete(job.id)
  assert.equal(await q.pending('mail'), 1)
  const second = (await q.claim('mail'))!
  assert.deepEqual(second.payload, { to: 'd@e.f' })
  assert.equal(await q.claim('mail'), null, 'nothing left to claim')
  await adapter.close()
})
