import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAdapterPool } from '../src/data/pool.ts'
import { migrateOne, migrateFleet, formatFleet } from '../src/data/fleet.ts'
import { createIdempotency } from '../src/server/idem.ts'
import { sqliteAdapter } from '../src/data/sqlite.ts'
import { compose } from '../src/kernel/compose.ts'
import { defineModule } from '../src/kernel/define.ts'
import { registerFunctions, callFn } from '../src/server/fn.ts'
import { createKetServer } from '../src/server/http.ts'
import { createTheme } from '../src/theme/render.ts'
import catalog from '../examples/modules/catalog/index.ts'
import inventory from '../examples/modules/inventory/index.ts'
import checkout from '../examples/modules/checkout/index.ts'
import theme from '../examples/themes/default/index.ts'

const mods = [catalog, inventory, checkout, theme]
const manifest = compose(mods)

// A file-less SQLite database per tenant: each key is its own isolated store.
const stores = new Map<string, ReturnType<typeof sqliteAdapter>>()
const create = (key: string) => {
  const a = sqliteAdapter()
  stores.set(key, a)
  return a
}

test('pool: one adapter per database, reused across acquisitions', async () => {
  const pool = createAdapterPool({ create })
  const a1 = await pool.acquire('t1'); pool.release('t1')
  const a2 = await pool.acquire('t1'); pool.release('t1')
  const b = await pool.acquire('t2'); pool.release('t2')
  assert.equal(a1, a2, 'the same database means the same adapter')
  assert.notEqual(a1, b)
  assert.deepEqual(pool.open.sort(), ['t1', 't2'])
  await pool.close()
})

test('pool: the cap on open databases is enforced by eviction', async () => {
  const pool = createAdapterPool({ create, max: 2 })
  for (const k of ['a', 'b', 'c', 'd']) await pool.with(k, async () => {})
  assert.equal(pool.size, 2, 'never more than max databases open at once')
  assert.deepEqual(pool.open, ['c', 'd'], 'the least recently used were evicted')
  await pool.close()
})

test('pool: a database a request is still holding is never evicted', async () => {
  const pool = createAdapterPool({ create, max: 1 })
  await pool.with('held', async () => {
    await assert.rejects(() => pool.acquire('other'), /pool is full .* every database is in use/)
  })
  await pool.acquire('other')   // released now, so it can be evicted
  await pool.close()
})

test('pool: idle databases are closed, busy ones are not', async () => {
  let clock = 0
  const pool = createAdapterPool({ create, idleMs: 100, now: () => clock })
  await pool.with('old', async () => {})
  clock = 500
  await pool.with('fresh', async () => {})
  assert.equal(await pool.evictIdle(), 1)
  assert.deepEqual(pool.open, ['fresh'])
  await pool.close()
})

test('fleet: every tenant converges on the same schema from one manifest', async () => {
  const pool = createAdapterPool({ create })
  const results = await migrateFleet(pool, ['acme', 'globex', 'initech'], manifest)
  assert.equal(results.length, 3)
  assert.ok(results.every(r => r.applied && !r.error))

  for (const key of ['acme', 'globex', 'initech']) {
    const cols = await pool.with(key, a => a.introspect())
    assert.ok('catalog_product' in cols, `${key} must have the table`)
    assert.ok('leadTimeDays' in cols['catalog_product']!, `${key} must have the field inventory contributed`)
  }
  await pool.close()
})

test('fleet: a second run is a no-op because each database records its own schema', async () => {
  const pool = createAdapterPool({ create })
  await migrateFleet(pool, ['once'], manifest)
  const again = await migrateFleet(pool, ['once'], manifest)
  assert.deepEqual(again[0]!.ops, [], 'nothing left to do')
  assert.match(formatFleet(again), /already up to date/)
  await pool.close()
})

test('fleet: a tenant created later catches up to the same shape', async () => {
  const pool = createAdapterPool({ create })
  const older = defineModule({ name: 'catalog', models: { Product: { fields: { id: 'id', title: 'text' } } } })
  const v1 = compose([older], { headless: true })

  await migrateFleet(pool, ['early'], v1)          // tenant created against the old manifest
  await migrateFleet(pool, ['late'], manifest)     // tenant created today
  const catchUp = await migrateFleet(pool, ['early'], manifest)

  assert.ok(catchUp[0]!.ops.some(op => op.op === 'ADD_COLUMN'), 'the older tenant is brought forward')
  const earlyCols = await pool.with('early', a => a.introspect())
  const lateCols = await pool.with('late', a => a.introspect())
  assert.deepEqual(Object.keys(earlyCols['catalog_product']!).sort(), Object.keys(lateCols['catalog_product']!).sort())
  await pool.close()
})

test('fleet: one failing tenant does not stop the others, and says so', async () => {
  const pool = createAdapterPool({
    create: (key) => (key === 'broken'
      ? { ...sqliteAdapter(), open: async () => { throw new Error('cannot reach database') } }
      : create(key)),
  })
  const results = await migrateFleet(pool, ['good1', 'broken', 'good2'], manifest)
  assert.equal(results.filter(r => r.applied).length, 2)
  assert.match(results.find(r => r.datastore === 'broken')!.error!, /cannot reach database/)
  assert.match(formatFleet(results), /FAIL {2}broken/)
})

test('fleet: destructive changes are refused per tenant, not silently applied', async () => {
  const pool = createAdapterPool({ create })
  await migrateFleet(pool, ['shrink'], manifest)
  const shrunk = compose([defineModule({ name: 'catalog', models: { Product: { fields: { id: 'id' } } } })], { headless: true })
  const r = await migrateFleet(pool, ['shrink'], shrunk)
  assert.equal(r[0]!.applied, false)
  assert.match(r[0]!.error!, /destructive operation/)
  await pool.close()
})

test('server: each request is served by its own tenant database', async () => {
  const pool = createAdapterPool({ create })
  await migrateFleet(pool, ['acme.test', 'globex.test'], manifest)
  registerFunctions(mods)

  const app = await createKetServer({
    manifest, pool,
    resolveDatastore: (url) => (url.searchParams.get('tenant') ?? null),
    theme: createTheme(manifest, mods),
    pageScope: () => ({ site: { title: 'x' }, product: { id: 'p', title: 't', priceCents: 1 }, related: [] }),
  })
  const port = await app.listen(0)
  const base = `http://127.0.0.1:${port}`

  const create_ = (tenant: string, id: string, title: string) =>
    fetch(`${base}/_ket/fn/catalog.createProduct?tenant=${tenant}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, title, priceCents: 1000, slug: id }),
    }).then(r => r.json())

  await create_('acme.test', 'p1', 'của acme')
  await create_('globex.test', 'p2', 'của globex')

  const acme = await fetch(`${base}/_ket/fn/catalog.listProducts?tenant=acme.test`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }).then(r => r.json()) as { value: Array<{ id: string }> }
  const globex = await fetch(`${base}/_ket/fn/catalog.listProducts?tenant=globex.test`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }).then(r => r.json()) as { value: Array<{ id: string }> }

  assert.deepEqual(acme.value.map(p => p.id), ['p1'])
  assert.deepEqual(globex.value.map(p => p.id), ['p2'], 'no tenant may see another tenant data')

  const unknown = await fetch(`${base}/_ket/fn/catalog.listProducts?tenant=`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  })
  assert.equal(unknown.status, 400)
  assert.equal(((await unknown.json()) as { code: string }).code, 'E_UNKNOWN_TENANT')

  await app.close()
  await pool.close()
})

test('tables: a framework table only appears once something uses it', async () => {
  const a = sqliteAdapter(); await a.open()
  await migrateOne(a, manifest)
  assert.deepEqual(Object.keys(await a.introspect()).sort(),
    ['catalog_product', 'checkout_order', 'ket_migration'],
    'migrating creates the app schema and the version record, nothing else')

  registerFunctions(mods)
  const app = await createKetServer({ manifest, adapter: a })
  assert.equal('ket_stream' in await a.introspect(), false, 'an app that never streams gets no stream table')

  const w = await app.streams.open('s'); w.write('x'); await w.end()
  assert.equal('ket_stream' in await a.introspect(), true, 'it appears on first use')
  assert.equal('ket_idem' in await a.introspect(), false, 'and still no idempotency table')

  await callFn('catalog.createProduct', { id: 'i1', title: 'T', priceCents: 1, slug: 'i' },
    { adapter: a, manifest, idempotencyKey: 'k' })
  assert.equal('ket_idem' in await a.introspect(), true, 'which appears the first time a key is used')
  await app.close(); await a.close()
})

test('idempotency: a claim abandoned by a dead caller is taken over, not blocked forever', async () => {
  const a = sqliteAdapter(); await a.open()
  await migrateOne(a, manifest)
  let clock = Date.parse('2026-08-19T00:00:00.000Z')
  const idem = await createIdempotency(a, { now: () => new Date(clock).toISOString() })

  assert.equal(await idem.claim('k1', 'fn'), true)
  assert.equal(await idem.claim('k1', 'fn'), false, 'still held while fresh')

  clock += 6 * 60_000                                  // the caller died six minutes ago
  assert.equal(await idem.claim('k1', 'fn'), true, 'a stale claim is taken over')
  await a.close()
})

test('idempotency: finished records expire, so the table does not grow forever', async () => {
  const a = sqliteAdapter(); await a.open()
  await migrateOne(a, manifest)
  let clock = Date.parse('2026-08-19T00:00:00.000Z')
  const idem = await createIdempotency(a, { now: () => new Date(clock).toISOString() })
  await idem.claim('old', 'fn'); await idem.complete('old', { ok: true })

  assert.equal(await idem.sweep(), 0, 'nothing is stale yet')
  clock += 25 * 60 * 60_000
  assert.equal(await idem.sweep(), 1, 'a day later it goes')
  assert.equal(await idem.read('old'), null)
  await a.close()
})
