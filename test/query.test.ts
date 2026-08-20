import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  and,
  asc,
  callFn,
  changeset,
  compose,
  defineModule,
  deleteFrom,
  desc,
  eq,
  from,
  gt,
  inArray,
  isNull,
  like,
  not,
  or,
  planMigration,
  registerFunctions,
  renderSql,
  schemaFromManifest,
  sqliteAdapter,
  table,
  dateBucket,
} from 'ketjs'
import type { Adapter, Manifest } from 'ketjs'
import { catalog, checkout, defaultTheme as theme, inventory } from 'ketsuite'

const mods = [catalog, inventory, checkout, theme]
const manifest = compose(mods)
const P = table(manifest, 'catalog.Product')

async function boot(): Promise<{ adapter: Adapter; manifest: Manifest }> {
  const adapter = sqliteAdapter()
  await adapter.open()
  for (const sql of renderSql(planMigration(null, schemaFromManifest(manifest)), adapter))
    await adapter.exec(sql)
  registerFunctions(mods)
  return { adapter, manifest }
}

test('query: a builder call returns a new query, never mutates the old one', () => {
  const base = from(P)
  const narrowed = base.where(eq(P.active!, true))
  const narrower = narrowed.where(gt(P.priceCents!, 100))
  assert.equal(base.condition, null, 'the original must be untouched')
  assert.equal(narrowed.toSQL().params.length, 1)
  assert.equal(narrower.toSQL().params.length, 2, 'conditions accumulate with AND')
  assert.match(narrower.toSQL().text, /WHERE \(.*"active" = \?.* AND .*"priceCents" > \?\)/)
})

test('query: one shape renders for both dialects', () => {
  const q = from(P).where(eq(P.id!, 'p1')).limit(5)
  assert.match(q.toSQL('sqlite').text, /"id" = \? LIMIT \?/)
  assert.match(q.toSQL('postgres').text, /"id" = \$1 LIMIT \$2/)
  assert.deepEqual(q.toSQL('postgres').params, ['p1', 5])
})

test('query: grouping and aggregates render without interpolating values', () => {
  const q = from(P)
    .where(eq(P.active!, true))
    .groupBy({ col: P.priceCents! })
    .aggregate({ fn: 'sum', col: P.priceCents!, as: 'total' })
    .orderGroupsBy({ by: 'count', dir: 'desc' })
    .limit(10)
  const sql = q.toSQL('sqlite')
  assert.match(sql.text, /COUNT\(\*\) AS "__count"/)
  assert.match(sql.text, /SUM\(.*"priceCents"\) AS "total"/)
  assert.match(sql.text, /GROUP BY 1 ORDER BY "__count" DESC LIMIT \?/)
  assert.deepEqual(sql.params, [true, 10])
})

test('query: date buckets use the viewer timezone and ISO Monday weeks', () => {
  assert.equal(dateBucket('2026-08-20T18:30:00.000Z', 'day', 'Asia/Ho_Chi_Minh'), '2026-08-21')
  assert.equal(dateBucket('2026-08-20T18:30:00.000Z', 'month', 'UTC'), '2026-08')
  assert.equal(dateBucket('2026-01-01T00:00:00.000Z', 'week', 'UTC'), '2025-12-29')
})

test('query: db.group returns normalized keys, counts and aggregates', async () => {
  const grouped = defineModule({
    name: 'grouped',
    models: {
      Item: { scope: 'shared', fields: { id: 'id', kind: 'text?', amount: 'int' } },
    },
    functions: {
      add: {
        input: { id: 'id', kind: 'text?', amount: 'int' },
        effects: ['write:grouped.Item'],
        handler: (ctx, args) => ctx.db.insert('grouped.Item', args),
      },
      summary: {
        effects: ['read:grouped.Item'],
        handler: (ctx) => {
          const I = ctx.table('grouped.Item')
          return ctx.db.group(
            from(I)
              .groupBy({ col: I.kind! })
              .aggregate({ fn: 'sum', col: I.amount!, as: 'amount' })
              .orderGroupsBy({ by: 'key', dir: 'asc' }),
          )
        },
      },
    },
  })
  const m = compose([grouped])
  const adapter = sqliteAdapter()
  await adapter.open()
  for (const sql of renderSql(planMigration(null, schemaFromManifest(m)), adapter)) await adapter.exec(sql)
  registerFunctions([grouped])
  for (const row of [
    { id: '1', kind: 'a', amount: 2 },
    { id: '2', kind: 'a', amount: 3 },
    { id: '3', kind: null, amount: 7 },
  ])
    await callFn('grouped.add', row, { adapter, manifest: m })
  const result = await callFn('grouped.summary', {}, { adapter, manifest: m })
  assert.deepEqual(result.value, [
    { key: [null], count: 1, aggregates: { amount: 7 } },
    { key: ['a'], count: 2, aggregates: { amount: 5 } },
  ])
  await adapter.close()
})

test('models: timestamps are optional for legacy rows and server-maintained on writes', async () => {
  const timed = defineModule({
    name: 'timed',
    models: { Item: { scope: 'shared', timestamps: true, fields: { id: 'id', title: 'text' } } },
    functions: {
      save: {
        input: { id: 'id', title: 'text', createdAt: 'datetime?', updatedAt: 'datetime?' },
        effects: ['read:timed.Item', 'write:timed.Item'],
        handler: async (ctx, args) => {
          const rows = await ctx.db.select('timed.Item', { id: args.id })
          return rows.length
            ? ctx.db.update('timed.Item', { id: args.id }, args)
            : ctx.db.insert('timed.Item', args)
        },
      },
      get: {
        input: { id: 'id' },
        effects: ['read:timed.Item'],
        handler: (ctx, args) => ctx.db.select('timed.Item', { id: args.id }),
      },
    },
  })
  const m = compose([timed])
  assert.equal(m.models['timed.Item']!.fields.createdAt!.optional, true)
  const adapter = sqliteAdapter()
  await adapter.open()
  for (const sql of renderSql(planMigration(null, schemaFromManifest(m)), adapter)) await adapter.exec(sql)
  registerFunctions([timed])
  await callFn(
    'timed.save',
    { id: 'x', title: 'First', createdAt: '2000-01-01T00:00:00Z' },
    { adapter, manifest: m },
  )
  const first = (
    (await callFn('timed.get', { id: 'x' }, { adapter, manifest: m })).value as Record<string, unknown>[]
  )[0]!
  assert.notEqual(first.createdAt, '2000-01-01T00:00:00Z')
  assert.equal(first.createdAt, first.updatedAt)
  await callFn(
    'timed.save',
    { id: 'x', title: 'Second', updatedAt: '2000-01-01T00:00:00Z' },
    { adapter, manifest: m },
  )
  const second = (
    (await callFn('timed.get', { id: 'x' }, { adapter, manifest: m })).value as Record<string, unknown>[]
  )[0]!
  assert.equal(second.createdAt, first.createdAt)
  assert.notEqual(second.updatedAt, '2000-01-01T00:00:00Z')
  await adapter.close()
})

test('query: values are always parameterised, never interpolated', () => {
  const nasty = "'; DROP TABLE catalog_product; --"
  const sql = from(P).where(eq(P.title!, nasty)).toSQL()
  assert.ok(!sql.text.includes('DROP TABLE'), 'the value must not appear in the SQL text')
  assert.deepEqual(sql.params, [nasty])
})

test('query: touches is computed from the whole expression tree', () => {
  const O = table(manifest, 'checkout.Order')
  const q = from(P).where(and(eq(P.active!, true), or(gt(O.qty!, 1), not(isNull(O.id!)))))
  assert.deepEqual(q.touches, ['catalog.Product', 'checkout.Order'])
})

test('query: the whole set of operators renders', () => {
  const q = from(P)
    .select(P.id!, P.title!)
    .where(inArray(P.id!, ['a', 'b']), like(P.title!, '%áo%'), isNull(P.slug!))
    .orderBy(desc(P.priceCents!), asc(P.title!))
    .limit(10)
    .offset(20)
  const sql = q.toSQL()
  assert.match(sql.text, /SELECT "catalog_product"\."id", "catalog_product"\."title"/)
  assert.match(sql.text, /IN \(\?, \?\)/)
  assert.match(sql.text, /LIKE \?/)
  assert.match(sql.text, /"slug" IS NULL/)
  assert.match(sql.text, /ORDER BY .*"priceCents" DESC, .*"title" ASC/)
  assert.deepEqual(sql.params, ['a', 'b', '%áo%', 10, 20])
})

test('query: an empty IN list is false, not a syntax error', () => {
  assert.match(from(P).where(inArray(P.id!, [])).toSQL().text, /WHERE 1 = 0/)
})

test('query: a raw string where a column belongs is refused', () => {
  assert.throws(() => eq('id' as never, 'p1'), /expected a column from table\(\)/)
})

test('query: a query the function did not declare is blocked before it runs', async () => {
  const { adapter } = await boot()
  const rogue = defineModule({
    name: 'rogue',
    depends: ['catalog', 'checkout'],
    functions: {
      snoop: {
        effects: ['read:catalog.Product'], // reads Product but not Order
        handler: (ctx) => {
          const p = ctx.table('catalog.Product'),
            o = ctx.table('checkout.Order')
          return ctx.db.all(from(p).where(gt(o.qty!, 0)))
        },
      },
    },
  })
  const m2 = compose([...mods, rogue])
  registerFunctions([...mods, rogue])
  await assert.rejects(
    () => callFn('rogue.snoop', {}, { adapter, manifest: m2 }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_EFFECT_NOT_DECLARED')
      assert.match((e as Error).message, /read on checkout\.Order/)
      return true
    },
  )
  await adapter.close()
})

test('query: end to end through a real server function', async () => {
  const { adapter, manifest: m } = await boot()
  for (const [id, price] of [
    ['p1', 30_000],
    ['p2', 90_000],
    ['p3', 60_000],
  ] as const) {
    await callFn(
      'catalog.createProduct',
      { id, title: `SP ${id}`, priceCents: price, slug: id },
      { adapter, manifest: m },
    )
  }
  const all = await callFn('catalog.listProducts', {}, { adapter, manifest: m })
  assert.equal((all.value as unknown[]).length, 3)

  const dear = await callFn('catalog.listProducts', { minPriceCents: 60_000 }, { adapter, manifest: m })
  const rows = dear.value as Array<{ id: string; priceCents: number }>
  assert.deepEqual(
    rows.map((r) => r.id),
    ['p2', 'p3'],
    'filtered and ordered by price descending',
  )
  await adapter.close()
})

test('changeset: fields that were not cast are dropped, not written', () => {
  const cs = changeset(manifest, 'catalog.Product', { title: 'Áo', active: false, leadTimeDays: 99 }).cast([
    'title',
  ])
  assert.deepEqual(cs.changes, { title: 'Áo' })
  assert.deepEqual(cs.dropped.sort(), ['active', 'leadTimeDays'])
  assert.equal(cs.valid, true)
})

test('changeset: casting coerces what it safely can and refuses the rest', () => {
  const ok = changeset(manifest, 'catalog.Product', { priceCents: '15000', active: 'true' }).cast([
    'priceCents',
    'active',
  ])
  assert.deepEqual(ok.changes, { priceCents: 15000, active: true })

  const bad = changeset(manifest, 'catalog.Product', { priceCents: '15.5' }).cast(['priceCents'])
  assert.equal(bad.valid, false)
  assert.deepEqual(bad.errors, [{ field: 'priceCents', message: 'expected an integer, got 15.5' }])
})

test('changeset: changes are a real diff against the existing row', () => {
  const base = { id: 'p1', title: 'Áo', priceCents: 5000, slug: 'ao', active: true }
  const cs = changeset(manifest, 'catalog.Product', { title: 'Áo', priceCents: 7000 }, base).cast([
    'title',
    'priceCents',
  ])
  assert.deepEqual(cs.changes, { priceCents: 7000 }, 'an unchanged value is not a change')
  assert.equal(cs.action, 'update')
})

test('changeset: errors are structured data an agent can act on', () => {
  const cs = changeset(manifest, 'catalog.Product', { priceCents: -5 })
    .cast(['priceCents'])
    .required(['title'])
    .validate('priceCents', (v) => (v as number) > 0 || 'phải lớn hơn 0')
  assert.equal(cs.valid, false)
  assert.deepEqual(cs.errors, [
    { field: 'title', message: 'is required' },
    { field: 'priceCents', message: 'phải lớn hơn 0' },
  ])
  assert.equal(cs.toJSON().action, 'insert')
})

test('changeset: put sets a server-controlled field the client cannot supply', () => {
  const cs = changeset(manifest, 'catalog.Product', { active: false }).cast(['title']).put('active', true)
  assert.equal(cs.changes.active, true, 'the client value was dropped, the server value stands')
})

test('changeset: committing an invalid one is refused with its errors', async () => {
  const { adapter, manifest: m } = await boot()
  await assert.rejects(
    () =>
      callFn(
        'catalog.createProduct',
        { id: 'x', title: 'Áo', priceCents: 0, slug: 'ao' },
        { adapter, manifest: m },
      ),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_INVALID_CHANGESET')
      assert.match((e as Error).message, /priceCents phải lớn hơn 0/)
      return true
    },
  )
  assert.equal((await adapter.all('SELECT * FROM catalog_product', [])).length, 0)
  await adapter.close()
})

test('query: delete is a write and is checked as one', () => {
  const q = deleteFrom(P).where(eq(P.id!, 'p1'))
  assert.equal(q.effect, 'write')
  assert.match(q.toSQL().text, /^DELETE FROM "catalog_product" WHERE/)
})
