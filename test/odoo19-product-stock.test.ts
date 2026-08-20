import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from 'ketjs'
import type { Adapter, Row } from 'ketjs'
import { company, partner, pricing, product, stock, uom } from 'ketsuite'

const modules = [partner, company, uom, product, pricing, stock]
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

test('product 19: company cost, UoM links and concurrent-safe variant generation', async () => {
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

test('product 19: default/no-variant behavior, archive/reactivate, barcode and company cost invariants', async () => {
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

test('pricing 19: ancestor scope, UoM quantity, date bounds, nesting, margins and loops are deterministic', async () => {
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

test('routes 19: completing a move triggers assigned push rules exactly once', async () => {
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

test('warehouse 19: two and three step settings generate idempotent route chains', async () => {
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
