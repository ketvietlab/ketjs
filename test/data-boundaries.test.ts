import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  callFn,
  compose,
  defineFormSchema,
  defineModule,
  desc,
  from,
  ilike,
  like,
  likeLiteral,
  migrateOne,
  numericCompare,
  parseDateTime,
  sqliteAdapter,
  validateForm,
} from '@ketvietlab/ketjs'
import type { Ctx, Expr } from '@ketvietlab/ketjs'

/**
 * Values that reach SQL text or storage from a request. A query operator or sort
 * direction is written into SQL as a token, so it must be one of a fixed few; a
 * date, date-time or integer has one reading, whichever path wrote it and
 * whichever timezone the server process runs in.
 */
const sales = defineModule({
  name: 'sales',
  models: {
    Order: { scope: 'company', fields: { id: 'id', total: 'decimal', on: 'date?', at: 'datetime?' } },
  },
  functions: {
    seed: {
      input: { row: 'json' },
      effects: ['write:sales.Order'],
      handler: async (ctx: Ctx, input) =>
        ctx.db.insert('sales.Order', input['row'] as Record<string, unknown>),
    },
    search: {
      input: { op: 'text', dir: 'text' },
      effects: ['read:sales.Order'],
      handler: async (ctx: Ctx, input) => {
        const order = ctx.table('sales.Order')
        return ctx.db.all(
          from(order)
            .where(numericCompare(order.total, input['op'] as '=', 1))
            .orderBy({ col: order.id, dir: input['dir'] as 'asc' }),
        )
      },
    },
    handMade: {
      input: {},
      effects: ['read:sales.Order'],
      handler: async (ctx: Ctx) => {
        const order = ctx.table('sales.Order')
        const forged = {
          op: 'cmp',
          col: order.total,
          cmp: '= 0) OR (1 = 1) OR (0 =',
          value: 1,
        } as unknown as Expr
        return ctx.db.all(from(order).where(forged).orderBy(desc(order.id)))
      },
    },
    stamp: {
      input: { id: 'id', at: 'text' },
      effects: ['write:sales.Order', 'read:sales.Order'],
      handler: async (ctx: Ctx, input) => {
        const changes = ctx
          .change('sales.Order', { id: input['id'], total: '1', at: input['at'] })
          .cast(['id', 'total', 'at'])
        if (!changes.valid) return { invalid: changes.errors.map((error) => error.field) }
        await ctx.db.commit(changes)
        return (await ctx.db.select('sales.Order', { id: input['id'] }))[0]?.['at']
      },
    },
    find: {
      input: { q: 'text', literal: 'bool' },
      effects: ['read:sales.Order'],
      handler: async (ctx: Ctx, input) => {
        const order = ctx.table('sales.Order')
        const q = String(input['q'])
        const where = input['literal']
          ? ilike(order.id, `%${likeLiteral(q)}%`, true)
          : like(order.id, `%${q}%`)
        const rows = await ctx.db.all(from(order).where(where).orderBy(desc(order.id)))
        return rows.map((row) => row['id'])
      },
    },
    typed: {
      input: { at: 'datetime?', qty: 'int?' },
      effects: [],
      handler: (_ctx: Ctx, input) => input,
    },
  },
})

const setup = async () => {
  const manifest = compose([sales], { headless: true })
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  const call = (fn: string, input: Record<string, unknown>, company = 'acme', timezone?: string) =>
    callFn(`sales.${fn}`, input, {
      adapter,
      manifest,
      scope: { company },
      ...(timezone ? { timezone } : {}),
    }).then(
      (result) => result.value,
      (error: { code?: string }) => ({ refused: error.code }),
    )
  return { adapter, call }
}

test('data boundaries: an operator or direction from a request never reaches SQL text', async (t) => {
  const { adapter, call } = await setup()
  t.after(() => adapter.close())
  await call('seed', { row: { id: 'a1', total: '5' } }, 'acme')
  await call('seed', { row: { id: 'b1', total: '9' } }, 'beta')

  assert.deepEqual(await call('search', { op: '= 0) OR (1 = 1) OR (0 =', dir: 'asc' }), {
    refused: 'E_INVALID_OPERATOR',
  })
  assert.deepEqual(await call('search', { op: '>', dir: 'asc NULLS LAST, (SELECT 1)' }), {
    refused: 'E_INVALID_ORDER',
  })
  assert.deepEqual(await call('handMade', {}), { refused: 'E_INVALID_OPERATOR' })

  const rows = (await call('search', { op: '>', dir: 'desc' })) as Array<{ id: string }>
  assert.deepEqual(
    rows.map((row) => row.id),
    ['a1'],
  )
})

test('data boundaries: like reads % and _ as wildcards unless the text goes through likeLiteral', async (t) => {
  const { adapter, call } = await setup()
  t.after(() => adapter.close())
  for (const id of ['50%off', '500', 'x_1', 'xa1', 'a\\b']) await call('seed', { row: { id, total: '1' } })

  assert.deepEqual(await call('find', { q: '50%', literal: false }), ['500', '50%off'])
  assert.deepEqual(await call('find', { q: '50%', literal: true }), ['50%off'])
  assert.deepEqual(await call('find', { q: 'X_', literal: true }), ['x_1'], 'ilike ignores case')
  assert.deepEqual(await call('find', { q: 'a\\b', literal: true }), ['a\\b'], 'a backslash is literal too')
})

test('data boundaries: a direct write stores only real dates and ISO instants', async (t) => {
  const { adapter, call } = await setup()
  t.after(() => adapter.close())

  assert.deepEqual(await call('seed', { row: { id: 'd1', total: '1', on: '2025-02-30' } }), {
    refused: 'E_INVALID_DATE',
  })
  assert.deepEqual(await call('seed', { row: { id: 'd2', total: '1', at: 'yesterday' } }), {
    refused: 'E_INVALID_DATETIME',
  })
  assert.deepEqual(await call('seed', { row: { id: 'd3', total: '1', at: '1' } }), {
    refused: 'E_INVALID_DATETIME',
  })
  await call('seed', { row: { id: 'd4', total: '1', on: '2024-02-29', at: '2026-10-21T10:00:00+07:00' } })
  const stored = await adapter.all('SELECT "on", at FROM sales_order WHERE id = \'d4\'')
  assert.deepEqual(
    stored.map((row) => ({ ...row })),
    [{ on: '2024-02-29', at: '2026-10-21T03:00:00.000Z' }],
  )
})

test('data boundaries: a date-time without an offset is read in the deployment timezone', async (t) => {
  const { adapter, call } = await setup()
  t.after(() => adapter.close())

  assert.equal(
    await call('stamp', { id: 'c1', at: '2026-10-21T10:00' }, 'acme', 'Asia/Ho_Chi_Minh'),
    '2026-10-21T03:00:00.000Z',
  )
  assert.equal(await call('stamp', { id: 'c2', at: '2026-10-21 10:00' }), '2026-10-21T10:00:00.000Z')
  assert.equal(
    await call('stamp', { id: 'c3', at: '2026-10-21T10:00:00Z' }, 'acme', 'America/New_York'),
    '2026-10-21T10:00:00.000Z',
  )
  assert.deepEqual(await call('stamp', { id: 'c4', at: '1' }), { invalid: ['at'] })
  assert.deepEqual(await call('stamp', { id: 'c5', at: '2026-13-01T00:00' }), { invalid: ['at'] })

  // A date alone has no wall time: it stays UTC midnight, so the stored day is the day written.
  assert.equal(
    await call('stamp', { id: 'c6', at: '2099-11-30' }, 'acme', 'Asia/Ho_Chi_Minh'),
    '2099-11-30T00:00:00.000Z',
  )
  assert.equal(parseDateTime('2099-11-30', 'Asia/Ho_Chi_Minh'), '2099-11-30T00:00:00.000Z')
  assert.equal(parseDateTime('2099-11-30', 'America/New_York'), '2099-11-30T00:00:00.000Z')
  assert.equal(parseDateTime('2026-03-08T02:30', 'America/New_York') !== null, true)
  assert.equal(parseDateTime('2026-10-21T24:00'), null)
  assert.equal(parseDateTime('2026-10-21T10:00+15:00'), null)
  assert.equal(parseDateTime('2026-10-21T10:00:00.5-02:30'), '2026-10-21T12:30:00.500Z')
})

test('data boundaries: function input and form values have one reading of int and datetime', async (t) => {
  const { adapter, call } = await setup()
  t.after(() => adapter.close())

  assert.deepEqual(await call('typed', { at: 'not a date' }), { refused: 'E_INVALID_INPUT' })
  assert.deepEqual(await call('typed', { qty: 1e300 }), { refused: 'E_INVALID_INPUT' })
  assert.deepEqual(await call('typed', { qty: 42, at: '2026-10-21T10:00:00Z' }), {
    qty: 42,
    at: '2026-10-21T10:00:00Z',
  })

  const schema = defineFormSchema<{ qty: number; at: string }>({
    fields: { qty: { type: 'int' }, at: { type: 'datetime' } },
  })
  for (const qty of ['0x10', '1e3', '9007199254740993', '1.0'])
    assert.equal(validateForm(schema, { qty }).valid, false, qty)
  for (const at of ['1', 'yesterday', '2026-02-30T10:00', 'Oct 21 2026'])
    assert.equal(validateForm(schema, { at }).valid, false, at)
  assert.deepEqual(validateForm(schema, { qty: '-12', at: '2026-10-21T10:00' }).values, {
    qty: -12,
    at: '2026-10-21T10:00',
  })
})
