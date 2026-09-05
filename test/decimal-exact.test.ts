import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  asc,
  callFn,
  changeset,
  compose,
  desc,
  defineModule,
  from,
  generateDts,
  gte,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
  table,
} from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'

const ledger = defineModule({
  name: 'ledger',
  models: { Entry: { scope: 'shared', fields: { id: 'id', amount: 'decimal?', note: 'text' } } },
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
    putNullable: {
      input: { id: 'id', amount: 'decimal?', note: 'text' },
      effects: ['write:ledger.Entry'],
      handler: (ctx, args) => ctx.db.insert('ledger.Entry', args),
    },
    putRaw: {
      input: { id: 'id', raw: 'text', note: 'text' },
      effects: ['write:ledger.Entry'],
      handler: (ctx, args) =>
        ctx.db.insert('ledger.Entry', { id: args.id, amount: args.raw, note: args.note }),
    },
    updateRaw: {
      input: { id: 'id', raw: 'text' },
      effects: ['write:ledger.Entry'],
      dryRun: true,
      handler: (ctx, args) => ctx.db.update('ledger.Entry', { id: args.id }, { amount: args.raw }),
    },
    findRaw: {
      input: { raw: 'text' },
      effects: ['read:ledger.Entry'],
      handler: (ctx, args) => ctx.db.select('ledger.Entry', { amount: args.raw }),
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
    rank: {
      input: { min: 'decimal?', descending: 'bool?' },
      effects: ['read:ledger.Entry'],
      handler: (ctx, args) => {
        const Entry = ctx.table('ledger.Entry')
        const query = args.min === undefined ? from(Entry) : from(Entry).where(gte(Entry.amount!, args.min))
        return ctx.db.all(query.orderBy(args.descending ? desc(Entry.amount!) : asc(Entry.amount!)))
      },
    },
    summarize: {
      effects: ['read:ledger.Entry'],
      handler: (ctx) => {
        const Entry = ctx.table('ledger.Entry')
        return ctx.db.group(
          from(Entry)
            .groupBy({ col: Entry.note! })
            .aggregate(
              { fn: 'count', as: 'rows' },
              { fn: 'count', col: Entry.amount!, as: 'presentAmounts' },
              { fn: 'countDistinct', col: Entry.amount!, as: 'distinctAmounts' },
              { fn: 'sum', col: Entry.amount!, as: 'total' },
              { fn: 'min', col: Entry.amount!, as: 'minimum' },
              { fn: 'max', col: Entry.amount!, as: 'maximum' },
            )
            .orderGroupsBy({ by: 'total', dir: 'asc' }),
        )
      },
    },
    groupAmounts: {
      effects: ['read:ledger.Entry'],
      handler: (ctx) => {
        const Entry = ctx.table('ledger.Entry')
        return ctx.db.group(
          from(Entry).groupBy({ col: Entry.amount! }).orderGroupsBy({ by: 'key', dir: 'asc' }),
        )
      },
    },
    average: {
      input: { scale: 'int' },
      effects: ['read:ledger.Entry'],
      handler: (ctx, args) => {
        const Entry = ctx.table('ledger.Entry')
        return ctx.db.group(
          from(Entry)
            .groupBy({ col: Entry.note! })
            .aggregate({
              fn: 'avg',
              col: Entry.amount!,
              as: 'average',
              scale: Number(args.scale),
              rounding: 'half-away-from-zero',
            })
            .orderGroupsBy({ by: 'key', dir: 'asc' }),
        )
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

test('decimal: SQLite compares and sorts exact text numerically without changing its decode', async (t) => {
  const { adapter, manifest } = await boot()
  t.after(() => adapter.close())
  const amounts = [
    '-9007199254740993.2',
    '-10',
    '-2',
    '0',
    '0.01',
    '2',
    '10',
    '9007199254740992.1',
    '9007199254740992.2',
    '9007199254740993.1',
  ]
  for (const [index, amount] of amounts.entries())
    await callFn('ledger.put', { id: `rank-${index}`, amount, note: 'rank' }, { adapter, manifest })

  const ascending = (await callFn('ledger.rank', {}, { adapter, manifest })).value as Row[]
  assert.deepEqual(
    ascending.map((row) => row.amount),
    amounts,
  )
  assert.ok(ascending.every((row) => typeof row.amount === 'string'))

  const descending = (await callFn('ledger.rank', { descending: true }, { adapter, manifest })).value as Row[]
  assert.deepEqual(
    descending.map((row) => row.amount),
    [...amounts].reverse(),
  )

  const aboveUnsafeInteger = (
    await callFn('ledger.rank', { min: '9007199254740992.15' }, { adapter, manifest })
  ).value as Row[]
  assert.deepEqual(
    aboveUnsafeInteger.map((row) => row.amount),
    ['9007199254740992.2', '9007199254740993.1'],
    'comparison must distinguish decimals that collapse to the same JavaScript number',
  )
})

test('decimal: SQLite groups equivalent spellings and aggregates without binary floats', async (t) => {
  const { adapter, manifest } = await boot()
  t.after(() => adapter.close())
  const amounts = [
    '-9007199254740990.3',
    '9007199254740992.1',
    '0.2',
    '1.0',
    '1.00',
    '-0.0',
    '0.000',
    '-2.00',
    '10',
    '2.0',
  ]
  for (const [index, amount] of amounts.entries())
    await callFn('ledger.put', { id: `aggregate-${index}`, amount, note: 'all' }, { adapter, manifest })

  const summarized = (await callFn('ledger.summarize', {}, { adapter, manifest })).value as Array<{
    key: unknown[]
    count: number
    aggregates: Record<string, unknown>
  }>
  assert.deepEqual(summarized, [
    {
      key: ['all'],
      count: 10,
      aggregates: {
        rows: 10,
        presentAmounts: 10,
        distinctAmounts: 8,
        total: '14',
        minimum: '-9007199254740990.3',
        maximum: '9007199254740992.1',
      },
    },
  ])

  const grouped = (await callFn('ledger.groupAmounts', {}, { adapter, manifest })).value as Array<{
    key: unknown[]
    count: number
  }>
  assert.deepEqual(grouped, [
    { key: ['-9007199254740990.3'], count: 1, aggregates: {} },
    { key: ['-2'], count: 1, aggregates: {} },
    { key: ['0'], count: 2, aggregates: {} },
    { key: ['0.2'], count: 1, aggregates: {} },
    { key: ['1'], count: 2, aggregates: {} },
    { key: ['2'], count: 1, aggregates: {} },
    { key: ['10'], count: 1, aggregates: {} },
    { key: ['9007199254740992.1'], count: 1, aggregates: {} },
  ])
})

test('decimal: nullable aggregates count values and every portable order puts nulls explicitly', async (t) => {
  const { adapter, manifest } = await boot()
  t.after(() => adapter.close())
  for (const [id, amount] of [
    ['two', '2.00'],
    ['ten', '10'],
    ['missing', null],
  ])
    await callFn('ledger.putNullable', { id, amount, note: 'nullable' }, { adapter, manifest })

  const ascending = (await callFn('ledger.rank', {}, { adapter, manifest })).value as Row[]
  assert.deepEqual(
    ascending.map((row) => row.amount),
    ['2.00', '10', null],
    'ASC follows PostgreSQL and places NULL last',
  )
  const descending = (await callFn('ledger.rank', { descending: true }, { adapter, manifest })).value as Row[]
  assert.deepEqual(
    descending.map((row) => row.amount),
    [null, '10', '2.00'],
    'DESC follows PostgreSQL and places NULL first',
  )

  const summary = ((await callFn('ledger.summarize', {}, { adapter, manifest })).value as Row[])[0]!
  assert.deepEqual(summary, {
    key: ['nullable'],
    count: 3,
    aggregates: {
      rows: 3,
      presentAmounts: 2,
      distinctAmounts: 2,
      total: '12',
      minimum: '2',
      maximum: '10',
    },
  })
  const groups = (await callFn('ledger.groupAmounts', {}, { adapter, manifest })).value as Row[]
  assert.deepEqual(
    groups.map((row) => (row.key as unknown[])[0]),
    ['2', '10', null],
    'decimal group aliases use the same explicit NULL order',
  )
})

test('decimal: every public write, filter, and UDF boundary enforces 4096 characters', async (t) => {
  const { adapter, manifest } = await boot()
  t.after(() => adapter.close())
  const boundary = '1'.repeat(4096)
  const oversized = boundary + '1'

  await callFn('ledger.put', { id: 'boundary', amount: boundary, note: 'budget' }, { adapter, manifest })
  assert.equal(
    ((await callFn('ledger.read', { id: 'boundary' }, { adapter, manifest })).value as Row).amount,
    boundary,
  )

  await assert.rejects(
    callFn('ledger.put', { id: 'fn', amount: oversized, note: 'budget' }, { adapter, manifest }),
    (error: unknown) => (error as { code?: string }).code === 'E_INVALID_INPUT',
  )
  const cast = changeset(manifest, 'ledger.Entry', { amount: oversized }).cast(['amount'])
  assert.equal(cast.valid, false)
  assert.match(cast.errors[0]!.message, /4096/)
  await assert.rejects(
    callFn('ledger.putRaw', { id: 'raw', raw: oversized, note: 'budget' }, { adapter, manifest }),
    (error: unknown) => (error as { code?: string }).code === 'E_DECIMAL_TOO_LONG',
  )
  await assert.rejects(
    callFn('ledger.updateRaw', { id: 'boundary', raw: oversized }, { adapter, manifest, dryRun: true }),
    (error: unknown) => (error as { code?: string }).code === 'E_DECIMAL_TOO_LONG',
  )
  await assert.rejects(
    callFn('ledger.findRaw', { raw: oversized }, { adapter, manifest }),
    (error: unknown) => (error as { code?: string }).code === 'E_DECIMAL_TOO_LONG',
  )

  const Entry = table(manifest, 'ledger.Entry')
  assert.throws(
    () => from(Entry).where(gte(Entry.amount!, oversized)).toSQL('sqlite'),
    (error: unknown) => (error as { code?: string }).code === 'E_DECIMAL_TOO_LONG',
  )
  const guarded = (await adapter.all('SELECT ket_decimal_cmp(?, ?) AS compared', [oversized, '1']))[0]!
  assert.equal(guarded.compared, null, 'the UDF rejects over-budget raw SQLite values before parsing')
})

test('decimal: legacy columns without base metadata fail instead of falling back to SQLite coercion', () => {
  const Entry = table(compose([ledger]), 'ledger.Entry')
  const legacy = { model: 'ledger.Entry', name: 'amount' }
  assert.throws(() => gte(legacy as never, '1'), /metadata cannot be constructed by hand/)
  assert.throws(
    () =>
      from(Entry)
        .groupBy({ col: Entry.note! })
        .aggregate({ fn: 'avg', col: legacy as never, as: 'average' }),
    /metadata cannot be constructed by hand/,
  )

  const forged = { ...legacy, base: 'text' }
  assert.throws(
    () => gte(forged as never, '1'),
    /metadata cannot be constructed by hand/,
    'a caller cannot lie about the base type to bypass exact decimal SQL',
  )

  const copied = { ...Entry.amount, base: 'text' }
  assert.throws(
    () => gte(copied as never, '1'),
    /metadata cannot be constructed by hand/,
    'spreading a real handle does not copy its private identity',
  )
})

test('decimal: average requires an explicit portable rounding contract', () => {
  const Entry = table(compose([ledger]), 'ledger.Entry')
  const implicit = from(Entry)
    .groupBy({ col: Entry.note! })
    .aggregate({ fn: 'avg', col: Entry.amount!, as: 'average' })
  for (const dialect of ['sqlite', 'postgres'] as const)
    assert.throws(
      () => implicit.toSQL(dialect),
      (error: unknown) => (error as { code?: string }).code === 'E_DECIMAL_AVG_ROUNDING_REQUIRED',
    )

  const explicit = from(Entry).groupBy({ col: Entry.note! }).aggregate({
    fn: 'avg',
    col: Entry.amount!,
    as: 'average',
    scale: 2,
    rounding: 'half-away-from-zero',
  })
  const sqlite = explicit.toSQL('sqlite')
  const postgres = explicit.toSQL('postgres')
  assert.match(sqlite.text, /ket_decimal_avg\(.*"amount", \?\) AS "average"/)
  assert.deepEqual(sqlite.params, [2])
  assert.match(postgres.text, /DIV\(ABS\(SUM\(.*"amount"\)\)/)
  assert.match(postgres.text, /MOD\(ABS\(SUM\(.*"amount"\)\)/)
  assert.match(postgres.text, /CAST\(\('1e' \|\| CAST\(\$1 AS TEXT\)\) AS NUMERIC\)/)
  assert.deepEqual(postgres.params, [2])

  const invalidScale = from(Entry).groupBy({ col: Entry.note! }).aggregate({
    fn: 'avg',
    col: Entry.amount!,
    as: 'average',
    scale: -1,
    rounding: 'half-away-from-zero',
  })
  assert.throws(
    () => invalidScale.toSQL('sqlite'),
    (error: unknown) => (error as { code?: string }).code === 'E_DECIMAL_AVG_SCALE',
  )
})

test('decimal: SQLite computes explicitly rounded averages without binary floats', async (t) => {
  const { adapter, manifest } = await boot()
  t.after(() => adapter.close())
  for (const [id, amount, note] of [
    ['third-1', '1', 'third'],
    ['third-2', '0', 'third'],
    ['third-3', '0', 'third'],
    ['negative-1', '-1', 'negative'],
    ['negative-2', '0', 'negative'],
    ['missing', null, 'third'],
  ] as const)
    await callFn('ledger.putNullable', { id, amount, note }, { adapter, manifest })

  const hundredths = (await callFn('ledger.average', { scale: 2 }, { adapter, manifest })).value as Row[]
  assert.deepEqual(hundredths, [
    { key: ['negative'], count: 2, aggregates: { average: '-0.5' } },
    { key: ['third'], count: 4, aggregates: { average: '0.33' } },
  ])
  const integers = (await callFn('ledger.average', { scale: 0 }, { adapter, manifest })).value as Row[]
  assert.equal((integers[0]!.aggregates as Row).average, '-1', 'ties round away from zero like NUMERIC')
})

test('decimal: SQLite average permits a wider intermediate sum when the result fits', async (t) => {
  const { adapter, manifest } = await boot()
  t.after(() => adapter.close())
  const value = '9'.repeat(4096)
  for (const id of ['wide-1', 'wide-2'])
    await callFn('ledger.putNullable', { id, amount: value, note: 'wide' }, { adapter, manifest })

  const rows = (await callFn('ledger.average', { scale: 0 }, { adapter, manifest })).value as Row[]
  assert.equal((rows[0]!.aggregates as Row).average, value)
})

test('decimal: SQLite orders exact aggregate aliases numerically', async (t) => {
  const { adapter, manifest } = await boot()
  t.after(() => adapter.close())
  for (const [note, amount] of [
    ['negative', '-2'],
    ['large', '10'],
    ['small', '2'],
  ])
    await callFn('ledger.put', { id: note, amount, note }, { adapter, manifest })

  const summarized = (await callFn('ledger.summarize', {}, { adapter, manifest })).value as Array<{
    key: string[]
  }>
  assert.deepEqual(
    summarized.map((row) => row.key[0]),
    ['negative', 'small', 'large'],
  )
})

test('decimal: context canonicalizes PostgreSQL-shaped computed values without a live server', async () => {
  const manifest = compose([ledger])
  registerFunctions([ledger])
  const seen: string[] = []
  const adapter: Adapter = {
    name: 'postgres',
    async open() {},
    async close() {},
    async exec() {},
    async all(sql) {
      seen.push(sql)
      if (sql.includes('AS "total"'))
        return [
          {
            __group0: 'all',
            __count: 3,
            rows: 3,
            presentAmounts: 2,
            distinctAmounts: 2,
            total: '3.00',
            minimum: '1.00',
            maximum: '2.000',
          },
        ]
      return [{ __group0: '1.00', __count: 2 }]
    },
    async run() {
      return { changes: 0 }
    },
    async tx(fn) {
      return fn(this)
    },
    quoteIdent(name) {
      return `"${name.replace(/"/g, '""')}"`
    },
    columnSql() {
      return 'NUMERIC'
    },
    async introspect() {
      return {}
    },
  }

  const summary = ((await callFn('ledger.summarize', {}, { adapter, manifest })).value as Row[])[0]!
  assert.deepEqual(summary.aggregates, {
    rows: 3,
    presentAmounts: 2,
    distinctAmounts: 2,
    total: '3',
    minimum: '1',
    maximum: '2',
  })
  const grouped = ((await callFn('ledger.groupAmounts', {}, { adapter, manifest })).value as Row[])[0]!
  assert.deepEqual(grouped.key, ['1'])
  assert.match(seen[0]!, /COUNT\("ledger_entry"\."amount"\) AS "presentAmounts"/)
  assert.match(seen[0]!, /ORDER BY "total" ASC NULLS LAST/)
})

test('decimal: generated function declarations use exact strings', () => {
  const generated = generateDts(compose([ledger]))
  assert.match(generated, /amount: string/)
  assert.match(generated, /"ledger\.put": \{ input: \{ id: string; amount: string; note: string \}/)
})
