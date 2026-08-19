import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compose, defineModule, reachOf, functionsOf, formatReach, formatInventory, from } from 'ketjs'
import type { Ctx } from 'ketjs'

/**
 * The question this answers: "the user needs orders but must not have products".
 *
 * In most systems that takes reading every module, because permission is granted on
 * a table and a table is used everywhere. Here it is arithmetic — a function cannot
 * touch a model it did not declare, not through a relation and not by calling
 * another function, because there is no way to call one. So the reach of a set of
 * functions is the union of their effects, with nothing to traverse.
 */
const shop = defineModule({
  name: 'shop',
  models: {
    Product: { scope: 'shared', fields: { id: 'id', name: 'text', cost: 'decimal' } },
    Order: { scope: 'company', fields: { id: 'id', productId: 'text', total: 'decimal' } },
  },
  relations: { 'shop.Order': { product: { belongsTo: 'shop.Product', by: 'productId' } } },
  functions: {
    // Shows product names in the order list, so it must say so.
    listOrders: {
      effects: ['read:shop.Order', 'read:shop.Product'],
      output: { id: 'text', total: 'decimal', productName: 'text' },
      handler: (ctx: Ctx) => ctx.db.all(from(ctx.table('shop.Order')).preload('product')),
    },
    // Browsing the catalogue is a different action, and stays a different grant.
    listProducts: { effects: ['read:shop.Product'], handler: (ctx: Ctx) => ctx.db.all(from(ctx.table('shop.Product'))) },
    placeOrder: { effects: ['read:shop.Product', 'write:shop.Order'], handler: () => ({ ok: true }) },
    salesByCompany: { effects: ['read:shop.Order'], crossCompany: true, handler: () => [] },
  },
})

const manifest = compose([shop])

test('reach: granting the order list reaches product, and says which function did it', () => {
  const r = reachOf(manifest, ['shop.listOrders'])
  assert.deepEqual(r.models.map(m => m.model), ['shop.Order', 'shop.Product'])
  assert.deepEqual(r.models.find(m => m.model === 'shop.Product')!.via, ['shop.listOrders'],
    'a surprise has to be traceable to its cause')
})

test('reach: but it does NOT grant the catalogue — permission is on the action, not the table', () => {
  const r = reachOf(manifest, ['shop.listOrders'])
  assert.deepEqual(r.functions.map(f => f.key), ['shop.listOrders'],
    'reading product names inside one function is not a licence to call another')
})

test('reach: read and write are told apart, because they are not the same risk', () => {
  const r = reachOf(manifest, ['shop.listOrders', 'shop.placeOrder'])
  const order = r.models.find(m => m.model === 'shop.Order')!
  const product = r.models.find(m => m.model === 'shop.Product')!
  assert.equal(order.write, true)
  assert.equal(product.write, false, 'placing an order reads a product; it does not edit one')
})

test('reach: a function that reads across legal entities is listed on its own', () => {
  const r = reachOf(manifest, ['shop.listOrders', 'shop.salesByCompany'])
  assert.deepEqual(r.crossCompany, ['shop.salesByCompany'])
})

test('reach: a function with no declared output is flagged, because its field reach is unknown', () => {
  const r = reachOf(manifest, ['shop.listOrders', 'shop.listProducts'])
  assert.deepEqual(r.unprojected, ['shop.listProducts'],
    'listOrders declares what it returns; listProducts hands back whole rows including cost')
})

test('reach: an unknown function is reported rather than silently ignored', () => {
  assert.deepEqual(reachOf(manifest, ['shop.nope']).unknown, ['shop.nope'])
})

test('reach: granting a whole module is just the union of its functions', () => {
  const all = functionsOf(manifest, 'shop')
  assert.deepEqual(all, ['shop.listOrders', 'shop.listProducts', 'shop.placeOrder', 'shop.salesByCompany'])
  const r = reachOf(manifest, all)
  assert.deepEqual(r.models.map(m => `${m.model}:${[m.read && 'r', m.write && 'w'].filter(Boolean).join('')}`),
    ['shop.Order:rw', 'shop.Product:r'])
})

test('reach: asking about a module nobody ships names what is shipped', () => {
  assert.throws(() => functionsOf(manifest, 'nosuch'), /no module "nosuch"/)
})

test('reach: granting nothing reaches nothing', () => {
  const r = reachOf(manifest, [])
  assert.deepEqual(r.models, [])
  assert.match(formatReach(r), /\(none\)/)
})

test('report: the inventory counts what cannot be stated at field level', () => {
  const out = formatInventory(manifest)
  assert.match(out, /4 function\(s\); 3 return an undeclared shape/)
  assert.match(out, /cross-company/)
})
