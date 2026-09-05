import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'

test('sqlite: root operations wait for a transaction and cannot be rolled back with it', async (t) => {
  const adapter = sqliteAdapter()
  await adapter.open()
  t.after(() => adapter.close())
  await adapter.exec('CREATE TABLE item (id TEXT PRIMARY KEY)')

  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let escaped!: Adapter

  const transaction = adapter.tx(async (tx) => {
    escaped = tx
    assert.equal(tx.transaction, true)
    await tx.run('INSERT INTO item (id) VALUES (?)', ['rolled-back'])
    entered()
    await gate
    throw new Error('roll back transaction')
  })
  await started

  // This uses the root adapter while the transaction body is suspended. It must
  // queue behind COMMIT/ROLLBACK rather than silently join that transaction.
  const outside = adapter.run('INSERT INTO item (id) VALUES (?)', ['survives'])
  release()
  await assert.rejects(transaction, /roll back transaction/)
  await outside

  assert.deepEqual(
    (await adapter.all('SELECT id FROM item ORDER BY id')).map((row) => row.id),
    ['survives'],
  )
  await assert.rejects(
    () => escaped.all('SELECT 1'),
    /transaction-scoped adapter used after its transaction ended/,
  )
})

test('sqlite: using the root adapter inside its transaction fails fast instead of deadlocking', async (t) => {
  const adapter = sqliteAdapter()
  await adapter.open()
  t.after(() => adapter.close())
  await adapter.exec('CREATE TABLE item (id TEXT PRIMARY KEY)')

  await assert.rejects(
    adapter.tx(async (tx) => {
      await tx.run('INSERT INTO item (id) VALUES (?)', ['rolled-back'])
      await adapter.all('SELECT id FROM item')
    }),
    /use the transaction-scoped adapter/,
  )

  assert.deepEqual(await adapter.all('SELECT id FROM item'), [], 'the failed callback is rolled back')
  await adapter.run('INSERT INTO item (id) VALUES (?)', ['still-usable'])
  assert.deepEqual(
    (await adapter.all('SELECT id FROM item')).map((row) => row.id),
    ['still-usable'],
  )
})
