import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  callFn,
  compose,
  defineModule,
  from,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
  project,
} from 'ketjs'
import type { Ctx } from 'ketjs'

/**
 * `output` used to be a comment: composed into the manifest and read by nothing, so
 * a function could declare three fields and hand back eight. It is a projection
 * now, and the two properties it gives are worth telling apart.
 *
 *   Nothing undeclared escapes — this is picking, so it holds for every value and
 *   for an empty result. It cannot depend on the data.
 *
 *   Everything declared is present — only checkable where there is a row. That is
 *   a bug in the handler rather than a hole in the boundary.
 */

// ── the unit ─────────────────────────────────────────────────────────────────

test('project: keeps what was declared and drops the rest', () => {
  const got = project('f', { id: 'id', name: 'text' }, { id: '1', name: 'X', cost: 12000, companyId: 'acme' })
  assert.deepEqual(got, { id: '1', name: 'X' })
})

test('project: a list is projected element by element', () => {
  const got = project('f', { id: 'id' }, [
    { id: '1', secret: 'x' },
    { id: '2', secret: 'y' },
  ])
  assert.deepEqual(got, [{ id: '1' }, { id: '2' }])
})

test('project: an empty list stays empty, and proves nothing either way', () => {
  assert.deepEqual(project('f', { id: 'id' }, []), [])
})

test('project: an optional field may be absent, which is what a result union needs', () => {
  // {ok:true, qty} or {ok:false, errors} cannot be described by a flat record
  // without it — and that is the convention every write function here uses.
  assert.deepEqual(project('f', { ok: 'bool', qty: 'float?', errors: 'json?' }, { ok: true, qty: 3 }), {
    ok: true,
    qty: 3,
  })
  assert.deepEqual(project('f', { ok: 'bool', qty: 'float?', errors: 'json?' }, { ok: false, errors: [] }), {
    ok: false,
    errors: [],
  })
})

test('project: a required field the handler forgot is named, with the fix in the hint', () => {
  assert.throws(
    () => project('shop.list', { id: 'id', productName: 'text' }, { id: '1', product: { name: 'Xoài' } }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_OUTPUT_FIELD_MISSING')
      assert.match((e as { hint: string }).hint, /mark it "text\?"/)
      assert.match((e as { hint: string }).hint, /returned: id, product/)
      return true
    },
  )
})

test('project: declaring nothing means no projection, so nothing had to be rewritten at once', () => {
  const whole = { id: '1', cost: 12000 }
  assert.deepEqual(project('f', {}, whole), whole)
})

test('project: null and undefined pass through rather than becoming an empty shape', () => {
  assert.equal(project('f', { id: 'id' }, null), null)
  assert.equal(project('f', { id: 'id' }, undefined), undefined)
})

test('project: a declared shape and a returned scalar is a mistake worth naming', () => {
  assert.throws(() => project('f', { id: 'id' }, 42), /declares an output shape but returned number/)
})

test('project: it is one level deep, and that is a limit rather than an oversight', () => {
  const got = project('f', { id: 'id', product: 'json' }, { id: '1', product: { name: 'Xoài', cost: 12000 } })
  assert.deepEqual(
    got,
    { id: '1', product: { name: 'Xoài', cost: 12000 } },
    'naming a nested object hands it over whole — narrow it with a view model, or do not name it',
  )
})

// ── the scenario it was built for ────────────────────────────────────────────

const shop = defineModule({
  name: 'shop',
  models: {
    Product: { scope: 'shared', fields: { id: 'id', name: 'text', cost: 'decimal', price: 'decimal' } },
    Order: { scope: 'company', fields: { id: 'id', productId: 'text', qty: 'int' } },
  },
  relations: { 'shop.Order': { product: { belongsTo: 'shop.Product', by: 'productId' } } },
  functions: {
    // A salesperson sees the order list. It shows the product name. It must not
    // show what the product cost to buy.
    listOrders: {
      effects: ['read:shop.Order', 'read:shop.Product'],
      output: { id: 'id', qty: 'int', productName: 'text' },
      handler: async (ctx: Ctx) => {
        const rows = await ctx.db.all(from(ctx.table('shop.Order')).preload('product'))
        return rows.map((r) => ({ id: r.id, qty: r.qty, productName: (r.product as { name: string }).name }))
      },
    },
    leaky: {
      effects: ['read:shop.Order', 'read:shop.Product'],
      handler: (ctx: Ctx) => ctx.db.all(from(ctx.table('shop.Order')).preload('product')),
    },
  },
})

test('projection: the cost does not leave, and the scope column does not either', async () => {
  const manifest = compose([shop])
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions([shop])
  await adapter.run('INSERT INTO shop_product (id,name,cost,price) VALUES (?,?,?,?)', [
    'p1',
    'Xoài',
    '12000',
    '30000',
  ])
  await adapter.run('INSERT INTO shop_order (id,"companyId","productId",qty) VALUES (?,?,?,?)', [
    'o1',
    'acme',
    'p1',
    5,
  ])
  const scope = { company: 'acme' }

  const safe = await callFn('shop.listOrders', {}, { adapter, manifest, scope })
  assert.deepEqual(safe.value, [{ id: 'o1', qty: 5, productName: 'Xoài' }])
  assert.ok(!JSON.stringify(safe.value).includes('12000'), 'cost')
  assert.ok(!JSON.stringify(safe.value).includes('companyId'), "scope machinery is nobody's business")

  // The same query without a declared output still hands everything over — which is
  // the compatible default, and exactly what `ket permissions` flags.
  const leak = await callFn('shop.leaky', {}, { adapter, manifest, scope })
  assert.ok(JSON.stringify(leak.value).includes('12000'))
  await adapter.close()
})
