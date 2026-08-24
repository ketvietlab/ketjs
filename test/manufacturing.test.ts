import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { address, company, manufacturing, partner, product, stock, uom } from '@ketvietlab/ketsuite'

const modules = [address, partner, company, uom, product, stock, manufacturing]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }

const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  callFn(name, args, { adapter, manifest, scope })

async function boot(componentTracking: 'none' | 'lot' = 'none') {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, adapter)
  await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }, adapter)
  await call('uom.saveUnit', { id: 'kg', name: 'kg', relativeFactor: '1' }, adapter)
  for (const [templateId, productId, name, tracking] of [
    ['fruit-template', 'fruit', 'Fruit', componentTracking],
    ['basket-template', 'basket', 'Fruit basket', 'none'],
  ]) {
    await call(
      'product.saveTemplate',
      { id: templateId, name, type: 'goods', uomId: 'kg', listPrice: '0' },
      adapter,
    )
    await call(
      'product.saveVariant',
      { id: productId, templateId, combinationKey: '', defaultCode: productId.toUpperCase() },
      adapter,
    )
    await call('stock.configureProduct', { templateId, isStorable: true, tracking }, adapter)
  }
  for (const [id, name, usage] of [
    ['stock', 'Stock', 'internal'],
    ['production', 'Production', 'production'],
    ['finished', 'Finished goods', 'internal'],
    ['inventory', 'Inventory adjustment', 'inventory'],
  ])
    await call('stock.saveLocation', { id, name, usage }, adapter)
  if (componentTracking === 'lot')
    await call('stock.createLot', { id: 'fruit-lot', productId: 'fruit', name: 'FRUIT/001' }, adapter)
  await call(
    'stock.adjustInventory',
    {
      id: 'seed-fruit',
      productId: 'fruit',
      locationId: 'stock',
      inventoryLocationId: 'inventory',
      countedQuantity: '100',
      lotId: componentTracking === 'lot' ? 'fruit-lot' : undefined,
      productUomId: 'kg',
    },
    adapter,
  )
  return adapter
}

test('manufacturing: a BOM drives component consumption, work orders, and finished stock', async () => {
  const adapter = await boot()
  try {
    await call(
      'manufacturing.saveWorkCenter',
      { id: 'packing', code: 'PACK', name: 'Packing', capacity: '2' },
      adapter,
    )
    const bom = (
      await call(
        'manufacturing.saveBom',
        {
          id: 'basket-bom',
          code: 'BASKET-01',
          productId: 'basket',
          productQty: '10',
          productUomId: 'kg',
          operations: [
            {
              id: 'pack-operation',
              name: 'Pack basket',
              workCenterId: 'packing',
              durationExpected: 15,
            },
          ],
          lines: [
            {
              id: 'fruit-line',
              productId: 'fruit',
              productQty: '12',
              productUomId: 'kg',
              operationId: 'pack-operation',
            },
          ],
        },
        adapter,
      )
    ).value as Row
    assert.equal(bom.ok, true)

    const saved = (
      await call(
        'manufacturing.saveProduction',
        {
          id: 'mo-1',
          name: 'MO/0001',
          bomId: 'basket-bom',
          productQty: '20',
          productUomId: 'kg',
          sourceLocationId: 'stock',
          productionLocationId: 'production',
          destinationLocationId: 'finished',
          scheduledStart: '2026-08-24T08:00:00.000Z',
        },
        adapter,
      )
    ).value as Row
    assert.equal(saved.version, 1)

    const confirmed = (await call('manufacturing.confirmProduction', { id: 'mo-1', version: 1 }, adapter))
      .value as Row
    assert.equal(confirmed.ok, true)
    assert.deepEqual(confirmed.shortages, [])

    let production = (await call('manufacturing.getProduction', { id: 'mo-1' }, adapter)).value as Row
    assert.equal(production.state, 'confirmed')
    assert.equal((production.workOrders as Row[]).length, 1)
    const raw = (production.moves as Row[]).find((entry) => entry.kind === 'component')!
    assert.equal(
      Number((raw.move as Row).productUomQty),
      24,
      'BOM demand scales with the production quantity',
    )

    const work = (production.workOrders as Row[])[0]!
    await call('manufacturing.startWorkOrder', { id: work.id, version: work.version }, adapter)
    const active = ((await call('manufacturing.getProduction', { id: 'mo-1' }, adapter)).value as Row)
      .workOrders as Row[]
    await call('manufacturing.finishWorkOrder', { id: active[0]!.id, version: active[0]!.version }, adapter)

    production = (await call('manufacturing.getProduction', { id: 'mo-1' }, adapter)).value as Row
    const completed = (
      await call(
        'manufacturing.completeProduction',
        { id: 'mo-1', version: production.version, producedQuantity: '20' },
        adapter,
      )
    ).value as Row
    assert.equal(completed.ok, true)
    const balances = await adapter.all(
      'SELECT "productId", "locationId", quantity FROM stock_quant WHERE "locationId" IN (?, ?) ORDER BY "productId", "locationId"',
      ['stock', 'finished'],
    )
    assert.equal(Number(balances.find((row) => row.productId === 'fruit')!.quantity), 76)
    assert.equal(Number(balances.find((row) => row.productId === 'basket')!.quantity), 20)
  } finally {
    await adapter.close()
  }
})

test('manufacturing: a picked component reservation is not reserved and consumed twice', async () => {
  const adapter = await boot('lot')
  try {
    await call(
      'manufacturing.saveBom',
      {
        id: 'tracked-bom',
        productId: 'basket',
        productQty: '10',
        productUomId: 'kg',
        lines: [{ productId: 'fruit', productQty: '12', productUomId: 'kg' }],
      },
      adapter,
    )
    await call(
      'manufacturing.saveProduction',
      {
        id: 'mo-tracked',
        name: 'MO/TRACKED',
        bomId: 'tracked-bom',
        productQty: '20',
        productUomId: 'kg',
        sourceLocationId: 'stock',
        productionLocationId: 'production',
        destinationLocationId: 'finished',
        scheduledStart: '2026-08-24T08:00:00.000Z',
      },
      adapter,
    )
    await call('manufacturing.confirmProduction', { id: 'mo-tracked', version: 1 }, adapter)
    const production = (await call('manufacturing.getProduction', { id: 'mo-tracked' }, adapter)).value as Row
    const component = (production.moves as Row[]).find((entry) => entry.kind === 'component')!
    const move = component.move as Row
    const lines = await adapter.all('SELECT id, quantity, "lotId" FROM stock_move_line WHERE "moveId" = ?', [
      move.id,
    ])
    assert.equal(lines.length, 1)
    await call(
      'stock.saveMoveLine',
      {
        id: lines[0]!.id,
        moveId: move.id,
        quantity: lines[0]!.quantity,
        lotId: lines[0]!.lotId,
        picked: true,
      },
      adapter,
    )
    const completed = (
      await call(
        'manufacturing.completeProduction',
        { id: 'mo-tracked', version: production.version, producedQuantity: '20' },
        adapter,
      )
    ).value as Row
    assert.equal(completed.ok, true)
    const balance = await adapter.all(
      'SELECT quantity FROM stock_quant WHERE "productId" = ? AND "locationId" = ?',
      ['fruit', 'stock'],
    )
    assert.equal(Number(balance[0]!.quantity), 76)
  } finally {
    await adapter.close()
  }
})

test('manufacturing: completion fails closed when components are short', async () => {
  const adapter = await boot()
  try {
    await call(
      'manufacturing.saveBom',
      {
        id: 'short-bom',
        productId: 'basket',
        productQty: '1',
        productUomId: 'kg',
        lines: [{ productId: 'fruit', productQty: '150', productUomId: 'kg' }],
      },
      adapter,
    )
    await call(
      'manufacturing.saveProduction',
      {
        id: 'mo-short',
        name: 'MO/SHORT',
        bomId: 'short-bom',
        productQty: '1',
        productUomId: 'kg',
        sourceLocationId: 'stock',
        productionLocationId: 'production',
        destinationLocationId: 'finished',
        scheduledStart: '2026-08-24T08:00:00.000Z',
      },
      adapter,
    )
    const confirmed = (await call('manufacturing.confirmProduction', { id: 'mo-short', version: 1 }, adapter))
      .value as Row
    assert.equal((confirmed.shortages as Row[])[0]!.quantity, '50')
    const completed = (
      await call('manufacturing.completeProduction', { id: 'mo-short', version: 2 }, adapter)
    ).value as Row
    assert.equal(completed.ok, false)
    assert.equal((completed.errors as Row[])[0]!.code, 'manufacturing.error.stockShortage')
  } finally {
    await adapter.close()
  }
})
