import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { company, partner, pricing, product, stock, uom } from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'

const modules = [address, partner, company, uom, product, pricing, stock]
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
  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, adapter)
  await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }, adapter)
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

test('stock: the warehouse counts every move in the product\u2019s own unit', async () => {
  const adapter = await boot()
  try {
    await call(
      'uom.saveUnit',
      { id: 'box', name: 'Box', relativeFactor: '12', relativeUomId: 'unit' },
      adapter,
    )
    await call('uom.saveUnit', { id: 'kg', name: 'Kg', relativeFactor: '1' }, adapter)
    await call('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'none' }, adapter)
    await call('stock.saveLocation', { id: 'sup', name: 'Vendors', usage: 'supplier' }, adapter)
    await call('stock.saveLocation', { id: 'stk', name: 'Stock', usage: 'internal' }, adapter)
    await call('stock.saveLocation', { id: 'cust', name: 'Customers', usage: 'customer' }, adapter)
    await call(
      'stock.savePickingType',
      {
        id: 'in',
        name: 'Receipts',
        code: 'incoming',
        defaultLocationSrcId: 'sup',
        defaultLocationDestId: 'stk',
        createBackorder: 'always',
      },
      adapter,
    )
    await call(
      'stock.savePickingType',
      {
        id: 'out',
        name: 'Deliveries',
        code: 'outgoing',
        defaultLocationSrcId: 'stk',
        defaultLocationDestId: 'cust',
        createBackorder: 'always',
      },
      adapter,
    )

    // A unit from another measurement tree is refused at the door.
    await call(
      'stock.createPicking',
      { id: 'r1', name: 'R1', pickingTypeId: 'in', scheduledDate: '2026-09-01T00:00:00.000Z' },
      adapter,
    )
    const wrong = (
      await call(
        'stock.addMove',
        { id: 'bad', name: 'x', pickingId: 'r1', productId: 'p1', productUomId: 'kg', productUomQty: '5' },
        adapter,
      )
    ).value as Row
    assert.equal(wrong.ok, false)

    // A receipt raised in boxes is ledgered in pieces: two boxes of twelve put
    // twenty-four on the shelf, not two.
    await call(
      'stock.addMove',
      { id: 'm1', name: 'G', pickingId: 'r1', productId: 'p1', productUomId: 'box', productUomQty: '2' },
      adapter,
    )
    const move = (
      await adapter.all('SELECT "productUomId", "productUomQty" FROM stock_move WHERE id=?', ['m1'])
    )[0]!
    assert.equal(move.productUomId, 'unit')
    assert.equal(Number(move.productUomQty), 24)
    await call('stock.confirmPicking', { id: 'r1' }, adapter)
    await call('stock.saveMoveLine', { id: 'ml1', moveId: 'm1', quantity: '24', picked: true }, adapter)
    await call('stock.completePicking', { id: 'r1' }, adapter)
    const onHand = (await adapter.all('SELECT quantity FROM stock_quant WHERE "locationId"=?', ['stk']))[0]!
    assert.equal(Number(onHand.quantity), 24)

    // Reserving one box holds twelve pieces, not one.
    await call(
      'stock.createPicking',
      { id: 'd1', name: 'D1', pickingTypeId: 'out', scheduledDate: '2026-09-02T00:00:00.000Z' },
      adapter,
    )
    await call(
      'stock.addMove',
      { id: 'm2', name: 'G', pickingId: 'd1', productId: 'p1', productUomId: 'box', productUomQty: '1' },
      adapter,
    )
    await call('stock.confirmPicking', { id: 'd1' }, adapter)
    const reserved = (await call('stock.reserveMove', { id: 'm2' }, adapter)).value as Row
    assert.equal(reserved.reserved, '12')
    const quant = (
      await adapter.all('SELECT "reservedQuantity" FROM stock_quant WHERE "locationId"=?', ['stk'])
    )[0]!
    assert.equal(Number(quant.reservedQuantity), 12)
  } finally {
    await adapter.close()
  }
})

test('stock: an inventory count spoken in boxes corrects the shelf in pieces', async () => {
  const adapter = await boot()
  try {
    await call(
      'uom.saveUnit',
      { id: 'box', name: 'Box', relativeFactor: '12', relativeUomId: 'unit' },
      adapter,
    )
    await call('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'none' }, adapter)
    await call('stock.saveLocation', { id: 'stk', name: 'Stock', usage: 'internal' }, adapter)
    await call('stock.saveLocation', { id: 'inv', name: 'Inventory', usage: 'inventory' }, adapter)
    const counted = (
      await call(
        'stock.adjustInventory',
        {
          id: 'adj1',
          productId: 'p1',
          locationId: 'stk',
          inventoryLocationId: 'inv',
          countedQuantity: '2',
          productUomId: 'box',
        },
        adapter,
      )
    ).value as Row
    assert.equal(counted.difference, '24')
    const quant = (await adapter.all('SELECT quantity FROM stock_quant WHERE "locationId"=?', ['stk']))[0]!
    assert.equal(Number(quant.quantity), 24)
  } finally {
    await adapter.close()
  }
})

test('stock: an orderpoint replenishing in boxes raises its chain in pieces', async () => {
  const adapter = await boot()
  try {
    await call(
      'uom.saveUnit',
      { id: 'box', name: 'Box', relativeFactor: '12', relativeUomId: 'unit' },
      adapter,
    )
    await call('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'none' }, adapter)
    await call('stock.saveWarehouse', { id: 'wh', name: 'Main', code: 'WH' }, adapter)
    const internal = ((await call('stock.listLocations', {}, adapter)).value as Row[]).find(
      (row) => row.usage === 'internal',
    )!
    await call(
      'stock.saveOrderpoint',
      {
        id: 'op1',
        productId: 'p1',
        warehouseId: 'wh',
        locationId: internal.id,
        trigger: 'manual',
        minQuantity: '10',
        maxQuantity: '48',
        replenishmentUomId: 'box',
      },
      adapter,
    )
    const run = (await call('stock.runOrderpoint', { id: 'op1', moveId: 'rp1' }, adapter)).value as Row
    // The operator is told boxes; the ledger is kept in pieces.
    assert.equal(run.quantity, '4')
    const move = (
      await adapter.all('SELECT "productUomId", "productUomQty" FROM stock_move WHERE id=?', ['rp1'])
    )[0]!
    assert.equal(move.productUomId, 'unit')
    assert.equal(Number(move.productUomQty), 48)
  } finally {
    await adapter.close()
  }
})

test('product-stock: company cost, UoM links and concurrent-safe variant generation', async () => {
  const adapter = await boot()
  try {
    await call('product.setCost', { productId: 'p1', standardPrice: '60.25' }, adapter)
    assert.equal((await adapter.all('SELECT "standardPrice" FROM product_cost'))[0]!.standardPrice, '60.25')
    await call('product.addTemplateUom', { templateId: 'tpl', uomId: 'unit' }, adapter)
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

test('product-stock: default/no-variant behavior, archive/reactivate, barcode and company cost invariants', async () => {
  const adapter = await boot()
  try {
    const initial = (await call('product.generateVariants', { templateId: 'tpl' }, adapter)).value as Row
    assert.deepEqual(initial.ids, ['p1'])
    assert.equal(initial.created, 0)

    assert.equal(
      (
        (await call('product.saveVariant', { id: 'p1', templateId: 'tpl', barcode: '893000000001' }, adapter))
          .value as Row
      ).ok,
      true,
    )
    const collision = (
      await call('product.saveVariant', { id: 'p2', templateId: 'tpl', barcode: '893000000001' }, adapter)
    ).value as Row
    assert.equal(collision.ok, false)

    await call('product.saveAttribute', { id: 'color', name: 'Color', createVariant: 'always' }, adapter)
    await call('product.saveAttributeValue', { id: 'red', attributeId: 'color', name: 'Red' }, adapter)
    await call('product.saveAttributeValue', { id: 'blue', attributeId: 'color', name: 'Blue' }, adapter)
    await call('product.saveAttribute', { id: 'note', name: 'Note', createVariant: 'no_variant' }, adapter)
    await call('product.saveAttributeValue', { id: 'gift', attributeId: 'note', name: 'Gift' }, adapter)
    await call(
      'product.saveAttributeLine',
      { id: 'tpl:color', templateId: 'tpl', attributeId: 'color', valueIds: ['red', 'blue'] },
      adapter,
    )
    await call(
      'product.saveAttributeLine',
      { id: 'tpl:note', templateId: 'tpl', attributeId: 'note', valueIds: ['gift'] },
      adapter,
    )
    const generated = (await call('product.generateVariants', { templateId: 'tpl' }, adapter)).value as Row
    assert.deepEqual(generated.ids, ['tpl:blue', 'tpl:red'])

    await call(
      'product.saveAttributeLine',
      { id: 'tpl:color', templateId: 'tpl', attributeId: 'color', valueIds: ['red'] },
      adapter,
    )
    await call('product.generateVariants', { templateId: 'tpl' }, adapter)
    assert.equal(
      (await adapter.all('SELECT active FROM product_product WHERE id = ?', ['tpl:blue']))[0]!.active,
      0,
    )
    await call(
      'product.saveAttributeLine',
      { id: 'tpl:color', templateId: 'tpl', attributeId: 'color', valueIds: ['red', 'blue'] },
      adapter,
    )
    const reactivated = (await call('product.generateVariants', { templateId: 'tpl' }, adapter)).value as Row
    assert.equal(reactivated.created, 0)
    assert.equal(
      (await adapter.all('SELECT active FROM product_product WHERE id = ?', ['tpl:blue']))[0]!.active,
      1,
    )

    await call('product.setCost', { productId: 'p1', standardPrice: '60' }, adapter)
    await call('partner.savePartner', { id: 'beta-party', kind: 'company', name: 'Beta' }, adapter)
    await call('company.saveCompany', { id: 'beta', partnerId: 'beta-party', currency: 'VND' }, adapter)
    await callFn(
      'product.setCost',
      { productId: 'p1', standardPrice: '75' },
      { adapter, manifest, scope: { company: 'beta', branches: null } },
    )
    const acme = (await call('product.getVariant', { id: 'p1' }, adapter)).value as Row
    const beta = (
      await callFn(
        'product.getVariant',
        { id: 'p1' },
        {
          adapter,
          manifest,
          scope: { company: 'beta', branches: null },
        },
      )
    ).value as Row
    assert.equal(Number((acme.cost as Row).standardPrice), 60)
    assert.equal(Number((beta.cost as Row).standardPrice), 75)
  } finally {
    await adapter.close()
  }
})

test('product-stock: rule precedence and percentage formulas use company currency only', async () => {
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

test('product-stock: ancestor scope, UoM quantity, date bounds, nesting, margins and loops are deterministic', async () => {
  const adapter = await boot()
  try {
    await call(
      'uom.saveUnit',
      { id: 'box', name: 'Box', relativeUomId: 'unit', relativeFactor: '10' },
      adapter,
    )
    await call('product.saveCategory', { id: 'all', name: 'All' }, adapter)
    await call('product.saveCategory', { id: 'shirts', name: 'Shirts', parentId: 'all' }, adapter)
    await call(
      'product.saveTemplate',
      { id: 'tpl', name: 'Áo', type: 'goods', categoryId: 'shirts', uomId: 'unit' },
      adapter,
    )
    await call('pricing.savePricelist', { id: 'category-list', name: 'Category' }, adapter)
    for (const item of [
      { id: 'parent-price', categoryId: 'all', fixedPrice: '80' },
      { id: 'child-price', categoryId: 'shirts', fixedPrice: '70' },
    ])
      await call(
        'pricing.savePricelistItem',
        {
          ...item,
          pricelistId: 'category-list',
          appliedOn: '2_product_category',
          computePrice: 'fixed',
          minQuantity: '10',
        },
        adapter,
      )
    const converted = (
      await call(
        'pricing.priceFor',
        { pricelistId: 'category-list', productId: 'p1', quantity: '1', uomId: 'box' },
        adapter,
      )
    ).value as Row
    assert.deepEqual([Number(converted.price), converted.ruleId], [70, 'child-price'])

    await call('pricing.savePricelist', { id: 'dated', name: 'Dated' }, adapter)
    await call(
      'pricing.savePricelistItem',
      {
        id: 'dated-rule',
        pricelistId: 'dated',
        appliedOn: '3_global',
        computePrice: 'fixed',
        fixedPrice: '77',
        dateStart: '2026-08-01T00:00:00.000Z',
        dateEnd: '2026-08-31T23:59:59.999Z',
      },
      adapter,
    )
    for (const date of ['2026-08-01T00:00:00.000Z', '2026-08-31T23:59:59.999Z']) {
      const result = (
        await call(
          'pricing.priceFor',
          { pricelistId: 'dated', productId: 'p1', quantity: '1', date },
          adapter,
        )
      ).value as Row
      assert.equal(Number(result.price), 77)
    }

    await call('pricing.savePricelist', { id: 'base-list', name: 'Base' }, adapter)
    await call('pricing.savePricelist', { id: 'nested-list', name: 'Nested' }, adapter)
    await call(
      'pricing.savePricelistItem',
      {
        id: 'base-rule',
        pricelistId: 'base-list',
        appliedOn: '3_global',
        computePrice: 'fixed',
        fixedPrice: '80',
      },
      adapter,
    )
    await call(
      'pricing.savePricelistItem',
      {
        id: 'nested-rule',
        pricelistId: 'nested-list',
        appliedOn: '3_global',
        base: 'pricelist',
        basePricelistId: 'base-list',
        computePrice: 'formula',
        priceDiscount: '-20',
        priceRound: '5',
        priceSurcharge: '3',
        priceMaxMargin: '8',
      },
      adapter,
    )
    const nested = (
      await call('pricing.priceFor', { pricelistId: 'nested-list', productId: 'p1', quantity: '1' }, adapter)
    ).value as Row
    assert.equal(Number(nested.price), 88)

    await call('pricing.savePricelist', { id: 'loop-a', name: 'Loop A' }, adapter)
    await call('pricing.savePricelist', { id: 'loop-b', name: 'Loop B' }, adapter)
    for (const [id, pricelistId, basePricelistId] of [
      ['loop-a-rule', 'loop-a', 'loop-b'],
      ['loop-b-rule', 'loop-b', 'loop-a'],
    ])
      await call(
        'pricing.savePricelistItem',
        {
          id,
          pricelistId,
          appliedOn: '3_global',
          base: 'pricelist',
          basePricelistId,
          computePrice: 'formula',
        },
        adapter,
      )
    const loop = (
      await call('pricing.priceFor', { pricelistId: 'loop-a', productId: 'p1', quantity: '1' }, adapter)
    ).value as Row
    assert.equal(loop.ok, false)
    assert.match(String((loop.errors as Row[])[0]!.message), /recursive pricelist/)
  } finally {
    await adapter.close()
  }
})

test('product-stock: reservation lives on move lines, partial completion creates a backorder', async () => {
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
      Number((await adapter.all('SELECT SUM(CAST(quantity AS REAL)) AS total FROM stock_quant'))[0]!.total),
      0,
    )
    assert.equal(
      (await adapter.all('SELECT COUNT(*) AS n FROM stock_picking WHERE "backorderId" = ?', ['pick1']))[0]!.n,
      1,
    )
    assert.equal(
      (
        (
          await call(
            'stock.addMove',
            {
              id: 'late-move',
              name: 'Too late',
              pickingId: 'pick1',
              productId: 'p1',
              productUomId: 'unit',
              productUomQty: '1',
            },
            adapter,
          )
        ).value as Row
      ).ok,
      false,
    )
    assert.equal(
      (
        (
          await call(
            'stock.saveMoveLine',
            { id: line.id, moveId: 'move1', quantity: '1', picked: true },
            adapter,
          )
        ).value as Row
      ).ok,
      false,
    )

    await call('stock.createPicking', { id: 'cancelled', name: 'WH/OUT/C', pickingTypeId: 'out' }, adapter)
    assert.equal(((await call('stock.assignPicking', { id: 'cancelled' }, adapter)).value as Row).ok, false)
    await call('stock.cancelPicking', { id: 'cancelled' }, adapter)
    assert.equal(((await call('stock.completePicking', { id: 'cancelled' }, adapter)).value as Row).ok, false)
  } finally {
    await adapter.close()
  }
})

test('product-stock: mts_else_mto chooses stock or procurement and links upstream moves', async () => {
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

test('product-stock: listRules applies the active-record default', async () => {
  const adapter = await boot()
  try {
    await call('stock.saveWarehouse', { id: 'wh', name: 'Main', code: 'WH' }, adapter)
    const listed = (await call('stock.listRules', {}, adapter)).value as Row[]
    assert.equal(listed.length, 2)
    assert.equal(
      listed.every((rule) => rule.active === true),
      true,
    )
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM stock_rule WHERE active = 0'))[0]!.n, 8)
  } finally {
    await adapter.close()
  }
})

test('product-stock: completing a move triggers assigned push rules exactly once', async () => {
  const adapter = await boot()
  try {
    await call('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'none' }, adapter)
    for (const [id, usage] of [
      ['supplier', 'supplier'],
      ['input', 'internal'],
      ['stock', 'internal'],
    ] as const)
      await call('stock.saveLocation', { id, name: id, usage }, adapter)
    await call(
      'stock.savePickingType',
      {
        id: 'incoming',
        name: 'Receipts',
        code: 'incoming',
        defaultLocationSrcId: 'supplier',
        defaultLocationDestId: 'input',
      },
      adapter,
    )
    await call('stock.saveRoute', { id: 'push-route', name: 'Push to Stock' }, adapter)
    await call(
      'stock.saveRule',
      {
        id: 'input-push-stock',
        name: 'Input to Stock',
        routeId: 'push-route',
        action: 'push',
        locationSrcId: 'input',
        locationDestId: 'stock',
        pickingTypeId: 'incoming',
      },
      adapter,
    )
    await call('stock.assignProductRoute', { productId: 'p1', routeId: 'push-route' }, adapter)
    await call('stock.createPicking', { id: 'receipt', name: 'IN/1', pickingTypeId: 'incoming' }, adapter)
    await call(
      'stock.addMove',
      {
        id: 'receipt-move',
        name: 'Receipt',
        pickingId: 'receipt',
        productId: 'p1',
        productUomId: 'unit',
        productUomQty: '4',
      },
      adapter,
    )
    await call('stock.confirmPicking', { id: 'receipt' }, adapter)
    await call('stock.saveMoveLine', { id: 'receipt-line', moveId: 'receipt-move', quantity: '4' }, adapter)
    await call('stock.completePicking', { id: 'receipt' }, adapter)
    await call('stock.completePicking', { id: 'receipt' }, adapter)
    const pushed = await adapter.all(
      'SELECT "locationId", "locationDestId", "ruleId" FROM stock_move WHERE origin = ?',
      ['push:receipt-move'],
    )
    assert.deepEqual(
      pushed.map((row) => [row.locationId, row.locationDestId, row.ruleId]),
      [['input', 'stock', 'input-push-stock']],
    )
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM stock_move_link'))[0]!.n, 1)
  } finally {
    await adapter.close()
  }
})

test('product-stock: two and three step settings generate idempotent route chains', async () => {
  const cases = [
    {
      receptionSteps: 'two_steps',
      deliverySteps: 'pick_ship',
      receipt: [
        ['wh:supplier', 'wh:input'],
        ['wh:input', 'wh:stock'],
      ],
      delivery: [
        ['wh:stock', 'wh:output'],
        ['wh:output', 'wh:customer'],
      ],
    },
    {
      receptionSteps: 'three_steps',
      deliverySteps: 'pick_pack_ship',
      receipt: [
        ['wh:supplier', 'wh:input'],
        ['wh:input', 'wh:quality'],
        ['wh:quality', 'wh:stock'],
      ],
      delivery: [
        ['wh:stock', 'wh:pack'],
        ['wh:pack', 'wh:output'],
        ['wh:output', 'wh:customer'],
      ],
    },
  ] as const
  for (const [index, entry] of cases.entries()) {
    const adapter = await boot()
    try {
      await call('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'none' }, adapter)
      const input = {
        id: 'wh',
        name: 'Main',
        code: 'WH',
        receptionSteps: entry.receptionSteps,
        deliverySteps: entry.deliverySteps,
      }
      assert.deepEqual((await call('stock.saveWarehouse', input, adapter)).value, { ok: true, id: 'wh' })
      await call('stock.saveWarehouse', input, adapter)
      assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM stock_route'))[0]!.n, 2)
      assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM stock_warehouse_route'))[0]!.n, 2)

      const receipt = (
        await call(
          'stock.procure',
          {
            moveId: `receipt:${index}`,
            productId: 'p1',
            productUomId: 'unit',
            quantity: '4',
            locationId: 'wh:stock',
          },
          adapter,
        )
      ).value as Row
      const delivery = (
        await call(
          'stock.procure',
          {
            moveId: `delivery:${index}`,
            productId: 'p1',
            productUomId: 'unit',
            quantity: '3',
            locationId: 'wh:customer',
          },
          adapter,
        )
      ).value as Row
      assert.equal(receipt.ok, true)
      assert.equal(delivery.ok, true)
      const pairs = async (ids: unknown[]) => {
        const result: string[][] = []
        for (const id of ids) {
          const move = (
            await adapter.all('SELECT "locationId", "locationDestId" FROM stock_move WHERE id = ?', [id])
          )[0]!
          result.push([String(move.locationId), String(move.locationDestId)])
        }
        return result
      }
      assert.deepEqual(await pairs(receipt.moveIds as unknown[]), entry.receipt)
      assert.deepEqual(await pairs(delivery.moveIds as unknown[]), entry.delivery)
    } finally {
      await adapter.close()
    }
  }
})

test('product-stock: serial tracking reserves and completes one unit per serial', async () => {
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

test('product-stock: orderpoint forecasts its location and uses replenishment UoM', async () => {
  const adapter = await boot()
  try {
    await call('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'none' }, adapter)
    await call('stock.saveWarehouse', { id: 'wh', name: 'Main', code: 'WH' }, adapter)
    await call('stock.saveLocation', { id: 'supplier', name: 'Supplier', usage: 'supplier' }, adapter)
    await call(
      'stock.saveLocation',
      { id: 'stock', name: 'Stock', usage: 'internal', warehouseId: 'wh' },
      adapter,
    )
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
        warehouseId: 'wh',
        locationId: 'stock',
        trigger: 'auto',
        minQuantity: '3',
        maxQuantity: '10',
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
      'SELECT "locationId", "reservedQuantity" FROM stock_quant WHERE "locationId" IN (?, ?) ORDER BY "locationId"',
      ['a-stock', 'b-stock'],
    )
    assert.deepEqual(
      quants.map((row) => [row.locationId, row.reservedQuantity]),
      [
        ['a-stock', '4'],
        ['b-stock', '0'],
      ],
    )
    assert.equal(
      Number((await adapter.all('SELECT SUM(CAST(quantity AS REAL)) AS total FROM stock_quant'))[0]!.total),
      0,
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

/**
 * A session that can read two companies but writes to one. Stock reads span the
 * readable set unless a function narrows them, and every stock model is company
 * scoped — so this is the scope that tells narrowing apart from its absence.
 */
const bothCompanies = { company: 'acme', companies: ['acme', 'globex'], branches: null }

const callAs = (
  name: string,
  args: Record<string, unknown>,
  adapter: Adapter,
  as: { company: string; companies?: string[]; branches: null } = scope,
) => callFn(name, args, { adapter, manifest, scope: as })

/**
 * A warehouse and the locations saveWarehouse derives from it. The id is the
 * caller's, and it is a tenant-wide primary key, so two companies each get their
 * own — which is what the admin does with randomUUID().
 */
const seedWarehouse = async (adapter: Adapter, as = scope, id = 'wh') => {
  await callAs('stock.saveWarehouse', { id, name: 'Kho', code: 'WH' }, adapter, as)
  return {
    warehouseId: id,
    stockId: `${id}:stock`,
    inventoryId: `${id}:inventory`,
    supplierId: `${id}:supplier`,
    customerId: `${id}:customer`,
    outgoingId: `${id}:outgoing`,
  }
}

test('stock: a picked move line keeps one reservation however often it is saved', async () => {
  const adapter = await boot()
  try {
    const { stockId, customerId } = await seedWarehouse(adapter)
    await call('stock.configureProduct', { templateId: 'tpl', isStorable: true }, adapter)
    await call(
      'stock.adjustInventory',
      {
        id: 'count-1',
        productId: 'p1',
        locationId: stockId,
        inventoryLocationId: 'wh:inventory',
        countedQuantity: '10',
        productUomId: 'unit',
      },
      adapter,
    )
    await call('stock.createPicking', { id: 'out-1', name: 'OUT/1', pickingTypeId: 'wh:outgoing' }, adapter)
    await call(
      'stock.addMove',
      {
        id: 'move-1',
        name: 'move',
        pickingId: 'out-1',
        productId: 'p1',
        productUomId: 'unit',
        productUomQty: '5',
        locationId: stockId,
        locationDestId: customerId,
      },
      adapter,
    )
    await call('stock.confirmPicking', { id: 'out-1' }, adapter)
    await call('stock.reserveMove', { id: 'move-1' }, adapter)

    const lines = (await call('stock.getPicking', { id: 'out-1' }, adapter)).value as Row
    const line = ((lines.moves as Row[])[0]!.lines as Row[])[0]!
    const reservedAfter = async () =>
      Number(
        (
          (await callAs('stock.listQuants', { productId: 'p1', locationId: stockId }, adapter)).value as Row[]
        )[0]!.reservedQuantity,
      )
    assert.equal(await reservedAfter(), 5)

    // Pressing the pick button, then pressing it again. The second save must not
    // add the line's quantity to the quant a second time.
    for (let press = 0; press < 2; press++)
      await call(
        'stock.saveMoveLine',
        { id: line.id, moveId: 'move-1', quantity: '5', picked: true },
        adapter,
      )
    assert.equal(await reservedAfter(), 5, 'a picked line still holds exactly its own reservation')
  } finally {
    await adapter.close()
  }
})

test('stock: an inventory count below what is reserved is refused as a field error', async () => {
  const adapter = await boot()
  try {
    const { stockId, customerId } = await seedWarehouse(adapter)
    await call('stock.configureProduct', { templateId: 'tpl', isStorable: true }, adapter)
    await call(
      'stock.adjustInventory',
      {
        id: 'count-1',
        productId: 'p1',
        locationId: stockId,
        inventoryLocationId: 'wh:inventory',
        countedQuantity: '10',
        productUomId: 'unit',
      },
      adapter,
    )
    await call('stock.createPicking', { id: 'out-1', name: 'OUT/1', pickingTypeId: 'wh:outgoing' }, adapter)
    await call(
      'stock.addMove',
      {
        id: 'move-1',
        name: 'move',
        pickingId: 'out-1',
        productId: 'p1',
        productUomId: 'unit',
        productUomQty: '8',
        locationId: stockId,
        locationDestId: customerId,
      },
      adapter,
    )
    await call('stock.confirmPicking', { id: 'out-1' }, adapter)
    await call('stock.reserveMove', { id: 'move-1' }, adapter)

    // Eight of the ten are reserved. Counting five used to reach mutateQuant and
    // throw, which surfaced as a server error naming neither the reservation nor
    // the transfer holding it.
    const counted = await call(
      'stock.adjustInventory',
      {
        id: 'count-2',
        productId: 'p1',
        locationId: stockId,
        inventoryLocationId: 'wh:inventory',
        countedQuantity: '5',
        productUomId: 'unit',
      },
      adapter,
    )
    const result = counted.value as { ok: boolean; errors?: Array<{ field: string }> }
    assert.equal(result.ok, false)
    assert.equal(result.errors?.[0]?.field, 'countedQuantity')
  } finally {
    await adapter.close()
  }
})

test('stock: re-parenting a location moves the paths of everything under it', async () => {
  const adapter = await boot()
  try {
    await seedWarehouse(adapter)
    await call('stock.saveLocation', { id: 'a', name: 'A', usage: 'view' }, adapter)
    await call('stock.saveLocation', { id: 'd', name: 'D', usage: 'view' }, adapter)
    await call('stock.saveLocation', { id: 'b', name: 'B', usage: 'internal', parentId: 'a' }, adapter)
    await call('stock.saveLocation', { id: 'c', name: 'C', usage: 'internal', parentId: 'b' }, adapter)

    const pathOf = async (id: string) =>
      String(
        ((await call('stock.listLocations', {}, adapter)).value as Row[]).find(
          (location) => location.id === id,
        )!.parentPath,
      )
    assert.equal(await pathOf('c'), 'a/b/c/')

    await call('stock.saveLocation', { id: 'b', name: 'B', usage: 'internal', parentId: 'd' }, adapter)
    assert.equal(await pathOf('b'), 'd/b/')
    assert.equal(await pathOf('c'), 'd/b/c/', 'a descendant follows its parent to the new tree')
  } finally {
    await adapter.close()
  }
})

test('stock: an open outgoing move counts against the forecast even when fully reserved', async () => {
  const adapter = await boot()
  try {
    const { stockId, customerId } = await seedWarehouse(adapter)
    await call('stock.configureProduct', { templateId: 'tpl', isStorable: true }, adapter)
    await call(
      'stock.adjustInventory',
      {
        id: 'count-1',
        productId: 'p1',
        locationId: stockId,
        inventoryLocationId: 'wh:inventory',
        countedQuantity: '10',
        productUomId: 'unit',
      },
      adapter,
    )
    await call('stock.createPicking', { id: 'out-1', name: 'OUT/1', pickingTypeId: 'wh:outgoing' }, adapter)
    await call(
      'stock.addMove',
      {
        id: 'move-1',
        name: 'move',
        pickingId: 'out-1',
        productId: 'p1',
        productUomId: 'unit',
        productUomQty: '10',
        locationId: stockId,
        locationDestId: customerId,
      },
      adapter,
    )
    await call('stock.confirmPicking', { id: 'out-1' }, adapter)
    await call('stock.reserveMove', { id: 'move-1' }, adapter)

    const forecast = (await call('stock.forecast', { productId: 'p1', warehouseId: 'wh' }, adapter))
      .value as Row
    // Everything on hand is committed and about to leave: available and forecast
    // have to agree rather than reading 0 beside 10.
    assert.equal(Number(forecast.onHand), 10)
    assert.equal(Number(forecast.available), 0)
    assert.equal(Number(forecast.outgoing), 10)
    assert.equal(Number(forecast.forecast), 0)
  } finally {
    await adapter.close()
  }
})

test('stock: a move reserves from the sub-locations of the source it names', async () => {
  const adapter = await boot()
  try {
    const { stockId, customerId } = await seedWarehouse(adapter)
    await call('stock.configureProduct', { templateId: 'tpl', isStorable: true }, adapter)
    await call(
      'stock.saveLocation',
      { id: 'shelf', name: 'Shelf 1', usage: 'internal', parentId: stockId, warehouseId: 'wh' },
      adapter,
    )
    // The stock sits on the shelf; the move is written against the parent, which
    // is what an orderpoint and the forecast both anchor on.
    await call(
      'stock.adjustInventory',
      {
        id: 'count-1',
        productId: 'p1',
        locationId: 'shelf',
        inventoryLocationId: 'wh:inventory',
        countedQuantity: '7',
        productUomId: 'unit',
      },
      adapter,
    )
    await call('stock.createPicking', { id: 'out-1', name: 'OUT/1', pickingTypeId: 'wh:outgoing' }, adapter)
    await call(
      'stock.addMove',
      {
        id: 'move-1',
        name: 'move',
        pickingId: 'out-1',
        productId: 'p1',
        productUomId: 'unit',
        productUomQty: '4',
        locationId: stockId,
        locationDestId: customerId,
      },
      adapter,
    )
    await call('stock.confirmPicking', { id: 'out-1' }, adapter)
    const reserved = await call('stock.reserveMove', { id: 'move-1' }, adapter)
    const outcome = reserved.value as { reserved: string; state: string }
    assert.equal(Number(outcome.reserved), 4, 'stock one level down is still stock')
    assert.equal(outcome.state, 'assigned')

    // And completing it takes the goods off the shelf they were reserved from.
    await call('stock.completePicking', { id: 'out-1' }, adapter)
    const onShelf = (
      (await call('stock.listQuants', { productId: 'p1', locationId: 'shelf' }, adapter)).value as Row[]
    )[0]!
    assert.equal(Number(onShelf.quantity), 3)
    assert.equal(Number(onShelf.reservedQuantity), 0)
  } finally {
    await adapter.close()
  }
})

test('stock: reads and repairs stay inside the company being written to', async () => {
  const adapter = await boot()
  try {
    await call('partner.savePartner', { id: 'globex-party', kind: 'company', name: 'Globex' }, adapter)
    await callAs(
      'company.saveCompany',
      { id: 'globex', partnerId: 'globex-party', currency: 'VND' },
      adapter,
      bothCompanies,
    )
    const globex = { company: 'globex', branches: null }
    await seedWarehouse(adapter)
    const theirs = await seedWarehouse(adapter, globex, 'wh-globex')

    // A session that reads both companies still sees only the one it writes to.
    const warehouses = (await callAs('stock.listWarehouses', {}, adapter, bothCompanies)).value as Row[]
    assert.deepEqual(
      warehouses.map((row) => row.companyId),
      ['acme'],
      'a picker offers only warehouses this session can write against',
    )

    // Globex holds a reservation of its own.
    await callAs('stock.configureProduct', { templateId: 'tpl', isStorable: true }, adapter, globex)
    await callAs(
      'stock.adjustInventory',
      {
        id: 'g-count',
        productId: 'p1',
        locationId: theirs.stockId,
        inventoryLocationId: theirs.inventoryId,
        countedQuantity: '6',
        productUomId: 'unit',
      },
      adapter,
      globex,
    )
    await callAs(
      'stock.createPicking',
      { id: 'g-out', name: 'OUT/G', pickingTypeId: theirs.outgoingId },
      adapter,
      globex,
    )
    await callAs(
      'stock.addMove',
      {
        id: 'g-move',
        name: 'move',
        pickingId: 'g-out',
        productId: 'p1',
        productUomId: 'unit',
        productUomQty: '6',
        locationId: theirs.stockId,
        locationDestId: theirs.customerId,
      },
      adapter,
      globex,
    )
    await callAs('stock.confirmPicking', { id: 'g-out' }, adapter, globex)
    await callAs('stock.reserveMove', { id: 'g-move' }, adapter, globex)
    // adjustInventory writes both sides, so name the location rather than taking
    // whichever quant comes back first.
    const globexReserved = async () =>
      Number(
        (
          (await callAs('stock.listQuants', { productId: 'p1', locationId: theirs.stockId }, adapter, globex))
            .value as Row[]
        )[0]!.reservedQuantity,
      )
    assert.equal(await globexReserved(), 6)

    // Running the repair tool from acme must not touch it.
    await callAs('stock.reconcileReservations', {}, adapter, bothCompanies)
    assert.equal(await globexReserved(), 6, "a repair in one company leaves another company's ledger alone")
  } finally {
    await adapter.close()
  }
})
