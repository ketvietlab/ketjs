import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  callFn,
  compose,
  createIdempotency,
  defineModule,
  eq,
  from,
  planMigration,
  registerFunctions,
  renderSql,
  schemaFromManifest,
  sqliteAdapter,
  table,
} from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { catalog, checkout, defaultTheme as theme, inventory } from '@ketvietlab/ketsuite'

const mods = [catalog, inventory, checkout, theme]
const manifest = compose(mods)

// A recording stand-in for the driver. The adapter is exercised for real; only the
// socket is replaced, so no live server is needed to prove the SQL it emits.
function fakeDriver() {
  const calls: Array<{ text: string; params: unknown[] }> = []
  const listeners = new Map<string, (payload: string) => void>()
  const handle = (tag: string) => {
    const h = {
      unsafe(text: string, params: unknown[] = []) {
        calls.push({ text: `${tag}${text}`, params })
        return Promise.resolve(Object.assign([] as unknown[], { count: 1 }))
      },
      reserve: () =>
        Promise.resolve(
          Object.assign(handle('[tx] '), {
            release() {
              calls.push({ text: '[tx] RELEASE', params: [] })
            },
          }),
        ),
      end: () => Promise.resolve(),
      async listen(channel: string, onMessage: (payload: string) => void, onReady?: () => void) {
        calls.push({ text: `${tag}LISTEN ${channel}`, params: [] })
        listeners.set(channel, onMessage)
        onReady?.()
        return {
          async unlisten() {
            calls.push({ text: `${tag}UNLISTEN ${channel}`, params: [] })
            listeners.delete(channel)
          },
        }
      },
    }
    return h
  }
  return {
    calls,
    connect: () => handle('') as never,
    notify: (channel: string, payload: string) => listeners.get(channel)?.(payload),
  }
}

async function pg(): Promise<{ adapter: Adapter; calls: Array<{ text: string; params: unknown[] }> }> {
  const d = fakeDriver()
  const adapter = postgresAdapter('postgres://x/y', { connect: d.connect })
  await adapter.open()
  return { adapter, calls: d.calls }
}

test('postgres: the query layer renders $n placeholders for this dialect', async () => {
  const { adapter, calls } = await pg()
  const P = table(manifest, 'catalog.Product')
  const { text, params } = from(P).where(eq(P.id!, 'p1')).limit(1).toSQL('postgres')
  await adapter.all(text, params)
  assert.match(calls[0]!.text, /"id" = \$1 LIMIT \$2/)
  assert.deepEqual(calls[0]!.params, ['p1', 1])
  await adapter.close()
})

test('postgres: column types differ from sqlite where the dialects differ', async () => {
  const { adapter } = await pg()
  const lite = sqliteAdapter()
  const cols = [
    { base: 'bool' as const },
    { base: 'json' as const },
    { base: 'datetime' as const },
    { base: 'int' as const },
  ]
  assert.deepEqual(
    cols.map((c) => adapter.columnSql(c)),
    ['BOOLEAN', 'JSONB', 'TIMESTAMPTZ', 'BIGINT'],
  )
  assert.deepEqual(
    cols.map((c) => lite.columnSql(c)),
    ['INTEGER', 'TEXT', 'TEXT', 'INTEGER'],
  )
  await adapter.close()
})

test('postgres: one schema, two dialects, from the same manifest', async () => {
  const { adapter } = await pg()
  const ops = planMigration(null, schemaFromManifest(manifest))
  const sql = renderSql(ops, adapter).join('\n')
  assert.match(sql, /"active" BOOLEAN NOT NULL/)
  assert.match(sql, /"placedAt" TIMESTAMPTZ/)
  assert.match(sql, /"leadTimeDays" BIGINT/)
  await adapter.close()
})

test('postgres: a transaction runs BEGIN and the body on one reserved connection', async () => {
  const { adapter, calls } = await pg()
  await adapter.tx(async (tx) => {
    await tx.run('UPDATE t SET a = $1', [1])
  })
  const texts = calls.map((c) => c.text)
  assert.deepEqual(texts, ['[tx] BEGIN', '[tx] UPDATE t SET a = $1', '[tx] COMMIT', '[tx] RELEASE'])
  assert.ok(
    texts.every((t) => t.startsWith('[tx] ')),
    'BEGIN and the body must share a session, not two pooled connections',
  )
  await adapter.close()
})

test('postgres: a failing transaction rolls back and still releases', async () => {
  const { adapter, calls } = await pg()
  await assert.rejects(() =>
    adapter.tx(async (tx) => {
      await tx.run('X')
      throw new Error('boom')
    }),
  )
  assert.deepEqual(
    calls.map((c) => c.text),
    ['[tx] BEGIN', '[tx] X', '[tx] ROLLBACK', '[tx] RELEASE'],
  )
  await adapter.close()
})

test('postgres: a transaction-scoped adapter expires after commit and rollback', async () => {
  const { adapter, calls } = await pg()
  let committed!: Adapter
  await adapter.tx(async (tx) => {
    committed = tx
  })
  const afterCommit = calls.length
  await assert.rejects(
    () => committed.run('UPDATE after_commit'),
    /transaction-scoped adapter used after its transaction ended/,
  )
  assert.equal(calls.length, afterCommit, 'an expired adapter must not reach the released connection')

  let rolledBack!: Adapter
  await assert.rejects(
    () =>
      adapter.tx(async (tx) => {
        rolledBack = tx
        throw new Error('rollback body')
      }),
    /rollback body/,
  )
  const afterRollback = calls.length
  await assert.rejects(
    () => rolledBack.all('SELECT after_rollback'),
    /transaction-scoped adapter used after its transaction ended/,
  )
  assert.equal(calls.length, afterRollback, 'rollback also expires the scoped adapter before release')
  await adapter.close()
})

test('postgres: notifications publish on the transaction connection and LISTEN can unsubscribe', async () => {
  const driver = fakeDriver()
  const adapter = postgresAdapter('postgres://x/y', { connect: driver.connect })
  await adapter.open()
  const received: string[] = []
  let ready = 0
  const unsubscribe = await adapter.notifications?.subscribe?.(
    'ket_job_ready',
    (payload) => received.push(payload),
    () => ready++,
  )
  driver.notify('ket_job_ready', 'default')
  await adapter.tx((tx) => tx.notifications!.publish('ket_job_ready', 'maintenance'))
  await unsubscribe?.()

  assert.equal(ready, 1)
  assert.deepEqual(received, ['default'])
  assert.deepEqual(
    driver.calls.map((call) => call.text),
    [
      'LISTEN ket_job_ready',
      '[tx] BEGIN',
      '[tx] SELECT pg_notify($1, $2)',
      '[tx] COMMIT',
      '[tx] RELEASE',
      'UNLISTEN ket_job_ready',
    ],
  )
  await adapter.close()
})

test('postgres: the driver is only loaded when the adapter is actually opened', async () => {
  const adapter = postgresAdapter('postgres://x/y')
  assert.equal(adapter.name, 'postgres') // constructing it imports nothing
  await assert.rejects(() => adapter.all('SELECT 1'), /not open/)
})

test('idempotency: a record survives a restart because it lives in the log', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  for (const sql of renderSql(planMigration(null, schemaFromManifest(manifest)), adapter))
    await adapter.exec(sql)
  registerFunctions(mods)

  const args = { id: 'p1', title: 'Áo', priceCents: 5000, slug: 'ao' }
  const first = await callFn('catalog.createProduct', args, { adapter, manifest, idempotencyKey: 'k1' })
  assert.equal(first.replayed, undefined)

  // Simulate a process restart: fresh registry, nothing kept in memory.
  registerFunctions(mods)
  const second = await callFn('catalog.createProduct', args, { adapter, manifest, idempotencyKey: 'k1' })
  assert.equal(second.replayed, true, 'the record must come back from the database, not from a Map')
  assert.equal((await adapter.all('SELECT * FROM catalog_product', [])).length, 1)
  await adapter.close()
})

test('idempotency: legacy tables gain request digests without losing records', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  await adapter.exec(`CREATE TABLE ket_idem (
    key TEXT PRIMARY KEY, fn TEXT NOT NULL, state TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL
  )`)
  await adapter.run(`INSERT INTO ket_idem (key, fn, state, result, created_at) VALUES (?, ?, 'done', ?, ?)`, [
    'legacy',
    'legacy.fn',
    JSON.stringify({ ok: true }),
    new Date().toISOString(),
  ])
  const idem = await createIdempotency(adapter)
  assert.ok((await adapter.introspect()).ket_idem!.digest)
  assert.deepEqual(await idem.read('legacy'), { state: 'done', result: { ok: true }, digest: null })
  await adapter.close()
})

test('idempotency: a key claimed but not finished is reported, not silently re-run', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  for (const sql of renderSql(planMigration(null, schemaFromManifest(manifest)), adapter))
    await adapter.exec(sql)
  let entered!: () => void
  let finish!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const gate = new Promise<void>((resolve) => {
    finish = resolve
  })
  const pending = defineModule({
    name: 'pending',
    functions: {
      hold: {
        input: { id: 'id' },
        idempotent: true,
        handler: async () => {
          entered()
          await gate
          return { ok: true }
        },
      },
    },
  })
  const pendingManifest = compose([...mods, pending])
  registerFunctions([...mods, pending])
  const first = callFn(
    'pending.hold',
    { id: 'p2' },
    { adapter, manifest: pendingManifest, idempotencyKey: 'k9' },
  )
  await started

  await assert.rejects(
    () => callFn('pending.hold', { id: 'p2' }, { adapter, manifest: pendingManifest, idempotencyKey: 'k9' }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_IDEMPOTENCY_IN_FLIGHT')
      return true
    },
  )
  finish()
  await first
  await adapter.close()
})
