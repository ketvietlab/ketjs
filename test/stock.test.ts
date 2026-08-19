import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callFn, compose, from, eq, migrateOne, registerFunctions, sqliteAdapter } from 'ketjs'
import type { Adapter, Manifest, Scope } from 'ketjs'
import { product, stock, uom } from 'ketsuite'

/**
 * Stock on Odoo's model, and the two ideas that carry it.
 *
 * Everything is a location, suppliers and customers included, so every movement is
 * a transfer between two of them and nothing is created or destroyed. And the
 * truth about how much is where lives in one place — the quant — so "what do we
 * have" is a sum and "why" is a list of moves.
 */
const mods = [uom, product, stock]
const SCOPE: Scope = { company: 'c1' }

async function boot(): Promise<{ adapter: Adapter; manifest: Manifest }> {
  const manifest = compose(mods)
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(mods)
  const o = { adapter, manifest, scope: SCOPE }
  const run = (fn: string, args: Record<string, unknown>) => callFn(fn, args, o).then(r => r.value as Record<string, unknown>)

  await run('uom.saveCategory', { id: 'dem', name: 'Đếm được' })
  await run('uom.saveUnit', { id: 'cai', categoryId: 'dem', name: 'Cái', type: 'reference', factor: 1, rounding: 1 })
  await run('uom.saveUnit', { id: 'thung', categoryId: 'dem', name: 'Thùng', type: 'bigger', factor: 0.1, rounding: 1 })
  await run('product.saveTemplate', { id: 't1', name: 'Xoài', type: 'goods', uomId: 'cai' })
  await run('product.saveVariant', { id: 'p1', templateId: 't1', sku: 'XOAI-01' })
  await run('stock.saveWarehouse', { id: 'wh', name: 'Kho chính', code: 'WH' })
  await run('stock.saveLocation', { id: 'vendors', name: 'Nhà cung cấp', usage: 'supplier' })
  await run('stock.saveLocation', { id: 'buyers', name: 'Khách hàng', usage: 'customer' })
  return { adapter, manifest }
}

const call = (o: { adapter: Adapter; manifest: Manifest }, fn: string, args: Record<string, unknown> = {}) =>
  callFn(fn, args, { ...o, scope: SCOPE }).then(r => r.value as Record<string, unknown>)

const receive = async (o: { adapter: Adapter; manifest: Manifest }, id: string, qty: number, uomId = 'cai') => {
  await call(o, 'stock.createMove', { id, productId: 'p1', uomId, quantity: qty, sourceId: 'vendors', destId: 'wh/stock' })
  return call(o, 'stock.applyMove', { id })
}

// ── the tree ─────────────────────────────────────────────────────────────────

test('warehouse: creating one gives it somewhere to put things', async () => {
  const o = await boot()
  const locs = await callFn('stock.listLocations', {}, { ...o, scope: SCOPE }).then(r => r.value as Array<Record<string, unknown>>)
  const view = locs.find(l => l.id === 'wh/view')
  const stockLoc = locs.find(l => l.id === 'wh/stock')
  assert.equal(view?.usage, 'view', 'the folder')
  assert.equal(stockLoc?.usage, 'internal', 'and the shelf inside it')
  assert.equal(stockLoc?.parentId, 'wh/view')
  await o.adapter.close()
})

test('location: a cycle in the tree is refused, because every later walk would hang', async () => {
  const o = await boot()
  await call(o, 'stock.saveLocation', { id: 'a', name: 'A', usage: 'internal' })
  await call(o, 'stock.saveLocation', { id: 'b', name: 'B', usage: 'internal', parentId: 'a' })
  const r = await call(o, 'stock.saveLocation', { id: 'a', name: 'A', usage: 'internal', parentId: 'b' })
  assert.equal(r.ok, false)
  assert.match(JSON.stringify(r.errors), /vòng/)
  await o.adapter.close()
})

test('location: a view holds nothing, so moving into one is refused', async () => {
  const o = await boot()
  const r = await call(o, 'stock.createMove', { id: 'm', productId: 'p1', uomId: 'cai', quantity: 1, sourceId: 'vendors', destId: 'wh/view' })
  assert.equal(r.ok, false)
  assert.match(JSON.stringify(r.errors), /view/)
  await o.adapter.close()
})

// ── double entry ─────────────────────────────────────────────────────────────

test('move: receiving adds here and subtracts there, so the books balance', async () => {
  const o = await boot()
  await receive(o, 'in1', 40)

  const here = await call(o, 'stock.onHand', { productId: 'p1', locationId: 'wh/stock' })
  const vendor = await call(o, 'stock.onHand', { productId: 'p1', locationId: 'vendors' })
  assert.equal(here.quantity, 40)
  assert.equal(vendor.quantity, -40, 'the vendor location going negative is the record that forty came from outside')
  assert.equal(Number(here.quantity) + Number(vendor.quantity), 0, 'nothing was created')
  await o.adapter.close()
})

test('move: on hand counts real locations only, not the virtual ones', async () => {
  const o = await boot()
  await receive(o, 'in1', 40)
  const total = await call(o, 'stock.onHand', { productId: 'p1' })
  assert.equal(total.quantity, 40, 'the vendor location at −40 is not stock we have')
  await o.adapter.close()
})

test('move: delivering takes it away again', async () => {
  const o = await boot()
  await receive(o, 'in1', 40)
  await call(o, 'stock.createMove', { id: 'out1', productId: 'p1', uomId: 'cai', quantity: 15, sourceId: 'wh/stock', destId: 'buyers' })
  await call(o, 'stock.applyMove', { id: 'out1' })
  assert.equal((await call(o, 'stock.onHand', { productId: 'p1' })).quantity, 25)
  assert.equal((await call(o, 'stock.onHand', { productId: 'p1', locationId: 'buyers' })).quantity, 15)
  await o.adapter.close()
})

test('move: a unit of the same category is converted, because a quant cannot mix units', async () => {
  const o = await boot()
  // 1 thùng = 10 cái (factor 0.1 against the reference).
  await receive(o, 'in1', 3, 'thung')
  assert.equal((await call(o, 'stock.onHand', { productId: 'p1' })).quantity, 30)
  await o.adapter.close()
})

test('move: a unit from another category is refused rather than guessed', async () => {
  const o = await boot()
  await call(o, 'uom.saveCategory', { id: 'canh', name: 'Khối lượng' })
  await call(o, 'uom.saveUnit', { id: 'kg', categoryId: 'canh', name: 'Kg', type: 'reference', factor: 1, rounding: 0.001 })
  const r = await call(o, 'stock.createMove', { id: 'm', productId: 'p1', uomId: 'kg', quantity: 1, sourceId: 'vendors', destId: 'wh/stock' })
  assert.equal(r.ok, false)
  await o.adapter.close()
})

test('move: source and destination must differ', async () => {
  const o = await boot()
  const r = await call(o, 'stock.createMove', { id: 'm', productId: 'p1', uomId: 'cai', quantity: 1, sourceId: 'wh/stock', destId: 'wh/stock' })
  assert.equal(r.ok, false)
  await o.adapter.close()
})

// ── reservation ──────────────────────────────────────────────────────────────

test('reserve: two moves cannot promise the same unit', async () => {
  const o = await boot()
  await receive(o, 'in1', 10)
  const mk = (id: string, qty: number) =>
    call(o, 'stock.createMove', { id, productId: 'p1', uomId: 'cai', quantity: qty, sourceId: 'wh/stock', destId: 'buyers' })
  await mk('a', 8)
  await mk('b', 8)

  assert.equal((await call(o, 'stock.reserveMove', { id: 'a' })).ok, true)
  const second = await call(o, 'stock.reserveMove', { id: 'b' })
  assert.equal(second.ok, false, 'ten on hand, eight already promised')
  assert.equal(second.shortBy, 6)
  // Answered rather than thrown: a shortfall is an ordinary outcome.
  assert.equal((await call(o, 'stock.onHand', { productId: 'p1' })).available, 2)
  await o.adapter.close()
})

test('reserve: cancelling gives the stock back', async () => {
  const o = await boot()
  await receive(o, 'in1', 10)
  await call(o, 'stock.createMove', { id: 'a', productId: 'p1', uomId: 'cai', quantity: 8, sourceId: 'wh/stock', destId: 'buyers' })
  await call(o, 'stock.reserveMove', { id: 'a' })
  assert.equal((await call(o, 'stock.onHand', { productId: 'p1' })).available, 2)
  await call(o, 'stock.cancelMove', { id: 'a' })
  assert.equal((await call(o, 'stock.onHand', { productId: 'p1' })).available, 10)
  await o.adapter.close()
})

test('reserve: applying spends the reservation rather than leaving it behind', async () => {
  const o = await boot()
  await receive(o, 'in1', 10)
  await call(o, 'stock.createMove', { id: 'a', productId: 'p1', uomId: 'cai', quantity: 8, sourceId: 'wh/stock', destId: 'buyers' })
  await call(o, 'stock.reserveMove', { id: 'a' })
  await call(o, 'stock.applyMove', { id: 'a' })
  const after = await call(o, 'stock.onHand', { productId: 'p1' })
  assert.deepEqual([after.quantity, after.reserved, after.available], [2, 0, 2],
    'stock promised to a move that has happened is neither on hand nor reserved')
  await o.adapter.close()
})

test('reserve: a virtual source reserves freely, since there is nothing there to run out of', async () => {
  const o = await boot()
  await call(o, 'stock.createMove', { id: 'in1', productId: 'p1', uomId: 'cai', quantity: 999, sourceId: 'vendors', destId: 'wh/stock' })
  assert.equal((await call(o, 'stock.reserveMove', { id: 'in1' })).ok, true)
  await o.adapter.close()
})

test('apply: more than is there is refused, and nothing moves', async () => {
  const o = await boot()
  await receive(o, 'in1', 5)
  await call(o, 'stock.createMove', { id: 'out', productId: 'p1', uomId: 'cai', quantity: 9, sourceId: 'wh/stock', destId: 'buyers' })
  const r = await call(o, 'stock.applyMove', { id: 'out' })
  assert.equal(r.ok, false)
  assert.equal((await call(o, 'stock.onHand', { productId: 'p1' })).quantity, 5, 'the transaction rolled back')
  await o.adapter.close()
})

test('apply: a done move cannot be cancelled, and applying twice does not double it', async () => {
  const o = await boot()
  await receive(o, 'in1', 10)
  assert.equal((await call(o, 'stock.onHand', { productId: 'p1' })).quantity, 10)
  await call(o, 'stock.applyMove', { id: 'in1' })
  assert.equal((await call(o, 'stock.onHand', { productId: 'p1' })).quantity, 10, 'idempotent, as declared')
  assert.equal((await call(o, 'stock.cancelMove', { id: 'in1' })).ok, false)
  await o.adapter.close()
})

// ── scope ────────────────────────────────────────────────────────────────────

test('scope: one company cannot see another company stock', async () => {
  const o = await boot()
  await receive(o, 'in1', 40)
  const other = await callFn('stock.onHand', { productId: 'p1' }, { ...o, scope: { company: 'c2' } })
  assert.equal((other.value as { quantity: number }).quantity, 0,
    'warehouses are company-scoped; products are shared, stock is not')
  await o.adapter.close()
})
