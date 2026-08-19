import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from 'ketjs'
import type { Adapter, Row } from 'ketjs'
import { pricing, product, stock, uom } from 'ketsuite'

const modules = [uom, product, pricing, stock]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }

async function call(name: string, args: Record<string, unknown>, adapter: Adapter) {
  return callFn(name, args, { adapter, manifest, scope })
}

async function boot() {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' }, adapter)
  await call(
    'product.saveTemplate',
    { id: 'tpl', name: 'Áo', type: 'goods', uomId: 'unit', listPrice: '100.00' },
    adapter,
  )
  await call(
    'product.saveVariant',
    { id: 'p1', templateId: 'tpl', defaultCode: 'AO', combinationKey: '' },
    adapter,
  )
  return adapter
}

test('product 19: company cost, UoM links and concurrent-safe variant generation', async () => {
  const adapter = await boot()
  try {
    await call('product.setCost', { productId: 'p1', amount: '60.25' }, adapter)
    assert.equal((await adapter.all('SELECT amount FROM product_cost'))[0]!.amount, '60.25')
    assert.equal((await adapter.all('SELECT "uomId" FROM product_template_uom'))[0]!.uomId, 'unit')

    await call('product.saveAttribute', { id: 'color', name: 'Màu' }, adapter)
    await call('product.saveAttributeValue', { id: 'red', attributeId: 'color', name: 'Đỏ' }, adapter)
    await call('product.saveAttributeValue', { id: 'blue', attributeId: 'color', name: 'Xanh' }, adapter)
    await call(
      'product.saveAttributeLine',
      { id: 'tpl:color', templateId: 'tpl', attributeId: 'color', valueIds: ['red', 'blue'] },
      adapter,
    )
    const first = await call('product.generateVariants', { templateId: 'tpl' }, adapter)
    const retry = await call('product.generateVariants', { templateId: 'tpl' }, adapter)
    assert.equal((first.value as { created: number }).created, 2)
    assert.equal((retry.value as { created: number }).created, 0)
  } finally {
    await adapter.close()
  }
})

test('pricing 19: Odoo precedence and percentage formula use company currency only', async () => {
  const adapter = await boot()
  try {
    await call('pricing.savePricelist', { id: 'retail', name: 'Retail' }, adapter)
    await call(
      'pricing.savePricelistItem',
      {
        id: 'global',
        pricelistId: 'retail',
        appliedOn: '3_global',
        computePrice: 'fixed',
        fixedPrice: '95',
      },
      adapter,
    )
    await call(
      'pricing.savePricelistItem',
      {
        id: 'variant',
        pricelistId: 'retail',
        appliedOn: '0_product_variant',
        productId: 'p1',
        computePrice: 'percentage',
        percentPrice: '10',
        minQuantity: '2',
      },
      adapter,
    )
    const one = await call(
      'pricing.priceFor',
      { pricelistId: 'retail', productId: 'p1', quantity: '1' },
      adapter,
    )
    const two = await call(
      'pricing.priceFor',
      { pricelistId: 'retail', productId: 'p1', quantity: '2' },
      adapter,
    )
    assert.equal(Number((one.value as Row).price), 95)
    assert.equal(Number((two.value as Row).price), 90)
    await call('pricing.savePricelist', { id: 'formula-list', name: 'Formula' }, adapter)
    await call(
      'pricing.savePricelistItem',
      {
        id: 'formula',
        pricelistId: 'formula-list',
        appliedOn: '3_global',
        computePrice: 'formula',
        priceDiscount: '20',
        priceRound: '5',
        priceSurcharge: '3',
        dateStart: '2026-01-01T00:00:00.000Z',
        dateEnd: '2026-12-31T23:59:59.999Z',
      },
      adapter,
    )
    const formula = await call(
      'pricing.priceFor',
      { pricelistId: 'formula-list', productId: 'p1', quantity: '1', date: '2026-08-20T00:00:00.000Z' },
      adapter,
    )
    assert.equal(Number((formula.value as Row).price), 83)
    assert.equal('currencyId' in manifest.models['pricing.Pricelist']!.fields, false)
  } finally {
    await adapter.close()
  }
})

test('stock 19: reservation lives on move lines, partial completion creates a backorder', async () => {
  const adapter = await boot()
  try {
    await call('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'none' }, adapter)
    await call('stock.saveWarehouse', { id: 'wh', name: 'Main', code: 'WH' }, adapter)
    await call('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' }, adapter)
    await call(
      'stock.saveLocation',
      { id: 'stock', name: 'Stock', usage: 'internal', warehouseId: 'wh' },
      adapter,
    )
    await call('stock.saveLocation', { id: 'customer', name: 'Customer', usage: 'customer' }, adapter)
    await call(
      'stock.adjustInventory',
      {
        id: 'adj1',
        productId: 'p1',
        locationId: 'stock',
        inventoryLocationId: 'inventory',
        countedQuantity: '10',
        productUomId: 'unit',
      },
      adapter,
    )
    await call(
      'stock.savePickingType',
      {
        id: 'out',
        name: 'Delivery',
        code: 'outgoing',
        defaultLocationSrcId: 'stock',
        defaultLocationDestId: 'customer',
        createBackorder: 'always',
      },
      adapter,
    )
    await call('stock.createPicking', { id: 'pick1', name: 'WH/OUT/1', pickingTypeId: 'out' }, adapter)
    await call(
      'stock.addMove',
      {
        id: 'move1',
        name: 'Áo',
        pickingId: 'pick1',
        productId: 'p1',
        productUomId: 'unit',
        productUomQty: '8',
      },
      adapter,
    )
    await call('stock.confirmPicking', { id: 'pick1' }, adapter)
    const reservation = await call('stock.reserveMove', { id: 'move1' }, adapter)
    assert.deepEqual(reservation.value, { ok: true, reserved: '8', state: 'assigned' })
    assert.equal('reservedQuantity' in manifest.models['stock.Move']!.fields, false)
    const line = (await adapter.all('SELECT id FROM stock_move_line WHERE "moveId" = ?', ['move1']))[0]!
    const completion = await call(
      'stock.completePicking',
      { id: 'pick1', quantities: [{ moveLineId: line.id, quantity: 5 }], createBackorder: true },
      adapter,
    )
    assert.ok((completion.value as Row).backorderId)
    const quant = (
      await adapter.all('SELECT quantity, "reservedQuantity" FROM stock_quant WHERE "locationId" = ?', [
        'stock',
      ])
    )[0]!
    assert.equal(quant.quantity, '5')
    assert.equal(quant.reservedQuantity, '0')
    assert.equal(
      (await adapter.all('SELECT COUNT(*) AS n FROM stock_picking WHERE "backorderId" = ?', ['pick1']))[0]!.n,
      1,
    )
  } finally {
    await adapter.close()
  }
})

test('routes 19: mts_else_mto chooses stock or procurement and links upstream moves', async () => {
  const adapter = await boot()
  try {
    await call('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'none' }, adapter)
    for (const [id, usage] of [
      ['supplier', 'supplier'],
      ['input', 'internal'],
      ['stock', 'internal'],
    ] as const)
      await call('stock.saveLocation', { id, name: id, usage }, adapter)
    await call('stock.savePickingType', { id: 'internal', name: 'Internal', code: 'internal' }, adapter)
    await call('stock.saveRoute', { id: 'buy_stock', name: 'Supply stock' }, adapter)
    await call(
      'stock.saveRule',
      {
        id: 'input-stock',
        name: 'Input to stock',
        routeId: 'buy_stock',
        action: 'pull',
        sequence: 10,
        locationSrcId: 'input',
        locationDestId: 'stock',
        pickingTypeId: 'internal',
        procureMethod: 'mts_else_mto',
      },
      adapter,
    )
    await call(
      'stock.saveRule',
      {
        id: 'supplier-input',
        name: 'Supplier to input',
        routeId: 'buy_stock',
        action: 'pull',
        sequence: 20,
        locationSrcId: 'supplier',
        locationDestId: 'input',
        pickingTypeId: 'internal',
        procureMethod: 'make_to_order',
      },
      adapter,
    )
    await call('stock.assignProductRoute', { productId: 'p1', routeId: 'buy_stock' }, adapter)
    const result = await call(
      'stock.procure',
      { moveId: 'need1', productId: 'p1', productUomId: 'unit', quantity: '4', locationId: 'stock' },
      adapter,
    )
    assert.equal((result.value as Row).method, 'make_to_order')
    assert.deepEqual((result.value as Row).moveIds, ['need1:upstream', 'need1'])
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM stock_move_link'))[0]!.n, 1)
  } finally {
    await adapter.close()
  }
})

test('stock 19: serial tracking reserves and completes one unit per serial', async () => {
  const adapter = await boot()
  try {
    await call('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'serial' }, adapter)
    await call('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' }, adapter)
    await call('stock.saveLocation', { id: 'stock', name: 'Stock', usage: 'internal' }, adapter)
    await call('stock.saveLocation', { id: 'customer', name: 'Customer', usage: 'customer' }, adapter)
    await call('stock.createLot', { id: 's1', productId: 'p1', name: 'S1' }, adapter)
    await call('stock.createLot', { id: 's2', productId: 'p1', name: 'S2' }, adapter)
    const missingSerial = await call(
      'stock.adjustInventory',
      {
        id: 'invalid-adjustment',
        productId: 'p1',
        locationId: 'stock',
        inventoryLocationId: 'inventory',
        countedQuantity: '1',
        productUomId: 'unit',
      },
      adapter,
    )
    assert.equal((missingSerial.value as Row).ok, false)
    for (const serial of ['s1', 's2'])
      await call(
        'stock.adjustInventory',
        {
          id: `adjust:${serial}`,
          productId: 'p1',
          locationId: 'stock',
          inventoryLocationId: 'inventory',
          countedQuantity: '1',
          lotId: serial,
          productUomId: 'unit',
        },
        adapter,
      )
    await call(
      'stock.savePickingType',
      {
        id: 'out',
        name: 'Delivery',
        code: 'outgoing',
        defaultLocationSrcId: 'stock',
        defaultLocationDestId: 'customer',
      },
      adapter,
    )
    await call(
      'stock.createPicking',
      { id: 'serial-pick', name: 'OUT/SERIAL', pickingTypeId: 'out' },
      adapter,
    )
    await call(
      'stock.addMove',
      {
        id: 'serial-move',
        name: 'Serial delivery',
        pickingId: 'serial-pick',
        productId: 'p1',
        productUomId: 'unit',
        productUomQty: '2',
      },
      adapter,
    )
    await call('stock.confirmPicking', { id: 'serial-pick' }, adapter)
    const reservation = await call('stock.reserveMove', { id: 'serial-move' }, adapter)
    assert.deepEqual(reservation.value, { ok: true, reserved: '2', state: 'assigned' })
    const lines = await adapter.all(
      'SELECT quantity, "lotId" FROM stock_move_line WHERE "moveId" = ? ORDER BY "lotId"',
      ['serial-move'],
    )
    assert.deepEqual(
      lines.map((line) => [line.lotId, line.quantity]),
      [
        ['s1', '1'],
        ['s2', '1'],
      ],
    )
    await call('stock.completePicking', { id: 'serial-pick' }, adapter)
    const quants = await adapter.all(
      'SELECT quantity, "reservedQuantity" FROM stock_quant WHERE "locationId" = ? ORDER BY "lotKey"',
      ['stock'],
    )
    assert.deepEqual(
      quants.map((quant) => [quant.quantity, quant.reservedQuantity]),
      [
        ['0', '0'],
        ['0', '0'],
      ],
    )
  } finally {
    await adapter.close()
  }
})

test('replenishment 19: orderpoint forecasts its location and uses replenishment UoM', async () => {
  const adapter = await boot()
  try {
    await call('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'none' }, adapter)
    await call('stock.saveLocation', { id: 'supplier', name: 'Supplier', usage: 'supplier' }, adapter)
    await call('stock.saveLocation', { id: 'stock', name: 'Stock', usage: 'internal' }, adapter)
    await call('stock.savePickingType', { id: 'incoming', name: 'Receipt', code: 'incoming' }, adapter)
    await call('stock.saveRoute', { id: 'buy', name: 'Buy' }, adapter)
    await call(
      'stock.saveRule',
      {
        id: 'supplier-stock',
        name: 'Supplier to stock',
        routeId: 'buy',
        action: 'pull',
        locationSrcId: 'supplier',
        locationDestId: 'stock',
        pickingTypeId: 'incoming',
        procureMethod: 'make_to_order',
      },
      adapter,
    )
    await call(
      'stock.saveOrderpoint',
      {
        id: 'op',
        productId: 'p1',
        locationId: 'stock',
        minQuantity: '3',
        maxQuantity: '10',
        quantityMultiple: '2',
        replenishmentUomId: 'unit',
        routeId: 'buy',
      },
      adapter,
    )
    const result = await call('stock.runOrderpoint', { id: 'op', moveId: 'replenish:1' }, adapter)
    assert.deepEqual(result.value, {
      ok: true,
      moveIds: ['replenish:1'],
      method: 'make_to_order',
      quantity: '10',
    })
    const move = (
      await adapter.all('SELECT "productUomId", "productUomQty" FROM stock_move WHERE id = ?', [
        'replenish:1',
      ])
    )[0]!
    assert.deepEqual([move.productUomId, move.productUomQty], ['unit', '10'])
  } finally {
    await adapter.close()
  }
})

test('multi-warehouse: stock, forecast, reservation and default routes stay warehouse-local', async () => {
  const adapter = await boot()
  try {
    await call('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'none' }, adapter)
    await call('stock.saveWarehouse', { id: 'wh-a', name: 'Kho A', code: 'WHA' }, adapter)
    await call('stock.saveWarehouse', { id: 'wh-b', name: 'Kho B', code: 'WHB' }, adapter)
    await call('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' }, adapter)
    await call(
      'stock.saveLocation',
      { id: 'a-stock', name: 'A/Stock', usage: 'internal', warehouseId: 'wh-a' },
      adapter,
    )
    await call(
      'stock.saveLocation',
      { id: 'b-stock', name: 'B/Stock', usage: 'internal', warehouseId: 'wh-b' },
      adapter,
    )
    await call('stock.saveLocation', { id: 'customer', name: 'Customer', usage: 'customer' }, adapter)
    await call(
      'stock.adjustInventory',
      {
        id: 'adj-a',
        productId: 'p1',
        locationId: 'a-stock',
        inventoryLocationId: 'inventory',
        countedQuantity: '9',
        productUomId: 'unit',
      },
      adapter,
    )
    await call(
      'stock.adjustInventory',
      {
        id: 'adj-b',
        productId: 'p1',
        locationId: 'b-stock',
        inventoryLocationId: 'inventory',
        countedQuantity: '3',
        productUomId: 'unit',
      },
      adapter,
    )
    const a = (await call('stock.forecast', { productId: 'p1', locationId: 'a-stock' }, adapter)).value as Row
    const b = (await call('stock.forecast', { productId: 'p1', locationId: 'b-stock' }, adapter)).value as Row
    assert.equal(Number(a.forecast), 9)
    assert.equal(Number(b.forecast), 3)

    await call(
      'stock.addMove',
      {
        id: 'a-out',
        name: 'A delivery',
        productId: 'p1',
        productUomId: 'unit',
        productUomQty: '4',
        locationId: 'a-stock',
        locationDestId: 'customer',
      },
      adapter,
    )
    await call('stock.reserveMove', { id: 'a-out' }, adapter)
    const quants = await adapter.all(
      'SELECT "locationId", "reservedQuantity" FROM stock_quant ORDER BY "locationId"',
    )
    assert.deepEqual(
      quants.map((row) => [row.locationId, row.reservedQuantity]),
      [
        ['a-stock', '4'],
        ['b-stock', '0'],
      ],
    )

    await call('stock.savePickingType', { id: 'internal', name: 'Internal', code: 'internal' }, adapter)
    await call('stock.saveRoute', { id: 'route-b', name: 'Supply B' }, adapter)
    await call(
      'stock.saveRule',
      {
        id: 'a-to-b',
        name: 'A to B',
        routeId: 'route-b',
        action: 'pull',
        locationSrcId: 'a-stock',
        locationDestId: 'b-stock',
        pickingTypeId: 'internal',
      },
      adapter,
    )
    await call('stock.assignWarehouseRoute', { warehouseId: 'wh-b', routeId: 'route-b' }, adapter)
    const procurement = await call(
      'stock.procure',
      { moveId: 'supply-b', productId: 'p1', productUomId: 'unit', quantity: '2', locationId: 'b-stock' },
      adapter,
    )
    assert.deepEqual((procurement.value as Row).moveIds, ['supply-b'])
    const move = (
      await adapter.all('SELECT "locationId", "locationDestId" FROM stock_move WHERE id = ?', ['supply-b'])
    )[0]!
    assert.deepEqual([move.locationId, move.locationDestId], ['a-stock', 'b-stock'])
  } finally {
    await adapter.close()
  }
})
