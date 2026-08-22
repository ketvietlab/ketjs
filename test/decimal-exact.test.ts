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
import type { Row } from '@ketvietlab/ketjs'

const ledger = defineModule({
  name: 'ledger',
  models: { Entry: { scope: 'shared', fields: { id: 'id', amount: 'decimal', note: 'text' } } },
  functions: {
    put: {
      input: { id: 'id', amount: 'decimal', note: 'text' },
      output: { id: 'id', amount: 'decimal', note: 'text' },
      effects: ['write:ledger.Entry'],
      handler: async (ctx, args) => {
        await ctx.db.insert('ledger.Entry', args)
        return args
      },
    },
    read: {
      input: { id: 'id' },
      output: { id: 'id', amount: 'decimal', note: 'text' },
      effects: ['read:ledger.Entry'],
      handler: async (ctx, args) => (await ctx.db.select('ledger.Entry', { id: args.id }))[0],
    },
    /** The ordinary way to edit one field: read the row, spread it, change the other one. */
    renote: {
      input: { id: 'id', note: 'text' },
      output: { ok: 'bool' },
      effects: ['read:ledger.Entry', 'write:ledger.Entry'],
      handler: async (ctx, args) => {
        const row = (await ctx.db.select('ledger.Entry', { id: args.id }))[0]!
        await ctx.db.update('ledger.Entry', { id: args.id }, { ...row, note: args.note })
        return { ok: true }
      },
    },
  },
})

const boot = async () => {
  const manifest = compose([ledger])
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions([ledger])
  return { adapter, manifest }
}

// Scale that a float drops, and a magnitude past Number.MAX_SAFE_INTEGER.
const AMOUNTS = ['12.50', '0.000001', '860000', '9007199254740993.25', '1234567890123456.78']

test('decimal: a read gives back exactly what the column holds', async (t) => {
  const { adapter, manifest } = await boot()
  t.after(() => adapter.close())
  for (const amount of AMOUNTS) {
    await callFn('ledger.put', { id: amount, amount, note: 'a' }, { adapter, manifest })
    const row = (await callFn('ledger.read', { id: amount }, { adapter, manifest })).value as Row
    assert.equal(row.amount, amount, `read of ${amount}`)
    assert.equal(typeof row.amount, 'string')
  }
})

test('decimal: editing another column leaves the amount byte for byte', async (t) => {
  const { adapter, manifest } = await boot()
  t.after(() => adapter.close())
  for (const amount of AMOUNTS) {
    await callFn('ledger.put', { id: amount, amount, note: 'a' }, { adapter, manifest })
    await callFn('ledger.renote', { id: amount, note: 'b' }, { adapter, manifest })
    const stored = (await adapter.all('SELECT amount, note FROM ledger_entry WHERE id = ?', [amount]))[0]!
    assert.equal(stored.note, 'b')
    assert.equal(stored.amount, amount, `${amount} survived an unrelated edit`)
  }
})

test('decimal: a computed write still renders a number', async (t) => {
  const { adapter, manifest } = await boot()
  t.after(() => adapter.close())
  // Arithmetic is the caller's, and its result is stored the way it is written.
  await callFn('ledger.put', { id: 'computed', amount: 0.1 + 0.2, note: 'a' }, { adapter, manifest })
  const row = (await callFn('ledger.read', { id: 'computed' }, { adapter, manifest })).value as Row
  assert.equal(row.amount, '0.30000000000000004')
})
