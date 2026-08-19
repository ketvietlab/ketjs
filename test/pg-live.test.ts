// Runs against a real Postgres when one is reachable, and skips otherwise so the
// suite still passes on a machine without it. Everything above this line has been
// proven against a stand-in; this is the part only a live server can settle.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { postgresAdapter } from 'ketjs-postgres'
import {
  callFn,
  compose,
  createAdapterPool,
  createQueue,
  createStreams,
  dbStreamStore,
  eq,
  formatFleet,
  from,
  gte,
  migrateFleet,
  planMigration,
  migrateOne,
  registerFunctions,
  renderSql,
  schemaFromManifest,
  table,
} from 'ketjs'
import type { Adapter } from 'ketjs'
import { catalog, checkout, defaultTheme as theme, inventory, uom } from 'ketsuite'

/** Every request acts as some company; these tests act as one. */
const SCOPE = { company: 'c1', branches: null }

const URL = process.env.KET_TEST_PG ?? 'postgres://dev:devpassword@127.0.0.1:5435/ketjs_dev'
const mods = [catalog, inventory, checkout, theme]
const manifest = compose(mods)

const reachable = await (async () => {
  const a = postgresAdapter(URL)
  try {
    await a.open()
    await a.all('SELECT 1')
    await a.close()
    return true
  } catch {
    return false
  }
})()

const live = { skip: reachable ? false : `no Postgres at ${URL}` }

/** Runs the body with a fresh database and always closes the pool, so a failed
 *  assertion cannot leave the suite waiting on an open socket. */
async function withPg(body: (a: Adapter) => Promise<void>): Promise<void> {
  const a = await fresh()
  try {
    await body(a)
  } finally {
    await a.close()
  }
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
    for (const [id, price] of [
      ['p1', 30_000],
      ['p2', 90_000],
      ['p3', 60_000],
    ] as const) {
      await callFn(
        'catalog.createProduct',
        { id, title: `SP ${id}`, priceCents: price, slug: id },
        { adapter: a, manifest, scope: SCOPE },
      )
    }
    const dear = await callFn(
      'catalog.listProducts',
      { minPriceCents: 60_000 },
      { adapter: a, manifest, scope: SCOPE },
    )
    assert.deepEqual(
      (dear.value as Array<{ id: string }>).map((r) => r.id),
      ['p2', 'p3'],
    )

    const P = table(manifest, 'catalog.Product')
    const { text, params } = from(P).where(gte(P.priceCents!, 60_000), eq(P.active!, true)).toSQL('postgres')
    assert.equal((await a.all(text, params)).length, 2)
  })
})

test('live pg: booleans and bigints survive the round trip as themselves', live, async () => {
  await withPg(async (a) => {
    await callFn(
      'catalog.createProduct',
      { id: 'b1', title: 'X', priceCents: 12_345, slug: 'x' },
      { adapter: a, manifest, scope: SCOPE },
    )
    const row = (await a.all('SELECT "active", "priceCents" FROM catalog_product WHERE id = $1', ['b1']))[0]!
    assert.equal(row.active, true, 'a real boolean comes back, not 1')
    assert.equal(Number(row.priceCents), 12_345)
  })
})

test('live pg: a transaction rolls back on a real server', live, async () => {
  await withPg(async (a) => {
    await assert.rejects(() =>
      a.tx(async (tx) => {
        await tx.run(
          'INSERT INTO catalog_product (id, title, "priceCents", slug, active) VALUES ($1,$2,$3,$4,$5)',
          ['t1', 'T', 1, 't', true],
        )
        throw new Error('boom')
      }),
    )
    assert.equal((await a.all('SELECT id FROM catalog_product WHERE id = $1', ['t1'])).length, 0)
  })
})

test('live pg: resumable stream survives on a real table', live, async () => {
  await withPg(async (a) => {
    const s = await createStreams(dbStreamStore(a))
    const w = await s.open('gen-live')
    w.write('Xin')
    w.write(' chào')
    await w.flush()
    const first = await s.since('gen-live', 0)
    assert.equal(first.chunks.map((c) => c.data).join(''), 'Xin chào')

    w.write(' bạn')
    await w.end({ tokens: 3 })
    const resumed = await s.since('gen-live', first.nextSeq)
    assert.equal(resumed.chunks.map((c) => c.data).join(''), ' bạn', 'no gap, no duplicate')
    assert.equal(resumed.done, true)
    assert.ok((await s.sweep(0)) > 0, 'retention actually deletes')
  })
})

test('live pg: SKIP LOCKED hands each job to exactly one worker', live, async () => {
  await withPg(async (a) => {
    const q = await createQueue(a)
    for (let i = 0; i < 20; i++) await q.enqueue('mail', { n: i })

    // Twenty workers claiming at once: with SELECT-then-UPDATE they would collide.
    const claimed = await Promise.all(Array.from({ length: 20 }, () => q.claim('mail')))
    const ids = claimed.filter(Boolean).map((j) => j!.id)
    assert.equal(ids.length, 20, 'every job was claimed')
    assert.equal(new Set(ids).size, 20, 'no job was handed to two workers')
    assert.equal(await q.pending('mail'), 0)
  })
})

test('live pg: idempotency is settled by the primary key across concurrent calls', live, async () => {
  await withPg(async (a) => {
    const args = { id: 'o1', productId: 'p1', qty: 2 }
    await callFn(
      'catalog.createProduct',
      { id: 'p1', title: 'Áo', priceCents: 5000, slug: 'ao' },
      { adapter: a, manifest, scope: SCOPE },
    )

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        callFn('checkout.placeOrder', args, { adapter: a, manifest, scope: SCOPE, idempotencyKey: 'same' }),
      ),
    )
    const ok = results.filter((r) => r.status === 'fulfilled')
    assert.ok(ok.length >= 1)
    assert.equal(
      (await a.all('SELECT id FROM checkout_order', [])).length,
      1,
      'five concurrent calls, one order',
    )
  })
})

test('live pg: a database per tenant, migrated as a fleet', live, async () => {
  const base = URL.replace(/\/[^/]*$/, '')
  const pool = createAdapterPool({ create: (key) => postgresAdapter(`${base}/${key}`), max: 4 })
  try {
    for (const db of ['ketjs_t1', 'ketjs_t2']) {
      await pool.with(db, async (a) => {
        for (const t of [
          'ket_migration',
          'ket_stream',
          'ket_job',
          'ket_idem',
          'checkout_order',
          'catalog_product',
        ]) {
          await a.exec(`DROP TABLE IF EXISTS "${t}" CASCADE`)
        }
      })
    }
    registerFunctions(mods)

    const first = await migrateFleet(pool, ['ketjs_t1', 'ketjs_t2'], manifest)
    assert.ok(
      first.every((r) => r.applied && !r.error),
      formatFleet(first),
    )

    // real isolation: the same product id in both, different data, no bleed
    await pool.with('ketjs_t1', (a) =>
      callFn(
        'catalog.createProduct',
        { id: 'p1', title: 'của t1', priceCents: 1000, slug: 'p1' },
        { adapter: a, manifest, scope: SCOPE },
      ),
    )
    await pool.with('ketjs_t2', (a) =>
      callFn(
        'catalog.createProduct',
        { id: 'p1', title: 'của t2', priceCents: 2000, slug: 'p1' },
        { adapter: a, manifest, scope: SCOPE },
      ),
    )

    const t1 = await pool.with('ketjs_t1', (a) => a.all('SELECT title FROM catalog_product', []))
    const t2 = await pool.with('ketjs_t2', (a) => a.all('SELECT title FROM catalog_product', []))
    assert.deepEqual(
      t1.map((r) => r.title),
      ['của t1'],
    )
    assert.deepEqual(
      t2.map((r) => r.title),
      ['của t2'],
    )

    // running again moves nothing: each database knows the schema it is on
    const second = await migrateFleet(pool, ['ketjs_t1', 'ketjs_t2'], manifest)
    assert.ok(
      second.every((r) => r.ops.length === 0),
      formatFleet(second),
    )
    assert.equal(pool.size, 2)
  } finally {
    await pool.close()
  }
})

test('live pg: a decimal column is NUMERIC, and gives back exactly what it was given', live, async () => {
  const base = URL.replace(/\/[^/]*$/, '')
  const pool = createAdapterPool({ create: (key) => postgresAdapter(`${base}/${key}`), max: 2 })
  try {
    const m = compose([uom], { headless: true })
    await pool.with('ketjs_t2', async (a) => {
      // A clean slate, including the migration record: this database is left in
      // whatever shape the fleet test gave it, and the destructive guard rightly
      // refuses to drop those tables on the way to a uom-only schema.
      for (const t of [
        'uom_unit',
        'uom_category',
        'catalog_product',
        'checkout_order',
        'ket_migration',
        'ket_app',
        'ket_idem',
        'ket_job',
        'ket_stream',
      ]) {
        await a.exec(`DROP TABLE IF EXISTS "${t}" CASCADE`)
      }
      await migrateOne(a, m)

      const cols = (await a.introspect())['uom_unit']!
      assert.equal(cols['factor'], 'numeric', 'exact decimal storage, as Odoo uses for quantities')
      assert.equal(cols['rounding'], 'numeric')

      registerFunctions([uom])
      await a.run('INSERT INTO uom_category (id, name) VALUES ($1, $2)', ['weight', 'Khối lượng'])

      // Values a double cannot hold. The point of the column type is that these
      // come back as themselves rather than as the nearest binary approximation.
      const awkward = [0.1, 0.001, 0.07, 12345.6789]
      for (const [i, factor] of awkward.entries()) {
        await callFn(
          'uom.saveUnit',
          { id: `u${i}`, name: `u${i}`, categoryId: 'weight', type: 'smaller', factor, rounding: 0.001 },
          { adapter: a, manifest: m, scope: { company: 'acme', branches: null } },
        )
      }
      const rows = (
        await callFn(
          'uom.listUnits',
          { categoryId: 'weight' },
          { adapter: a, manifest: m, scope: { company: 'acme', branches: null } },
        )
      ).value as Array<{ id: string; factor: number }>
      for (const [i, factor] of awkward.entries()) {
        assert.equal(rows.find((r) => r.id === `u${i}`)!.factor, factor)
      }

      // And the driver hands NUMERIC over as a string, which is what keeps it exact
      // before the framework turns it into a number.
      const raw = (await a.all('SELECT factor FROM uom_unit WHERE id = $1', ['u0']))[0]!
      assert.equal(typeof raw.factor, 'string')
      assert.equal(raw.factor, '0.1')
    })
  } finally {
    await pool.close()
  }
})
