// Runs against a real Postgres when one is reachable, and skips otherwise so the
// suite still passes on a machine without it. Everything above this line has been
// proven against a stand-in; this is the part only a live server can settle.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { postgresAdapter } from '../src/data/postgres.ts'
import { compose } from '../src/kernel/compose.ts'
import { schemaFromManifest, planMigration, renderSql } from '../src/data/migrate.ts'
import { table, from } from '../src/data/query.ts'
import { eq, gte } from '../src/data/expr.ts'
import { registerFunctions, callFn } from '../src/server/fn.ts'
import { createStreams, dbStreamStore } from '../src/server/stream.ts'
import { createQueue } from '../src/server/queue.ts'
import { createAdapterPool } from '../src/data/pool.ts'
import { migrateFleet, formatFleet } from '../src/data/fleet.ts'
import catalog from '../examples/modules/catalog/index.ts'
import inventory from '../examples/modules/inventory/index.ts'
import checkout from '../examples/modules/checkout/index.ts'
import theme from '../examples/themes/default/index.ts'
import type { Adapter } from '../src/types.ts'

const URL = process.env.KET_TEST_PG ?? 'postgres://dev:devpassword@127.0.0.1:5435/ketjs_dev'
const mods = [catalog, inventory, checkout, theme]
const manifest = compose(mods)

const reachable = await (async () => {
  const a = postgresAdapter(URL)
  try { await a.open(); await a.all('SELECT 1'); await a.close(); return true }
  catch { return false }
})()

const live = { skip: reachable ? false : `no Postgres at ${URL}` }

/** Runs the body with a fresh database and always closes the pool, so a failed
 *  assertion cannot leave the suite waiting on an open socket. */
async function withPg(body: (a: Adapter) => Promise<void>): Promise<void> {
  const a = await fresh()
  try { await body(a) } finally { await a.close() }
}

async function fresh(): Promise<Adapter> {
  const a = postgresAdapter(URL)
  await a.open()
  for (const t of ['ket_stream', 'ket_job', 'ket_idem', 'checkout_order', 'catalog_product']) {
    await a.exec(`DROP TABLE IF EXISTS "${t}" CASCADE`)
  }
  for (const sql of renderSql(planMigration(null, schemaFromManifest(manifest)), a)) await a.exec(sql)
  registerFunctions(mods)
  return a
}

test('live pg: the manifest migrates onto a real server', live, async () => {
  await withPg(async (a) => {
  const cols = (await a.introspect())['catalog_product']!
  assert.equal(cols['active'], 'boolean', 'a real BOOLEAN, not sqlite 0/1')
  assert.equal(cols['leadTimeDays'], 'bigint')
  assert.equal((await a.introspect())['checkout_order']!['placedAt'], 'timestamp with time zone')
  })
})

test('live pg: server functions round-trip through the query layer', live, async () => {
  await withPg(async (a) => {
  for (const [id, price] of [['p1', 30_000], ['p2', 90_000], ['p3', 60_000]] as const) {
    await callFn('catalog.createProduct', { id, title: `SP ${id}`, priceCents: price, slug: id }, { adapter: a, manifest })
  }
  const dear = await callFn('catalog.listProducts', { minPriceCents: 60_000 }, { adapter: a, manifest })
  assert.deepEqual((dear.value as Array<{ id: string }>).map(r => r.id), ['p2', 'p3'])

  const P = table(manifest, 'catalog.Product')
  const { text, params } = from(P).where_(gte(P.priceCents!, 60_000), eq(P.active!, true)).toSQL('postgres')
  assert.equal((await a.all(text, params)).length, 2)
  })
})

test('live pg: booleans and bigints survive the round trip as themselves', live, async () => {
  await withPg(async (a) => {
  await callFn('catalog.createProduct', { id: 'b1', title: 'X', priceCents: 12_345, slug: 'x' }, { adapter: a, manifest })
  const row = (await a.all('SELECT "active", "priceCents" FROM catalog_product WHERE id = $1', ['b1']))[0]!
  assert.equal(row.active, true, 'a real boolean comes back, not 1')
  assert.equal(Number(row.priceCents), 12_345)
  })
})

test('live pg: a transaction rolls back on a real server', live, async () => {
  await withPg(async (a) => {
  await assert.rejects(() => a.tx(async (tx) => {
    await tx.run('INSERT INTO catalog_product (id, title, "priceCents", slug, active) VALUES ($1,$2,$3,$4,$5)', ['t1', 'T', 1, 't', true])
    throw new Error('boom')
  }))
  assert.equal((await a.all('SELECT id FROM catalog_product WHERE id = $1', ['t1'])).length, 0)
  })
})

test('live pg: resumable stream survives on a real table', live, async () => {
  await withPg(async (a) => {
  const s = await createStreams(dbStreamStore(a))
  const w = await s.open('gen-live')
  w.write('Xin'); w.write(' chào')
  await w.flush()
  const first = await s.since('gen-live', 0)
  assert.equal(first.chunks.map(c => c.data).join(''), 'Xin chào')

  w.write(' bạn')
  await w.end({ tokens: 3 })
  const resumed = await s.since('gen-live', first.nextSeq)
  assert.equal(resumed.chunks.map(c => c.data).join(''), ' bạn', 'no gap, no duplicate')
  assert.equal(resumed.done, true)
  assert.ok(await s.sweep(0) > 0, 'retention actually deletes')
  })
})

test('live pg: SKIP LOCKED hands each job to exactly one worker', live, async () => {
  await withPg(async (a) => {
  const q = await createQueue(a)
  for (let i = 0; i < 20; i++) await q.enqueue('mail', { n: i })

  // Twenty workers claiming at once: with SELECT-then-UPDATE they would collide.
  const claimed = await Promise.all(Array.from({ length: 20 }, () => q.claim('mail')))
  const ids = claimed.filter(Boolean).map(j => j!.id)
  assert.equal(ids.length, 20, 'every job was claimed')
  assert.equal(new Set(ids).size, 20, 'no job was handed to two workers')
  assert.equal(await q.pending('mail'), 0)
  })
})

test('live pg: idempotency is settled by the primary key across concurrent calls', live, async () => {
  await withPg(async (a) => {
  const args = { id: 'o1', productId: 'p1', qty: 2 }
  await callFn('catalog.createProduct', { id: 'p1', title: 'Áo', priceCents: 5000, slug: 'ao' }, { adapter: a, manifest })

  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => callFn('checkout.placeOrder', args, { adapter: a, manifest, idempotencyKey: 'same' })))
  const ok = results.filter(r => r.status === 'fulfilled')
  assert.ok(ok.length >= 1)
  assert.equal((await a.all('SELECT id FROM checkout_order', [])).length, 1, 'five concurrent calls, one order')
  })
})

test('live pg: a database per tenant, migrated as a fleet', live, async () => {
  const base = URL.replace(/\/[^/]*$/, '')
  const pool = createAdapterPool({ create: (key) => postgresAdapter(`${base}/${key}`), max: 4 })
  try {
    for (const db of ['ketjs_t1', 'ketjs_t2']) {
      await pool.with(db, async (a) => {
        for (const t of ['ket_migration', 'ket_stream', 'ket_job', 'ket_idem', 'checkout_order', 'catalog_product']) {
          await a.exec(`DROP TABLE IF EXISTS "${t}" CASCADE`)
        }
      })
    }
    registerFunctions(mods)

    const first = await migrateFleet(pool, ['ketjs_t1', 'ketjs_t2'], manifest)
    assert.ok(first.every(r => r.applied && !r.error), formatFleet(first))

    // real isolation: the same product id in both, different data, no bleed
    await pool.with('ketjs_t1', a => callFn('catalog.createProduct', { id: 'p1', title: 'của t1', priceCents: 1000, slug: 'p1' }, { adapter: a, manifest }))
    await pool.with('ketjs_t2', a => callFn('catalog.createProduct', { id: 'p1', title: 'của t2', priceCents: 2000, slug: 'p1' }, { adapter: a, manifest }))

    const t1 = await pool.with('ketjs_t1', a => a.all('SELECT title FROM catalog_product', []))
    const t2 = await pool.with('ketjs_t2', a => a.all('SELECT title FROM catalog_product', []))
    assert.deepEqual(t1.map(r => r.title), ['của t1'])
    assert.deepEqual(t2.map(r => r.title), ['của t2'])

    // running again moves nothing: each database knows the schema it is on
    const second = await migrateFleet(pool, ['ketjs_t1', 'ketjs_t2'], manifest)
    assert.ok(second.every(r => r.ops.length === 0), formatFleet(second))
    assert.equal(pool.size, 2)
  } finally {
    await pool.close()
  }
})
