import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  type Adapter,
  callFn,
  compose,
  confirmManualMigration,
  createAdapterPool,
  createIdempotency,
  createKetServer,
  createTheme,
  defineModule,
  formatFleet,
  migrateFleet,
  migrateOne,
  planMigration,
  registerFunctions,
  schemaFromManifest,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import { catalog, checkout, defaultTheme as theme, inventory } from '@ketvietlab/ketsuite'

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
  const a1 = await pool.acquire('t1')
  pool.release('t1')
  const a2 = await pool.acquire('t1')
  pool.release('t1')
  const b = await pool.acquire('t2')
  pool.release('t2')
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
  await pool.acquire('other') // released now, so it can be evicted
  await pool.close()
})

test('pool: an adapter still opening cannot be evicted by a concurrent acquire', async () => {
  let finishOpen!: () => void
  const events: string[] = []
  const delayed = (key: string) => {
    const adapter = sqliteAdapter()
    return {
      ...adapter,
      async open() {
        events.push(`open:${key}`)
        if (key === 'first')
          await new Promise<void>((resolve) => {
            finishOpen = resolve
          })
        await adapter.open()
      },
      async close() {
        events.push(`close:${key}`)
        await adapter.close()
      },
    }
  }
  const pool = createAdapterPool({ create: delayed, max: 1 })
  const first = pool.acquire('first')
  await Promise.resolve()
  await assert.rejects(() => pool.acquire('second'), /pool is full .* every database is in use/)
  assert.deepEqual(events, ['open:first'])
  finishOpen()
  await first
  pool.release('first')
  await pool.close()
})

test('pool: an adapter being evicted holds its slot until close completes', async () => {
  let finishClose!: () => void
  let closeStarted!: () => void
  const closeGate = new Promise<void>((resolve) => {
    finishClose = resolve
  })
  const started = new Promise<void>((resolve) => {
    closeStarted = resolve
  })
  let live = 0
  let peak = 0
  const events: string[] = []
  const pool = createAdapterPool({
    max: 1,
    create: (key) => ({
      ...sqliteAdapter(),
      async open() {
        live++
        peak = Math.max(peak, live)
        events.push(`open:${key}`)
      },
      async close() {
        events.push(`close:start:${key}`)
        if (key === 'first') {
          closeStarted()
          await closeGate
        }
        live--
        events.push(`close:end:${key}`)
      },
    }),
  })

  await pool.with('first', async () => {})
  const next = pool.acquire('next')
  await started
  const overtaker = pool.acquire('overtaker').then(
    (adapter) => ({ adapter }),
    (error: unknown) => ({ error }),
  )
  await Promise.resolve()

  assert.equal(live, 1, 'a closing adapter still consumes the only physical slot')
  assert.equal(pool.size, 1)
  assert.deepEqual(pool.open, ['first'])
  assert.equal(peak, 1)
  assert.deepEqual(events, ['open:first', 'close:start:first'])

  finishClose()
  await next
  const overtaken = await overtaker
  assert.match(String('error' in overtaken ? overtaken.error : ''), /pool is full/)
  assert.equal(peak, 1, 'a later acquire cannot open while eviction is closing')
  pool.release('next')
  await pool.close()
})

test('pool: idle eviction holds capacity until every close completes', async () => {
  let clock = 0
  let finishClose!: () => void
  let closeStarted!: () => void
  const closeGate = new Promise<void>((resolve) => {
    finishClose = resolve
  })
  const started = new Promise<void>((resolve) => {
    closeStarted = resolve
  })
  let live = 0
  let peak = 0
  const pool = createAdapterPool({
    max: 1,
    idleMs: 100,
    now: () => clock,
    create: (key) => ({
      ...sqliteAdapter(),
      async open() {
        live++
        peak = Math.max(peak, live)
      },
      async close() {
        if (key === 'idle') {
          closeStarted()
          await closeGate
        }
        live--
      },
    }),
  })

  await pool.with('idle', async () => {})
  clock = 500
  const eviction = pool.evictIdle()
  await started
  const acquire = pool.acquire('replacement')
  await Promise.resolve()
  assert.equal(live, 1, 'admission waits behind an in-flight idle close')
  assert.equal(pool.size, 1)
  assert.deepEqual(pool.open, ['idle'])

  finishClose()
  assert.equal(await eviction, 1)
  await acquire
  assert.equal(peak, 1)
  pool.release('replacement')
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
  assert.ok(results.every((r) => r.applied && !r.error))

  for (const key of ['acme', 'globex', 'initech']) {
    const cols = await pool.with(key, (a) => a.introspect())
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
  const older = defineModule({
    name: 'catalog',
    models: {
      Product: {
        scope: 'shared',
        fields: { id: 'id', title: 'text', priceCents: 'int', slug: 'text', active: 'bool' },
      },
    },
  })
  const v1 = compose([older], { headless: true })

  await migrateFleet(pool, ['early'], v1) // tenant created against the old manifest
  await migrateFleet(pool, ['late'], manifest) // tenant created today
  const catchUp = await migrateFleet(pool, ['early'], manifest)

  assert.ok(
    catchUp[0]!.ops.some((op) => op.op === 'ADD_COLUMN'),
    'the older tenant is brought forward',
  )
  const earlyCols = await pool.with('early', (a) => a.introspect())
  const lateCols = await pool.with('late', (a) => a.introspect())
  assert.deepEqual(
    Object.keys(earlyCols['catalog_product']!).sort(),
    Object.keys(lateCols['catalog_product']!).sort(),
  )
  await pool.close()
})

test('migration: dry-run plans without creating framework or application tables', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  try {
    const ops = await migrateOne(adapter, manifest, { dryRun: true })
    assert.ok(ops.length > 0)
    assert.deepEqual(await adapter.introspect(), {}, 'dry-run must be read-only')
  } finally {
    await adapter.close()
  }
})

test('migration: DDL and the applied-schema marker roll back together', async () => {
  const atomicManifest = compose(
    [
      defineModule({
        name: 'atomic',
        models: {
          Entry: {
            scope: 'shared',
            fields: { id: 'id', value: 'text' },
            indexes: { value: { fields: ['value'], unique: true } },
          },
        },
      }),
    ],
    { headless: true },
  )
  const base = sqliteAdapter()
  let injectFailure = true
  const adapter: Adapter = {
    ...base,
    tx: (fn) =>
      base.tx((tx) =>
        fn({
          ...tx,
          exec: async (sql) => {
            if (injectFailure && sql.startsWith('CREATE UNIQUE INDEX'))
              throw new Error('injected DDL failure')
            await tx.exec(sql)
          },
        }),
      ),
  }
  await adapter.open()
  try {
    await assert.rejects(() => migrateOne(adapter, atomicManifest), /injected DDL failure/)
    assert.deepEqual(await adapter.introspect(), {}, 'a failed operation must leave no partial schema')

    injectFailure = false
    await migrateOne(adapter, atomicManifest)
    assert.ok('atomic_entry' in (await adapter.introspect()), 'the same migration is retryable')
    assert.deepEqual(await migrateOne(adapter, atomicManifest), [])
  } finally {
    await adapter.close()
  }
})

test('migration: type, required-column and nullability changes require a hand-written migration', async () => {
  const version = (field: string | null) =>
    compose(
      [
        defineModule({
          name: 'manual',
          models: {
            Entry: {
              scope: 'shared',
              fields: { id: 'id', ...(field === null ? {} : { value: field }) },
            },
          },
        }),
      ],
      { headless: true },
    )

  const optional = version('text?')
  const required = version('text')
  const changedType = version('int?')
  const withoutValue = version(null)

  assert.throws(
    () => planMigration(schemaFromManifest(optional), schemaFromManifest(required)),
    (error: unknown) =>
      (error as { code?: string }).code === 'E_MANUAL_MIGRATION_REQUIRED' &&
      /changes from optional to required/.test((error as Error).message),
  )
  assert.throws(
    () => planMigration(schemaFromManifest(required), schemaFromManifest(optional)),
    (error: unknown) =>
      (error as { code?: string }).code === 'E_MANUAL_MIGRATION_REQUIRED' &&
      /changes from required to optional/.test((error as Error).message),
  )
  assert.throws(
    () => planMigration(schemaFromManifest(withoutValue), schemaFromManifest(required)),
    /required column and existing rows need a backfill/,
  )

  const adapter = sqliteAdapter()
  await adapter.open()
  try {
    await migrateOne(adapter, optional)
    await assert.rejects(
      () => migrateOne(adapter, changedType, { allowDestructive: true }),
      (error: unknown) => (error as { code?: string }).code === 'E_MANUAL_MIGRATION_REQUIRED',
    )
    const applied = await adapter.all('SELECT schema FROM ket_migration WHERE id = 1')
    const recorded = JSON.parse(String(applied[0]?.schema)) as {
      tables: Record<string, { columns: Record<string, { base: string; optional: boolean }> }>
    }
    assert.deepEqual(recorded.tables.manual_entry?.columns.value, {
      sql: 'TEXT',
      base: 'text',
      optional: true,
      by: 'manual',
      target: null,
    })
    assert.equal((await adapter.introspect()).manual_entry?.value, 'TEXT')
  } finally {
    await adapter.close()
  }
})

test('migration: a manual schema is confirmed only after the physical database matches', async () => {
  const version = (value: string | null) =>
    compose(
      [
        defineModule({
          name: 'adopted',
          models: {
            Entry: {
              scope: 'shared',
              fields: { id: 'id', ...(value === null ? {} : { value }) },
            },
          },
        }),
      ],
      { headless: true },
    )
  const before = version(null)
  const automatic = version('int?')
  const target = version('int')
  const adapter = sqliteAdapter()
  await adapter.open()
  try {
    await migrateOne(adapter, before)
    await adapter.run('INSERT INTO "adopted_entry" ("id") VALUES (?)', ['existing'])
    await assert.rejects(
      () => confirmManualMigration(adapter, before),
      (error: unknown) =>
        (error as { code?: string }).code === 'E_MANUAL_MIGRATION_CONFIRMATION' &&
        /already matches the target manifest/.test((error as Error).message),
    )
    await assert.rejects(
      () => confirmManualMigration(adapter, automatic),
      (error: unknown) =>
        (error as { code?: string }).code === 'E_MANUAL_MIGRATION_CONFIRMATION' &&
        /contains no operation that requires a manual migration/.test((error as Error).message),
    )

    await assert.rejects(
      () =>
        adapter.tx(async (tx) => {
          await tx.exec('ALTER TABLE "adopted_entry" ADD COLUMN "value" TEXT')
          await confirmManualMigration(tx, target)
        }),
      (error: unknown) =>
        (error as { code?: string }).code === 'E_MANUAL_MIGRATION_CONFIRMATION' &&
        /has type text; expected integer/.test((error as Error).message) &&
        /is nullable; expected NOT NULL/.test((error as Error).message),
    )
    assert.equal(
      (await adapter.introspect()).adopted_entry?.value,
      undefined,
      'failed confirmation rolls the incorrect DDL back',
    )
    const stale = await adapter.all('SELECT schema FROM ket_migration WHERE id = 1')
    assert.equal(
      JSON.parse(String(stale[0]?.schema)).tables.adopted_entry.columns.value,
      undefined,
      'failed confirmation does not advance the marker',
    )

    const confirmed = await adapter.tx(async (tx) => {
      await tx.exec(`CREATE TABLE "adopted_entry_next" (
        "id" TEXT PRIMARY KEY,
        "value" INTEGER NOT NULL
      )`)
      await tx.exec('INSERT INTO "adopted_entry_next" ("id", "value") SELECT "id", 0 FROM "adopted_entry"')
      await tx.exec('DROP TABLE "adopted_entry"')
      await tx.exec('ALTER TABLE "adopted_entry_next" RENAME TO "adopted_entry"')
      return confirmManualMigration(tx, target)
    })
    assert.deepEqual(
      confirmed.map((op) => op.op),
      ['ADD_COLUMN'],
    )
    assert.deepEqual(await migrateOne(adapter, target), [], 'the database now converges normally')
    assert.deepEqual(
      (await adapter.all('SELECT "id", "value" FROM "adopted_entry"')).map((row) => ({ ...row })),
      [{ id: 'existing', value: 0 }],
    )
  } finally {
    await adapter.close()
  }
})

test('migration: a partial index cannot satisfy manual confirmation', async () => {
  const version = (withValue: boolean) =>
    compose(
      [
        defineModule({
          name: 'partial_guard',
          models: {
            Entry: {
              scope: 'shared',
              fields: { id: 'id', ...(withValue ? { value: 'text' } : {}) },
              ...(withValue ? { indexes: { value: { fields: ['value'], unique: true } } } : {}),
            },
          },
        }),
      ],
      { headless: true },
    )
  const before = version(false)
  const target = version(true)
  const adapter = sqliteAdapter()
  await adapter.open()
  try {
    await migrateOne(adapter, before)
    await adapter.exec('ALTER TABLE "partial_guard_entry" ADD COLUMN "value" TEXT NOT NULL DEFAULT \'seed\'')
    await adapter.exec(
      'CREATE UNIQUE INDEX "partial_guard_entry__value" ON "partial_guard_entry" ("value") WHERE 0',
    )

    await assert.rejects(
      () => confirmManualMigration(adapter, target),
      (error: unknown) =>
        (error as { code?: string }).code === 'E_MANUAL_MIGRATION_CONFIRMATION' &&
        /index partial_guard_entry__value is partial/.test((error as Error).message),
    )

    await adapter.run('INSERT INTO "partial_guard_entry" ("id", "value") VALUES (?, ?)', [
      'first',
      'duplicate',
    ])
    await adapter.run('INSERT INTO "partial_guard_entry" ("id", "value") VALUES (?, ?)', [
      'second',
      'duplicate',
    ])
    assert.equal(
      Number(
        (
          await adapter.all('SELECT COUNT(*) AS count FROM "partial_guard_entry" WHERE "value" = ?', [
            'duplicate',
          ])
        )[0]?.count,
      ),
      2,
      'the rejected partial index does not enforce the target uniqueness contract',
    )
    await assert.rejects(
      () => migrateOne(adapter, target),
      (error: unknown) => (error as { code?: string }).code === 'E_MANUAL_MIGRATION_REQUIRED',
      'failed confirmation must not advance the schema marker',
    )
  } finally {
    await adapter.close()
  }
})

test('migration: a PostgreSQL expression index cannot masquerade as a model index', async () => {
  const version = (withValue: boolean) =>
    compose(
      [
        defineModule({
          name: 'pg_expression',
          models: {
            Entry: {
              scope: 'shared',
              fields: { id: 'id', ...(withValue ? { value: 'text' } : {}) },
              ...(withValue ? { indexes: { value: { fields: ['value'], unique: true } } } : {}),
            },
          },
        }),
      ],
      { headless: true },
    )
  const before = version(false)
  const target = version(true)
  const base = sqliteAdapter()
  const adapter: Adapter = {
    ...base,
    name: 'postgres',
    transaction: true,
    introspect: async () => ({ ket_migration: { schema: 'TEXT' } }),
    all: async (sql) => {
      if (sql.includes('SELECT schema FROM ket_migration'))
        return [{ schema: JSON.stringify(schemaFromManifest(before)) }]
      if (sql.includes('information_schema.columns'))
        return [
          { column_name: 'id', data_type: 'text', is_nullable: 'NO' },
          { column_name: 'value', data_type: 'text', is_nullable: 'NO' },
        ]
      if (sql.includes('information_schema.table_constraints')) return [{ column_name: 'id' }]
      if (sql.includes('FROM pg_class table_class')) {
        assert.match(sql, /LEFT JOIN pg_attribute/)
        const index = {
          index_name: 'pg_expression_entry__value',
          is_unique: true,
          is_partial: false,
          is_valid: true,
          is_ready: true,
          is_live: true,
        }
        return [
          { ...index, is_expression: false, column_name: 'value', position: 1 },
          { ...index, is_expression: true, column_name: null, position: 2 },
        ]
      }
      throw new Error(`unexpected PostgreSQL catalog query: ${sql}`)
    },
    run: async () => {
      throw new Error('an expression index must not advance the schema marker')
    },
  }

  await assert.rejects(
    () => confirmManualMigration(adapter, target),
    (error: unknown) =>
      (error as { code?: string }).code === 'E_MANUAL_MIGRATION_CONFIRMATION' &&
      /index pg_expression_entry__value contains expressions/.test((error as Error).message) &&
      /covers \(value, <expression>\); expected \(value\)/.test((error as Error).message),
  )
})

test('fleet: one failing tenant does not stop the others, and says so', async () => {
  const pool = createAdapterPool({
    create: (key) =>
      key === 'broken'
        ? {
            ...sqliteAdapter(),
            open: async () => {
              throw new Error('cannot reach database')
            },
          }
        : create(key),
  })
  const results = await migrateFleet(pool, ['good1', 'broken', 'good2'], manifest)
  assert.equal(results.filter((r) => r.applied).length, 2)
  assert.match(results.find((r) => r.datastore === 'broken')!.error!, /cannot reach database/)
  assert.match(formatFleet(results), /FAIL {2}broken/)
})

test('fleet: destructive changes are refused per tenant, not silently applied', async () => {
  const pool = createAdapterPool({ create })
  await migrateFleet(pool, ['shrink'], manifest)
  const shrunk = compose(
    [defineModule({ name: 'catalog', models: { Product: { scope: 'shared', fields: { id: 'id' } } } })],
    { headless: true },
  )
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
    manifest,
    pool,
    resolveDatastore: (url) => url.searchParams.get('tenant') ?? null,
    theme: createTheme(manifest, mods),
    pageScope: () => ({ site: { title: 'x' }, product: { id: 'p', title: 't', priceCents: 1 }, related: [] }),
  })
  const port = await app.listen(0)
  const base = `http://127.0.0.1:${port}`

  const create_ = (tenant: string, id: string, title: string) =>
    fetch(`${base}/_ket/fn/catalog.createProduct?tenant=${tenant}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, title, priceCents: 1000, slug: id }),
    }).then((r) => r.json())

  await create_('acme.test', 'p1', 'của acme')
  await create_('globex.test', 'p2', 'của globex')

  const acme = (await fetch(`${base}/_ket/fn/catalog.listProducts?tenant=acme.test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }).then((r) => r.json())) as { value: Array<{ id: string }> }
  const globex = (await fetch(`${base}/_ket/fn/catalog.listProducts?tenant=globex.test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }).then((r) => r.json())) as { value: Array<{ id: string }> }

  assert.deepEqual(
    acme.value.map((p) => p.id),
    ['p1'],
  )
  assert.deepEqual(
    globex.value.map((p) => p.id),
    ['p2'],
    'no tenant may see another tenant data',
  )

  const unknown = await fetch(`${base}/_ket/fn/catalog.listProducts?tenant=`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(unknown.status, 400)
  assert.equal(((await unknown.json()) as { code: string }).code, 'E_UNKNOWN_TENANT')

  await app.close()
  await pool.close()
})

test('tables: a framework table only appears once something uses it', async () => {
  const a = sqliteAdapter()
  await a.open()
  await migrateOne(a, manifest)
  assert.deepEqual(
    Object.keys(await a.introspect()).sort(),
    ['catalog_product', 'checkout_order', 'ket_migration'],
    'migrating creates the app schema and the version record, nothing else',
  )

  registerFunctions(mods)
  const app = await createKetServer({ manifest, adapter: a })
  assert.equal(
    'ket_stream' in (await a.introspect()),
    false,
    'an app that never streams gets no stream table',
  )

  const w = await app.streams.open('s')
  w.write('x')
  await w.end()
  assert.equal('ket_stream' in (await a.introspect()), true, 'it appears on first use')
  assert.equal('ket_idem' in (await a.introspect()), false, 'and still no idempotency table')

  await callFn(
    'catalog.createProduct',
    { id: 'i1', title: 'T', priceCents: 1, slug: 'i' },
    { adapter: a, manifest, idempotencyKey: 'k' },
  )
  assert.equal('ket_idem' in (await a.introspect()), true, 'which appears the first time a key is used')
  await app.close()
  await a.close()
})

test('idempotency: a claim abandoned by a dead caller is taken over, not blocked forever', async () => {
  const a = sqliteAdapter()
  await a.open()
  await migrateOne(a, manifest)
  let clock = Date.parse('2026-08-19T00:00:00.000Z')
  const idem = await createIdempotency(a, { now: () => new Date(clock).toISOString() })

  assert.equal(await idem.claim('k1', 'fn'), true)
  assert.equal(await idem.claim('k1', 'fn'), false, 'still held while fresh')

  clock += 6 * 60_000 // the caller died six minutes ago
  assert.equal(await idem.claim('k1', 'fn'), true, 'a stale claim is taken over')
  await a.close()
})

test('idempotency: finished records expire, so the table does not grow forever', async () => {
  const a = sqliteAdapter()
  await a.open()
  await migrateOne(a, manifest)
  let clock = Date.parse('2026-08-19T00:00:00.000Z')
  const idem = await createIdempotency(a, { now: () => new Date(clock).toISOString() })
  await idem.claim('old', 'fn')
  await idem.complete('old', { ok: true })

  assert.equal(await idem.sweep(), 0, 'nothing is stale yet')
  clock += 25 * 60 * 60_000
  assert.equal(await idem.sweep(), 1, 'a day later it goes')
  assert.equal(await idem.read('old'), null)
  await a.close()
})
