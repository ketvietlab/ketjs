import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  callFn,
  compose,
  createIdempotency,
  eq,
  from,
  planMigration,
  registerFunctions,
  renderSql,
  schemaFromManifest,
  sqliteAdapter,
  table,
} from 'ketjs'
import type { Adapter } from 'ketjs'
import { postgresAdapter } from 'ketjs-postgres'
import { catalog, checkout, defaultTheme as theme, inventory } from 'ketsuite'

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

test('idempotency: a key claimed but not finished is reported, not silently re-run', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  for (const sql of renderSql(planMigration(null, schemaFromManifest(manifest)), adapter))
    await adapter.exec(sql)
  registerFunctions(mods)

  // Stand in for another instance that claimed the key and has not finished.
  const idem = await createIdempotency(adapter)
  const claimed = await idem.claim('catalog.createProduct:k9', 'catalog.createProduct')
  assert.equal(claimed, true)
  assert.equal(
    await idem.claim('catalog.createProduct:k9', 'catalog.createProduct'),
    false,
    'the primary key settles the race',
  )

  await assert.rejects(
    () =>
      callFn(
        'catalog.createProduct',
        { id: 'p2', title: 'B', priceCents: 1, slug: 'b' },
        { adapter, manifest, idempotencyKey: 'k9' },
      ),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_IDEMPOTENCY_IN_FLIGHT')
      return true
    },
  )
  await adapter.close()
})
