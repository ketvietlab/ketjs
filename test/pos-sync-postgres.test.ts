import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, tableNameFor } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import {
  account,
  address,
  channelApi,
  company,
  partner,
  pos,
  posChannel,
  pricing,
  product,
  stock,
  uom,
  user,
  website,
} from '@ketvietlab/ketsuite'

const configured =
  process.env.KET_TEST_PG ?? process.env.DATABASE_URL ?? 'postgres://dev:devpassword@127.0.0.1:5435/ketjs_dev'
const adminUrl = new URL(configured)
adminUrl.pathname = '/postgres'

const reachable = await (async () => {
  const adapter = postgresAdapter(adminUrl.toString())
  try {
    await adapter.open()
    await adapter.all('SELECT 1')
    await adapter.close()
    return true
  } catch {
    await adapter.close().catch(() => {})
    return false
  }
})()

const live = { skip: reachable ? false : `no PostgreSQL at ${adminUrl.toString()}` }
const modules = [
  address,
  partner,
  company,
  user,
  website,
  channelApi,
  uom,
  product,
  pricing,
  stock,
  account,
  pos,
  posChannel,
]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }
const call = (adapter: Adapter, name: string, input: Record<string, unknown>) =>
  callFn(name, input, { adapter, manifest, scope })

test('pos sync PostgreSQL: concurrent duplicate claims keep one durable command', live, async () => {
  const database = `ket_pos_sync_${process.pid}_${Date.now()}`
  const databaseUrl = new URL(adminUrl)
  databaseUrl.pathname = `/${database}`
  const admin = postgresAdapter(adminUrl.toString(), { max: 1 })
  const first = postgresAdapter(databaseUrl.toString(), { max: 2 })
  const second = postgresAdapter(databaseUrl.toString(), { max: 2 })
  await admin.open()
  await admin.exec(`CREATE DATABASE "${database}"`)
  try {
    await Promise.all([first.open(), second.open()])
    await migrateOne(first, manifest)
    registerFunctions(modules)
    const request = {
      id: 'sync-command-1',
      commandId: 'sync-command-1',
      deviceId: 'device-1',
      configId: 'shop',
      operatorId: 'cashier',
      sequence: 1,
      operation: 'pos.orders.create',
      aggregateType: 'order',
      aggregateId: 'local-order-1',
      aggregateRevision: 0,
      dependencyIds: [],
      capturedAt: new Date().toISOString(),
      idempotencyKey: 'sync-command-1',
      requestHash: 'same-request-hash',
      request: { aggregateId: 'local-order-1' },
    }
    const results = await Promise.all([
      call(first, 'pos_channel.claimSyncCommand', request),
      call(second, 'pos_channel.claimSyncCommand', request),
    ])
    const values = results.map((result) => result.value as Row)
    assert.equal(values.filter((value) => value.ok && value.replayed === false).length, 1)
    assert.equal(values.filter((value) => value.reason === 'command_in_flight').length, 1)
    const table = first.quoteIdent(tableNameFor('pos_channel.SyncCommand'))
    const commands = await first.all(
      `SELECT "commandId", state, attempts FROM ${table} WHERE "commandId" = $1`,
      ['sync-command-1'],
    )
    assert.deepEqual([...commands], [{ commandId: 'sync-command-1', state: 'processing', attempts: 1 }])
  } finally {
    await Promise.all([first.close().catch(() => {}), second.close().catch(() => {})])
    await admin.exec(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(() => {})
    await admin.close()
  }
})
