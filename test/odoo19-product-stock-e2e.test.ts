import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createTestApp } from 'ketjs/testing'
import type { Row } from 'ketjs'
import { ketsuite } from '../apps/ketsuite/app.ts'

const SCOPE = { company: 'acme', branches: null }
type HttpCall = <T = unknown>(
  name: string,
  input?: Record<string, unknown>,
) => Promise<{ value: T }>

async function bootSuite(t: TestContext) {
  const e2e = await createTestApp(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const fixture = (name: string, input: Record<string, unknown>) =>
    e2e.fixture.call(name, input, { scope: SCOPE })

  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', {
    id: 'acme',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', {
    id: 'admin:acme',
    userId: 'admin',
    companyId: 'acme',
  })
  await e2e.client.login({ login: 'admin', password: 'correct horse' })

  const call = <T = unknown>(name: string, input: Record<string, unknown> = {}) =>
    e2e.client.call<T>(name, input)
  return { e2e, call }
}

async function seedProduct(call: HttpCall) {
  await call('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' })
  await call('product.saveTemplate', {
    id: 'tpl',
    name: 'Áo thun',
    type: 'goods',
    uomId: 'unit',
    listPrice: '100.00',
  })
  await call('product.saveVariant', {
    id: 'p1',
    templateId: 'tpl',
    defaultCode: 'AO',
    combinationKey: '',
  })
}

test('e2e product 19: UoM, variants, media and pricing cross real HTTP', async (t) => {
  const { e2e, call } = await bootSuite(t)
  await seedProduct(call)

  await call('uom.saveUnit', {
    id: 'dozen',
    name: 'Dozen',
    relativeUomId: 'unit',
    relativeFactor: '12',
  })
  const units = (await call<Row[]>('uom.listUnits', { rootId: 'unit' })).value
  assert.deepEqual(
    units.map((row) => [row.id, row.absoluteFactor]),
    [
      ['unit', 1],
      ['dozen', 12],
    ],
  )

  await call('product.setCost', { productId: 'p1', standardPrice: '60.25' })
  await call('product.saveAttribute', { id: 'color', name: 'Màu' })
  await call('product.saveAttributeValue', { id: 'red', attributeId: 'color', name: 'Đỏ' })
  await call('product.saveAttributeValue', { id: 'blue', attributeId: 'color', name: 'Xanh' })
  await call('product.saveAttributeLine', {
    id: 'tpl:color',
    templateId: 'tpl',
    attributeId: 'color',
    valueIds: ['red', 'blue'],
  })
  assert.equal((await call<Row>('product.generateVariants', { templateId: 'tpl' })).value.created, 2)
  assert.equal((await call<Row>('product.generateVariants', { templateId: 'tpl' })).value.created, 0)

  for (const [id, name] of [
    ['front', 'Mặt trước'],
    ['back', 'Mặt sau'],
  ]) {
    await call('storage.createAttachment', {
      id,
      name,
      resModel: 'product.Template',
      resId: 'tpl',
      resField: 'media',
      kind: 'url',
      url: `https://cdn.example.test/${id}.png`,
      mimetype: 'image/png',
      size: 0,
      public: false,
      createdAt: '2026-08-20T00:00:00.000Z',
    })
    await call('product_media.attachMedia', {
      id: `media:${id}`,
      attachmentId: id,
      templateId: 'tpl',
      alt: name,
    })
  }
  await call('product_media.setPrimary', { id: 'media:back' })
  await call('product_media.reorderMedia', {
    templateId: 'tpl',
    ids: ['media:back', 'media:front'],
  })
  const media = (await call<Row[]>('product_media.listMedia', { templateId: 'tpl' })).value
  assert.deepEqual(
    media.map((row) => [row.id, row.primary]),
    [
      ['media:back', true],
      ['media:front', false],
    ],
  )

  await call('pricing.savePricelist', { id: 'retail', name: 'Bán lẻ' })
  await call('pricing.savePricelistItem', {
    id: 'global',
    pricelistId: 'retail',
    appliedOn: '3_global',
    computePrice: 'fixed',
    fixedPrice: '95',
  })
  await call('pricing.savePricelistItem', {
    id: 'variant',
    pricelistId: 'retail',
    appliedOn: '0_product_variant',
    productId: 'p1',
    computePrice: 'percentage',
    percentPrice: '10',
    minQuantity: '2',
  })
  assert.equal(
    (await call<Row>('pricing.priceFor', { pricelistId: 'retail', productId: 'p1', quantity: '1' }))
      .value.price,
    '95',
  )
  assert.equal(
    (await call<Row>('pricing.priceFor', { pricelistId: 'retail', productId: 'p1', quantity: '2' }))
      .value.price,
    '90',
  )

  const productPage = await e2e.client.get('/admin/products/tpl', {
    headers: { accept: 'text/html' },
  })
  assert.equal(productPage.status, 200)
  const productHtml = await productPage.text()
  assert.match(productHtml, /Áo thun/)
  assert.match(productHtml, /data-ui="media" data-state="ready"/)
  assert.ok((productHtml.match(/<img /g) ?? []).length >= 2)

  const pricingPage = await e2e.client.get('/admin/pricelists/retail', {
    headers: { accept: 'text/html' },
  })
  assert.equal(pricingPage.status, 200)
  assert.match(await pricingPage.text(), /Bán lẻ/)
})

test('e2e stock 19: inventory, reservation, partial completion and backorder cross HTTP', async (t) => {
  const { e2e, call } = await bootSuite(t)
  await seedProduct(call)
  await call('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'none' })
  await call('stock.saveWarehouse', { id: 'wh', name: 'Kho chính', code: 'WH' })
  await call('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })

  const adjustment = (
    await call<Row>('stock.adjustInventory', {
      id: 'adjust:1',
      productId: 'p1',
      locationId: 'wh:stock',
      inventoryLocationId: 'inventory',
      countedQuantity: '10',
      productUomId: 'unit',
    })
  ).value
  assert.equal(adjustment.ok, true)
  assert.ok(adjustment.pickingId)
  assert.equal((await call<Row>('stock.getPicking', { id: String(adjustment.pickingId) })).value.state, 'done')

  await call('stock.createPicking', {
    id: 'pick1',
    name: 'WH/OUT/1',
    pickingTypeId: 'wh:outgoing',
  })
  await call('stock.addMove', {
    id: 'move1',
    name: 'Áo thun',
    pickingId: 'pick1',
    productId: 'p1',
    productUomId: 'unit',
    productUomQty: '8',
  })
  await call('stock.confirmPicking', { id: 'pick1' })
  assert.deepEqual((await call('stock.reserveMove', { id: 'move1' })).value, {
    ok: true,
    reserved: '8',
    state: 'assigned',
  })
  const reserved = (await call<Row>('stock.getPicking', { id: 'pick1' })).value
  const line = ((reserved.moves as Row[])[0]!.lines as Row[])[0]!
  const completion = (
    await call<Row>('stock.completePicking', {
      id: 'pick1',
      quantities: [{ moveLineId: line.id, quantity: 5 }],
      createBackorder: true,
    })
  ).value
  assert.ok(completion.backorderId)
  const quant = (await call<Row[]>('stock.listQuants', { productId: 'p1', locationId: 'wh:stock' })).value[0]!
  assert.deepEqual([quant.quantity, quant.reservedQuantity], [5, 0])
  assert.equal(
    (await call<Row>('stock.forecast', { productId: 'p1', warehouseId: 'wh' })).value.forecast,
    '2',
  )

  for (const path of ['/admin/inventory', '/admin/transfers/pick1', '/admin/forecast']) {
    const page = await e2e.client.get(path, { headers: { accept: 'text/html' } })
    assert.equal(page.status, 200, path)
    assert.doesNotMatch(await page.text(), /data-state="error"/, path)
  }
})

test('e2e stock 19: serial reservation keeps one unit on each move line', async (t) => {
  const { e2e, call } = await bootSuite(t)
  await seedProduct(call)
  await call('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'serial' })
  await call('stock.saveWarehouse', { id: 'wh', name: 'Kho chính', code: 'WH' })
  await call('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })
  for (const serial of ['s1', 's2']) {
    await call('stock.createLot', { id: serial, productId: 'p1', name: serial.toUpperCase() })
    const adjustment = (
      await call<Row>('stock.adjustInventory', {
        id: `adjust:${serial}`,
        productId: 'p1',
        locationId: 'wh:stock',
        inventoryLocationId: 'inventory',
        countedQuantity: '1',
        lotId: serial,
        productUomId: 'unit',
      })
    ).value
    assert.equal(adjustment.ok, true)
  }

  await call('stock.createPicking', {
    id: 'serial-pick',
    name: 'WH/OUT/SERIAL',
    pickingTypeId: 'wh:outgoing',
  })
  await call('stock.addMove', {
    id: 'serial-move',
    name: 'Serial delivery',
    pickingId: 'serial-pick',
    productId: 'p1',
    productUomId: 'unit',
    productUomQty: '2',
  })
  await call('stock.confirmPicking', { id: 'serial-pick' })
  assert.equal((await call<Row>('stock.reserveMove', { id: 'serial-move' })).value.reserved, '2')
  const picking = (await call<Row>('stock.getPicking', { id: 'serial-pick' })).value
  const lines = (picking.moves as Row[])[0]!.lines as Row[]
  assert.deepEqual(
    lines.map((line) => [line.lotId, line.quantity]).sort(),
    [
      ['s1', 1],
      ['s2', 1],
    ],
  )
  await call('stock.completePicking', { id: 'serial-pick' })
  const quants = (await call<Row[]>('stock.listQuants', { productId: 'p1', locationId: 'wh:stock' })).value
  assert.ok(quants.every((quant) => quant.quantity === 0 && quant.reservedQuantity === 0))

  for (const path of ['/admin/lots', '/admin/locations', '/admin/picking-types', '/admin/stock-routes']) {
    const page = await e2e.client.get(path, { headers: { accept: 'text/html' } })
    assert.equal(page.status, 200, path)
  }
})

test('e2e multi-warehouse 19: forecast, routes and replenishment remain warehouse-local', async (t) => {
  const { e2e, call } = await bootSuite(t)
  await seedProduct(call)
  await call('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'none' })
  await call('stock.saveWarehouse', { id: 'wh-a', name: 'Kho A', code: 'WHA' })
  await call('stock.saveWarehouse', { id: 'wh-b', name: 'Kho B', code: 'WHB' })
  await call('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })
  for (const [warehouse, quantity] of [
    ['wh-a', '9'],
    ['wh-b', '3'],
  ]) {
    const adjusted = (
      await call<Row>('stock.adjustInventory', {
        id: `adjust:${warehouse}`,
        productId: 'p1',
        locationId: `${warehouse}:stock`,
        inventoryLocationId: 'inventory',
        countedQuantity: quantity,
        productUomId: 'unit',
      })
    ).value
    assert.equal(adjusted.ok, true)
    assert.equal(adjusted.difference, quantity)
  }

  const quants = (await call<Row[]>('stock.listQuants', { productId: 'p1' })).value
  assert.deepEqual(
    quants.map((row) => [row.locationId, row.quantity]),
    [
      ['wh-a:stock', 9],
      ['wh-b:stock', 3],
    ],
  )
  const warehouseALocations = (await call<Row[]>('stock.listLocations', { warehouseId: 'wh-a' })).value
  assert.ok(warehouseALocations.some((row) => row.id === 'wh-a:stock'))
  assert.ok(warehouseALocations.every((row) => row.warehouseId === 'wh-a'))
  assert.equal(
    (await call<Row>('stock.forecast', { productId: 'p1', locationId: 'wh-a:stock' })).value.forecast,
    '9',
  )

  assert.equal(
    (await call<Row>('stock.forecast', { productId: 'p1', warehouseId: 'wh-a' })).value.forecast,
    '9',
  )
  assert.equal(
    (await call<Row>('stock.forecast', { productId: 'p1', warehouseId: 'wh-b' })).value.forecast,
    '3',
  )

  await call('stock.saveRoute', { id: 'route-b', name: 'Supply B' })
  await call('stock.saveRule', {
    id: 'a-to-b',
    name: 'A to B',
    routeId: 'route-b',
    action: 'pull',
    locationSrcId: 'wh-a:stock',
    locationDestId: 'wh-b:stock',
    pickingTypeId: 'wh-b:internal',
    procureMethod: 'make_to_stock',
  })
  await call('stock.assignWarehouseRoute', { warehouseId: 'wh-b', routeId: 'route-b' })
  const procurement = (
    await call<Row>('stock.procure', {
      moveId: 'supply-b',
      productId: 'p1',
      productUomId: 'unit',
      quantity: '2',
      locationId: 'wh-b:stock',
    })
  ).value
  assert.deepEqual(procurement.moveIds, ['supply-b'])

  await call('stock.saveOrderpoint', {
    id: 'op-b',
    productId: 'p1',
    warehouseId: 'wh-b',
    locationId: 'wh-b:stock',
    trigger: 'auto',
    minQuantity: '6',
    maxQuantity: '10',
    replenishmentUomId: 'unit',
    routeId: 'route-b',
  })
  const replenishment = (await call<Row>('stock.runOrderpoint', { id: 'op-b', moveId: 'replenish:b' })).value
  assert.equal(replenishment.ok, true)
  assert.equal(replenishment.quantity, '5')

  for (const path of ['/admin/warehouses', '/admin/replenishment']) {
    const page = await e2e.client.get(path, { headers: { accept: 'text/html' } })
    assert.equal(page.status, 200, path)
    const html = await page.text()
    assert.match(html, path.endsWith('warehouses') ? /Kho A/ : /Bổ sung hàng/)
  }
})
