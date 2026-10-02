import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  callFn,
  compose,
  defineModule,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { adminUrl, live } from './postgres-live.ts'

const clock = defineModule({
  name: 'clock',
  models: {
    Entry: {
      scope: 'shared',
      fields: { id: 'id', at: 'datetime', on: 'date', amount: 'decimal', count: 'int' },
    },
  },
  functions: {
    put: {
      input: { id: 'id', at: 'datetime', on: 'date', amount: 'decimal', count: 'int' },
      output: { ok: 'bool' },
      effects: ['write:clock.Entry'],
      handler: async (ctx, args) => {
        await ctx.db.insert('clock.Entry', args)
        return { ok: true }
      },
    },
    read: {
      input: { id: 'id' },
      output: { id: 'id', at: 'datetime', on: 'date', amount: 'decimal', count: 'int' },
      effects: ['read:clock.Entry'],
      handler: async (ctx, args) => (await ctx.db.select('clock.Entry', { id: args.id }))[0],
    },
  },
})

const manifest = compose([clock], { headless: true })
registerFunctions([clock])

// An offset that is not UTC, so "did the write normalise" has a visible answer.
const WRITTEN = { at: '2026-08-22T17:00:00+07:00', on: '2026-08-22', amount: '12.50', count: 3 }
const EXPECTED = { at: '2026-08-22T10:00:00.000Z', on: '2026-08-22', amount: '12.50' }

const roundTrip = async (adapter: Adapter): Promise<Row> => {
  await migrateOne(adapter, manifest)
  const o = { adapter, manifest }
  await callFn('clock.put', { id: 'e1', ...WRITTEN }, o)
  return (await callFn('clock.read', { id: 'e1' }, o)).value as Row
}

test('datetime: a stored instant is ISO-8601 UTC text, whatever offset was written', async (t) => {
  const adapter = sqliteAdapter()
  await adapter.open()
  t.after(() => adapter.close())
  const row = await roundTrip(adapter)
  assert.equal(row.at, EXPECTED.at)
  assert.equal(typeof row.at, 'string')
  assert.equal(row.on, EXPECTED.on, 'a calendar date stays a calendar date')
  assert.equal(typeof row.on, 'string')
})

test('datetime: both datastores answer with the same bytes', live, async () => {
  const database = `ket_clock_${process.pid}_${Date.now()}`
  const databaseUrl = new URL(adminUrl)
  databaseUrl.pathname = `/${database}`
  const admin = postgresAdapter(adminUrl.toString(), { max: 1 })
  try {
    await admin.open()
    await admin.run(`CREATE DATABASE "${database}"`)
  } finally {
    await admin.close().catch(() => {})
  }

  const sqlite = sqliteAdapter()
  const postgres = postgresAdapter(databaseUrl.toString(), { max: 2 })
  try {
    await sqlite.open()
    await postgres.open()
    const fromSqlite = await roundTrip(sqlite)
    const fromPostgres = await roundTrip(postgres)
    for (const column of ['at', 'on', 'amount'] as const) {
      assert.equal(fromPostgres[column], fromSqlite[column], `${column} differs between datastores`)
      assert.equal(fromPostgres[column], EXPECTED[column], `${column} is not the stored text`)
      assert.equal(typeof fromPostgres[column], 'string', `${column} did not arrive as text`)
    }
    // An int is a BIGINT column, which the driver would hand back as the string "3".
    assert.equal(fromPostgres.count, fromSqlite.count, 'int differs between datastores')
    assert.equal(fromPostgres.count, 3)
  } finally {
    await sqlite.close().catch(() => {})
    await postgres.close().catch(() => {})
    const cleanup = postgresAdapter(adminUrl.toString(), { max: 1 })
    await cleanup.open()
    await cleanup.run(`DROP DATABASE IF EXISTS "${database}"`)
    await cleanup.close()
  }
})
