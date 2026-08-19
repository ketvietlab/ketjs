import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compose } from '../src/kernel/compose.ts'
import { table, from, deleteFrom, asc, desc } from '../src/data/query.ts'
import { eq, gt, gte, and, or, not, inArray, like, isNull } from '../src/data/expr.ts'
import { changeset } from '../src/data/changeset.ts'
import { sqliteAdapter } from '../src/data/sqlite.ts'
import { schemaFromManifest, planMigration, renderSql } from '../src/data/migrate.ts'
import { registerFunctions, callFn, _resetIdempotency } from '../src/server/fn.ts'
import { defineModule } from '../src/kernel/define.ts'
import catalog from '../examples/modules/catalog/index.ts'
import inventory from '../examples/modules/inventory/index.ts'
import checkout from '../examples/modules/checkout/index.ts'
import theme from '../examples/themes/default/index.ts'
import type { Adapter, Manifest } from '../src/types.ts'

const mods = [catalog, inventory, checkout, theme]
const manifest = compose(mods)
const P = table(manifest, 'catalog.Product')

function boot(): { adapter: Adapter; manifest: Manifest } {
  const adapter = sqliteAdapter()
  adapter.open()
  for (const sql of renderSql(planMigration(null, schemaFromManifest(manifest)), adapter)) adapter.exec(sql)
  registerFunctions(mods)
  _resetIdempotency()
  return { adapter, manifest }
}

test('query: a builder call returns a new query, never mutates the old one', () => {
  const base = from(P)
  const narrowed = base.where_(eq(P.active!, true))
  const narrower = narrowed.where_(gt(P.priceCents!, 100))
  assert.equal(base.where, null, 'the original must be untouched')
  assert.equal(narrowed.toSQL().params.length, 1)
  assert.equal(narrower.toSQL().params.length, 2, 'conditions accumulate with AND')
  assert.match(narrower.toSQL().text, /WHERE \(.*"active" = \?.* AND .*"priceCents" > \?\)/)
})

test('query: one shape renders for both dialects', () => {
  const q = from(P).where_(eq(P.id!, 'p1')).limit(5)
  assert.match(q.toSQL('sqlite').text, /"id" = \? LIMIT \?/)
  assert.match(q.toSQL('postgres').text, /"id" = \$1 LIMIT \$2/)
  assert.deepEqual(q.toSQL('postgres').params, ['p1', 5])
})

test('query: values are always parameterised, never interpolated', () => {
  const nasty = "'; DROP TABLE catalog_product; --"
  const sql = from(P).where_(eq(P.title!, nasty)).toSQL()
  assert.ok(!sql.text.includes('DROP TABLE'), 'the value must not appear in the SQL text')
  assert.deepEqual(sql.params, [nasty])
})

test('query: touches is computed from the whole expression tree', () => {
  const O = table(manifest, 'checkout.Order')
  const q = from(P).where_(and(eq(P.active!, true), or(gt(O.qty!, 1), not(isNull(O.id!)))))
  assert.deepEqual(q.touches, ['catalog.Product', 'checkout.Order'])
})

test('query: the whole set of operators renders', () => {
  const q = from(P)
    .select(P.id!, P.title!)
    .where_(inArray(P.id!, ['a', 'b']), like(P.title!, '%áo%'), isNull(P.slug!))
    .orderBy(desc(P.priceCents!), asc(P.title!))
    .limit(10).offset(20)
  const sql = q.toSQL()
  assert.match(sql.text, /SELECT "catalog_product"\."id", "catalog_product"\."title"/)
  assert.match(sql.text, /IN \(\?, \?\)/)
  assert.match(sql.text, /LIKE \?/)
  assert.match(sql.text, /"slug" IS NULL/)
  assert.match(sql.text, /ORDER BY .*"priceCents" DESC, .*"title" ASC/)
  assert.deepEqual(sql.params, ['a', 'b', '%áo%', 10, 20])
})

test('query: an empty IN list is false, not a syntax error', () => {
  assert.match(from(P).where_(inArray(P.id!, [])).toSQL().text, /WHERE 1 = 0/)
})

test('query: a raw string where a column belongs is refused', () => {
  assert.throws(() => eq('id' as never, 'p1'), /expected a column from table\(\)/)
})

test('query: a query the function did not declare is blocked before it runs', async () => {
  const { adapter } = boot()
  const rogue = defineModule({
    name: 'rogue', depends: ['catalog', 'checkout'],
    functions: {
      snoop: {
        effects: ['read:catalog.Product'],       // reads Product but not Order
        handler: (ctx) => {
          const p = ctx.table('catalog.Product'), o = ctx.table('checkout.Order')
          return ctx.db.all(from(p).where_(gt(o.qty!, 0)))
        },
      },
    },
  })
  const m2 = compose([...mods, rogue])
  registerFunctions([...mods, rogue])
  await assert.rejects(() => callFn('rogue.snoop', {}, { adapter, manifest: m2 }), (e: unknown) => {
    assert.equal((e as { code: string }).code, 'E_EFFECT_NOT_DECLARED')
    assert.match((e as Error).message, /read on checkout\.Order/)
    return true
  })
  adapter.close()
})

test('query: end to end through a real server function', async () => {
  const { adapter, manifest: m } = boot()
  for (const [id, price] of [['p1', 30_000], ['p2', 90_000], ['p3', 60_000]] as const) {
    await callFn('catalog.createProduct', { id, title: `SP ${id}`, priceCents: price, slug: id }, { adapter, manifest: m })
  }
  const all = await callFn('catalog.listProducts', {}, { adapter, manifest: m })
  assert.equal((all.value as unknown[]).length, 3)

  const dear = await callFn('catalog.listProducts', { minPriceCents: 60_000 }, { adapter, manifest: m })
  const rows = dear.value as Array<{ id: string; priceCents: number }>
  assert.deepEqual(rows.map(r => r.id), ['p2', 'p3'], 'filtered and ordered by price descending')
  adapter.close()
})

test('changeset: fields that were not cast are dropped, not written', () => {
  const cs = changeset(manifest, 'catalog.Product', { title: 'Áo', active: false, leadTimeDays: 99 })
    .cast(['title'])
  assert.deepEqual(cs.changes, { title: 'Áo' })
  assert.deepEqual(cs.dropped.sort(), ['active', 'leadTimeDays'])
  assert.equal(cs.valid, true)
})

test('changeset: casting coerces what it safely can and refuses the rest', () => {
  const ok = changeset(manifest, 'catalog.Product', { priceCents: '15000', active: 'true' }).cast(['priceCents', 'active'])
  assert.deepEqual(ok.changes, { priceCents: 15000, active: true })

  const bad = changeset(manifest, 'catalog.Product', { priceCents: '15.5' }).cast(['priceCents'])
  assert.equal(bad.valid, false)
  assert.deepEqual(bad.errors, [{ field: 'priceCents', message: 'expected an integer, got 15.5' }])
})

test('changeset: changes are a real diff against the existing row', () => {
  const base = { id: 'p1', title: 'Áo', priceCents: 5000, slug: 'ao', active: true }
  const cs = changeset(manifest, 'catalog.Product', { title: 'Áo', priceCents: 7000 }, base).cast(['title', 'priceCents'])
  assert.deepEqual(cs.changes, { priceCents: 7000 }, 'an unchanged value is not a change')
  assert.equal(cs.action, 'update')
})

test('changeset: errors are structured data an agent can act on', () => {
  const cs = changeset(manifest, 'catalog.Product', { priceCents: -5 })
    .cast(['priceCents'])
    .required(['title'])
    .validate('priceCents', v => (v as number) > 0 || 'phải lớn hơn 0')
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
  const { adapter, manifest: m } = boot()
  await assert.rejects(
    () => callFn('catalog.createProduct', { id: 'x', title: 'Áo', priceCents: 0, slug: 'ao' }, { adapter, manifest: m }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_INVALID_CHANGESET')
      assert.match((e as Error).message, /priceCents phải lớn hơn 0/)
      return true
    })
  assert.equal(adapter.all('SELECT * FROM catalog_product', []).length, 0)
  adapter.close()
})

test('query: delete is a write and is checked as one', () => {
  const q = deleteFrom(P).where_(eq(P.id!, 'p1'))
  assert.equal(q.effect, 'write')
  assert.match(q.toSQL().text, /^DELETE FROM "catalog_product" WHERE/)
})
