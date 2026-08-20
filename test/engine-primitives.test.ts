import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  callFn,
  compose,
  defineFn,
  defineModule,
  planMigration,
  registerFunctions,
  renderSql,
  schemaFromManifest,
  sqliteAdapter,
} from 'ketjs'

const ledger = defineModule({
  name: 'ledger',
  models: {
    Balance: {
      scope: 'shared',
      fields: { id: 'id', account: 'text', amount: 'decimal', version: 'int', active: 'bool' },
      indexes: { account_unique: { fields: ['account'], unique: true } },
    },
  },
  functions: {
    put: defineFn({
      input: { id: 'id', account: 'text', amount: 'decimal' },
      effects: ['write:ledger.Balance'],
      handler: (ctx, a) =>
        ctx.db.insertIfAbsent('ledger.Balance', {
          id: a.id,
          account: a.account,
          amount: a.amount,
          version: 0,
          active: true,
        }),
    }),
    advance: defineFn({
      input: { id: 'id', version: 'int', amount: 'decimal' },
      effects: ['write:ledger.Balance'],
      handler: (ctx, a) =>
        ctx.db.compareAndSet(
          'ledger.Balance',
          { id: a.id },
          { version: a.version, active: true },
          { amount: a.amount, version: Number(a.version) + 1 },
        ),
    }),
  },
})

async function boot() {
  const manifest = compose([ledger], { headless: true })
  const adapter = sqliteAdapter()
  await adapter.open()
  for (const sql of renderSql(planMigration(null, schemaFromManifest(manifest)), adapter))
    await adapter.exec(sql)
  registerFunctions([ledger])
  return { adapter, manifest }
}

test('engine: named unique indexes are part of the schema and migration SQL', () => {
  const manifest = compose([ledger], { headless: true })
  const schema = schemaFromManifest(manifest)
  assert.deepEqual(schema.tables.ledger_balance!.indexes.account_unique, {
    fields: ['account'],
    unique: true,
    by: 'ledger',
  })
  const sql = renderSql(planMigration(null, schema), sqliteAdapter()).join('\n')
  assert.match(sql, /CREATE UNIQUE INDEX "ledger_balance__account_unique"/)
})

test('engine: exact decimal strings are accepted and malformed decimals are rejected', async () => {
  const { adapter, manifest } = await boot()
  try {
    await callFn(
      'ledger.put',
      { id: 'b1', account: 'cash', amount: '0.1000000000000000001' },
      { adapter, manifest },
    )
    const row = (await adapter.all('SELECT amount FROM ledger_balance WHERE id = ?', ['b1']))[0]!
    assert.equal(row.amount, '0.1000000000000000001')
    await assert.rejects(
      () => callFn('ledger.put', { id: 'b2', account: 'bank', amount: '1e3' }, { adapter, manifest }),
      (error: unknown) => (error as { code: string }).code === 'E_INVALID_INPUT',
    )
  } finally {
    await adapter.close()
  }
})

test('engine: insertIfAbsent and compareAndSet expose race outcomes without throwing', async () => {
  const { adapter, manifest } = await boot()
  try {
    const first = await callFn(
      'ledger.put',
      { id: 'b1', account: 'cash', amount: '1.00' },
      { adapter, manifest },
    )
    const duplicate = await callFn(
      'ledger.put',
      { id: 'b2', account: 'cash', amount: '2.00' },
      { adapter, manifest },
    )
    assert.deepEqual(first.value, { changes: 1, inserted: true })
    assert.deepEqual(duplicate.value, { changes: 0, inserted: false })

    const won = await callFn(
      'ledger.advance',
      { id: 'b1', version: 0, amount: '3.00' },
      { adapter, manifest },
    )
    const stale = await callFn(
      'ledger.advance',
      { id: 'b1', version: 0, amount: '4.00' },
      { adapter, manifest },
    )
    assert.deepEqual(won.value, { changes: 1, matched: true })
    assert.deepEqual(stale.value, { changes: 0, matched: false })
  } finally {
    await adapter.close()
  }
})
