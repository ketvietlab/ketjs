import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compose,
  defineModule,
  reachOf,
  functionsOf,
  formatReach,
  formatInventory,
  permissionInventory,
  from,
} from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'

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
  jobs: { confirmOrder: { idempotent: true, handler: async () => {} } },
  functions: {
    // Shows product names in the order list, so it must say so.
    listOrders: {
      effects: ['read:shop.Order', 'read:shop.Product'],
      output: { id: 'text', total: 'decimal', productName: 'text' },
      handler: (ctx: Ctx) => ctx.db.all(from(ctx.table('shop.Order')).preload('product')),
    },
    // Browsing the catalogue is a different action, and stays a different grant.
    listProducts: {
      effects: ['read:shop.Product'],
      handler: (ctx: Ctx) => ctx.db.all(from(ctx.table('shop.Product'))),
    },
    placeOrder: {
      effects: ['read:shop.Product', 'write:shop.Order', 'enqueue:shop.confirmOrder'],
      handler: () => ({ ok: true }),
    },
    salesByCompany: { effects: ['read:shop.Order'], crossCompany: true, handler: () => [] },
  },
})

const manifest = compose([shop])

test('reach: granting the order list reaches product, and says which function did it', () => {
  const r = reachOf(manifest, ['shop.listOrders'])
  assert.deepEqual(
    r.models.map((m) => m.model),
    ['shop.Order', 'shop.Product'],
  )
  assert.deepEqual(
    r.models.find((m) => m.model === 'shop.Product')!.via,
    ['shop.listOrders'],
    'a surprise has to be traceable to its cause',
  )
})

test('reach: but it does NOT grant the catalogue — permission is on the action, not the table', () => {
  const r = reachOf(manifest, ['shop.listOrders'])
  assert.deepEqual(
    r.functions.map((f) => f.key),
    ['shop.listOrders'],
    'reading product names inside one function is not a licence to call another',
  )
})

test('reach: read and write are told apart, because they are not the same risk', () => {
  const r = reachOf(manifest, ['shop.listOrders', 'shop.placeOrder'])
  const order = r.models.find((m) => m.model === 'shop.Order')!
  const product = r.models.find((m) => m.model === 'shop.Product')!
  assert.equal(order.write, true)
  assert.equal(product.write, false, 'placing an order reads a product; it does not edit one')
  assert.deepEqual(r.functions.find((fn) => fn.key === 'shop.placeOrder')?.enqueues, ['shop.confirmOrder'])
  assert.equal(
    r.models.some((model) => model.model === 'shop.confirmOrder'),
    false,
    'an enqueue target is an operation, not a model',
  )
})

test('reach: a function that reads across legal entities is listed on its own', () => {
  const r = reachOf(manifest, ['shop.listOrders', 'shop.salesByCompany'])
  assert.deepEqual(r.crossCompany, ['shop.salesByCompany'])
})

test('reach: a function with no declared output is flagged, because its field reach is unknown', () => {
  const r = reachOf(manifest, ['shop.listOrders', 'shop.listProducts'])
  assert.deepEqual(
    r.unprojected,
    ['shop.listProducts'],
    'listOrders declares what it returns; listProducts hands back whole rows including cost',
  )
})

test('reach: an unknown function is reported rather than silently ignored', () => {
  assert.deepEqual(reachOf(manifest, ['shop.nope']).unknown, ['shop.nope'])
})

test('reach: granting a whole module is just the union of its functions', () => {
  const all = functionsOf(manifest, 'shop')
  assert.deepEqual(all, ['shop.listOrders', 'shop.listProducts', 'shop.placeOrder', 'shop.salesByCompany'])
  const r = reachOf(manifest, all)
  assert.deepEqual(
    r.models.map((m) => `${m.model}:${[m.read && 'r', m.write && 'w'].filter(Boolean).join('')}`),
    ['shop.Order:rw', 'shop.Product:r'],
  )
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

test('inventory: machine-readable output includes zero-function modules and every security marker', () => {
  const operations = defineModule({
    name: 'operations',
    depends: ['shop'],
    functions: {
      status: { anonymous: true, effects: [], output: { ok: 'bool' }, handler: () => ({ ok: true }) },
      rotate: { exposure: 'internal', effects: ['write:shop.Order'], handler: () => null },
      bootstrap: { exposure: 'internal', provision: true, effects: [], handler: () => null },
    },
  })
  const empty = defineModule({ name: 'empty' })
  const inventory = permissionInventory(compose([shop, operations, empty], { headless: true }))

  assert.deepEqual(
    inventory.modules.map((module) => [module.name, module.functions.length]),
    [
      ['empty', 0],
      ['operations', 3],
      ['shop', 4],
    ],
  )
  assert.deepEqual(inventory.totals, {
    modules: 3,
    functions: 7,
    grantable: 4,
    anonymous: 1,
    internal: 2,
    provision: 1,
    unprojected: 5,
  })
  assert.deepEqual(inventory.modules.find((module) => module.name === 'operations')?.functions, [
    {
      key: 'operations.bootstrap',
      module: 'operations',
      exposure: 'internal',
      anonymous: false,
      provision: true,
      grantable: false,
      effects: [],
      crossCompany: false,
      idempotent: false,
      dryRun: true,
      agent: false,
      input: {},
      output: {},
    },
    {
      key: 'operations.rotate',
      module: 'operations',
      exposure: 'internal',
      anonymous: false,
      provision: false,
      grantable: false,
      effects: ['write:shop.Order'],
      crossCompany: false,
      idempotent: false,
      dryRun: true,
      agent: false,
      input: {},
      output: {},
    },
    {
      key: 'operations.status',
      module: 'operations',
      exposure: 'http',
      anonymous: true,
      provision: false,
      grantable: false,
      effects: [],
      crossCompany: false,
      idempotent: false,
      dryRun: true,
      agent: false,
      input: {},
      output: { ok: 'bool' },
    },
  ])
  assert.equal(
    JSON.stringify(permissionInventory(compose([shop, operations, empty], { headless: true }))),
    JSON.stringify(inventory),
  )
})
