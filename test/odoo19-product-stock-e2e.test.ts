import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createTestApp } from 'ketjs/testing'
import type { Row } from 'ketjs'
import { ketsuite } from '../apps/ketsuite/app.ts'

const SCOPE = { company: 'acme', branches: null }
type HttpCall = <T = unknown>(name: string, input?: Record<string, unknown>) => Promise<{ value: T }>

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
    (await call<Row>('pricing.priceFor', { pricelistId: 'retail', productId: 'p1', quantity: '1' })).value
      .price,
    '95',
  )
  assert.equal(
    (await call<Row>('pricing.priceFor', { pricelistId: 'retail', productId: 'p1', quantity: '2' })).value
      .price,
    '90',
  )

  const productCreatePage = await e2e.client.get('/admin/products/new?lang=vi', {
    headers: { accept: 'text/html' },
  })
  assert.equal(productCreatePage.status, 200)
  const productCreateHtml = await productCreatePage.text()
  assert.match(productCreateHtml, /data-ui="record-workspace"/)
  assert.match(productCreateHtml, /id="product-create-form"/)
  assert.match(productCreateHtml, /data-scope="product-create"/)
  assert.equal((productCreateHtml.match(/name="type"/g) ?? []).length, 2)
  assert.doesNotMatch(productCreateHtml, /<select[^>]*name="type"/)
  assert.match(productCreateHtml, /name="saleOk"[^>]*form="product-create-form"/)
  assert.match(productCreateHtml, /name="purchaseOk"[^>]*form="product-create-form"/)
  assert.match(productCreateHtml, /name="isStorable"[^>]*form="product-create-form"/)
  assert.doesNotMatch(productCreateHtml, /data-island="mail\.chatter"/)

  const invalidProductPage = await e2e.client.post(
    '/admin/products/new?lang=vi',
    new URLSearchParams({
      name: 'Sản phẩm cấu hình kho sai',
      type: 'goods',
      uomId: 'unit',
      isStorable: '0',
      tracking: 'lot',
    }),
    { headers: { accept: 'text/html' } },
  )
  assert.equal(invalidProductPage.status, 200)
  assert.match(await invalidProductPage.text(), /Dữ liệu chưa hợp lệ/)
  const invalidProducts = await call<Row[]>('product.listTemplates', {
    search: 'Sản phẩm cấu hình kho sai',
  })
  assert.equal(invalidProducts.value.length, 0)

  const createdProductPage = await e2e.client.post(
    '/admin/products/new?lang=vi',
    new URLSearchParams({
      name: 'Sản phẩm từ form',
      type: 'goods',
      uomId: 'unit',
      listPrice: '250000',
      saleOk: '1',
      purchaseOk: '1',
      isStorable: '1',
      tracking: 'none',
      description: 'Được tạo qua HTTP E2E.',
    }),
    { headers: { accept: 'text/html' } },
  )
  assert.equal(createdProductPage.status, 200)
  const createdProductHtml = await createdProductPage.text()
  assert.match(createdProductHtml, /Sản phẩm từ form/)
  assert.match(createdProductHtml, /data-island="mail\.chatter"/)

  const productPage = await e2e.client.get('/admin/products/tpl?lang=vi', {
    headers: { accept: 'text/html' },
  })
  assert.equal(productPage.status, 200)
  const productHtml = await productPage.text()
  assert.match(productHtml, /Áo thun/)
  assert.match(productHtml, /data-ui="record-workspace"/)
  assert.match(productHtml, /data-ui="record-controller"/)
  assert.match(productHtml, /data-island="product\.editor"/)
  assert.match(productHtml, /id="product-detail-form"/)
  assert.equal((productHtml.match(/name="saleOk"/g) ?? []).length, 1)
  assert.equal((productHtml.match(/name="purchaseOk"/g) ?? []).length, 1)
  assert.equal((productHtml.match(/name="isStorable"/g) ?? []).length, 1)
  assert.equal((productHtml.match(/name="type"/g) ?? []).length, 2)
  assert.doesNotMatch(productHtml, /<select[^>]*name="type"/)
  assert.match(productHtml, /data-ui="form-option-input" type="radio" name="type" value="goods"/)
  assert.match(productHtml, /Loại hàng hoá/)
  assert.match(productHtml, /name="saleOk"[^>]*form="product-detail-form"/)
  assert.match(
    productHtml,
    /data-ui="tab" data-active="true" href="\/admin\/products\/tpl\?tab=general&amp;lang=vi"/,
  )
  assert.match(productHtml, /action="\/admin\/products\/tpl\?tab=general&amp;lang=vi"/)
  assert.doesNotMatch(productHtml, /data-ui="media" data-state="ready"/)

  const invalidDetailSave = await e2e.client.post(
    '/admin/products/tpl?tab=general&lang=vi',
    new URLSearchParams({
      name: 'Tên không được lưu dở dang',
      type: 'goods',
      uomId: 'unit',
      listPrice: '999.00',
      isStorable: '0',
      tracking: 'serial',
    }),
    { headers: { accept: 'application/json', 'x-ket-partial': 'product-detail' } },
  )
  assert.equal(invalidDetailSave.status, 422)
  assert.equal(((await call<Row>('product.getTemplate', { id: 'tpl' })).value as Row).name, 'Áo thun')

  const partialSave = await e2e.client.post(
    '/admin/products/tpl?tab=general&lang=vi',
    new URLSearchParams({
      name: 'Áo thun',
      type: 'goods',
      uomId: 'unit',
      listPrice: '100.00',
      saleOk: '1',
      purchaseOk: '1',
      tracking: 'none',
    }),
    { headers: { accept: 'text/html', 'x-ket-partial': 'product-detail' } },
  )
  assert.equal(partialSave.status, 200)
  assert.match(partialSave.headers.get('content-type') ?? '', /^text\/vnd\.ket\.fragments\+html/)
  const partialSaveHtml = await partialSave.text()
  assert.match(partialSaveHtml, /data-ket-slot="product\.record-header"/)
  assert.match(partialSaveHtml, /data-ket-slot="product\.record-body"/)
  assert.doesNotMatch(partialSaveHtml, /data-island=|data-ui="sidebar"|<!doctype/)

  const variantsPage = await e2e.client.get('/admin/products/tpl?tab=variants&lang=vi', {
    headers: { accept: 'text/html' },
  })
  assert.equal(variantsPage.status, 200)
  const variantsHtml = await variantsPage.text()
  assert.match(variantsHtml, /name="saleOk"[^>]*disabled/)
  assert.doesNotMatch(variantsHtml, /id="product-detail-form"/)

  const mediaPage = await e2e.client.get('/admin/products/tpl?tab=media&lang=vi', {
    headers: { accept: 'text/html' },
  })
  assert.equal(mediaPage.status, 200)
  const mediaHtml = await mediaPage.text()
  assert.match(mediaHtml, /data-ui="media" data-state="ready"/)
  assert.match(mediaHtml, /action="\/admin\/products\/tpl\/media\?tab=media&amp;lang=vi"/)
  assert.ok((mediaHtml.match(/<img /g) ?? []).length >= 3)

  const variantPage = await e2e.client.get('/admin/products/tpl/variants/p1?tab=general&lang=vi', {
    headers: { accept: 'text/html' },
  })
  assert.equal(variantPage.status, 200)
  const variantHtml = await variantPage.text()
  assert.match(variantHtml, /data-ui="record-workspace"/)
  assert.match(variantHtml, /data-scope="product-variant"/)
  assert.match(variantHtml, /id="product-variant-form"/)
  assert.match(variantHtml, /data-island="mail\.chatter"/)
  assert.match(variantHtml, /data-island="activity\.record"/)
  assert.match(variantHtml, /&quot;resModel&quot;:&quot;product\.Product&quot;/)
  assert.match(
    variantHtml,
    /data-ui="tab" data-active="true" href="\/admin\/products\/tpl\/variants\/p1\?tab=general&amp;lang=vi"/,
  )

  const variantPartial = await e2e.client.post(
    '/admin/products/tpl/variants/p1?tab=general&lang=vi',
    new URLSearchParams({
      defaultCode: 'AO-UPDATED',
      barcode: '8938500000100',
      weight: '0.25',
      volume: '0.1',
      standardPrice: '61.50',
      uomId: 'unit',
      uomBarcode: '8938500000101',
    }),
    { headers: { accept: 'text/html', 'x-ket-partial': 'product-variant' } },
  )
  assert.equal(variantPartial.status, 200)
  assert.match(variantPartial.headers.get('content-type') ?? '', /^text\/vnd\.ket\.fragments\+html/)
  const variantPartialHtml = await variantPartial.text()
  assert.match(variantPartialHtml, /AO-UPDATED/)
  assert.doesNotMatch(variantPartialHtml, /data-island=|data-ui="sidebar"|<!doctype/)

  const attributesPage = await e2e.client.get('/admin/product-attributes?lang=vi', {
    headers: { accept: 'text/html' },
  })
  assert.equal(attributesPage.status, 200)
  const attributesHtml = await attributesPage.text()
  assert.match(attributesHtml, /id="product-attribute-create"/)
  assert.match(attributesHtml, /data-scope="product-attribute-create"/)
  assert.match(attributesHtml, /data-ui="card-grid"/)
  assert.match(attributesHtml, /data-scope="product-attribute-value"/)
  assert.match(attributesHtml, /Thuộc tính đã cấu hình/)
  assert.doesNotMatch(attributesHtml, /data-island="mail\.chatter"/)

  const invalidAttribute = await e2e.client.post(
    '/admin/product-attributes?lang=vi',
    new URLSearchParams({ name: '   ', sequence: '20' }),
    { headers: { accept: 'text/html' } },
  )
  assert.match(await invalidAttribute.text(), /Dữ liệu chưa hợp lệ/)
  assert.equal((await call<Row[]>('product.listAttributes')).value.length, 1)

  const invalidAttributeValue = await e2e.client.post(
    '/admin/product-attributes/color/values?lang=vi',
    new URLSearchParams({ name: '   ', sequence: '20' }),
    { headers: { accept: 'text/html' } },
  )
  assert.match(await invalidAttributeValue.text(), /Dữ liệu chưa hợp lệ/)
  const attributesAfterInvalidValue = (await call<Array<Row & { values: Row[] }>>('product.listAttributes'))
    .value
  assert.equal(attributesAfterInvalidValue.find((row) => row.id === 'color')?.values.length, 2)

  const createdAttribute = await e2e.client.post(
    '/admin/product-attributes?lang=vi',
    new URLSearchParams({
      name: 'Hoàn thiện',
      sequence: '20',
      displayType: 'pills',
      createVariant: 'no_variant',
    }),
    { headers: { accept: 'text/html' } },
  )
  assert.equal(createdAttribute.status, 200)
  assert.match(await createdAttribute.text(), /Hoàn thiện/)
  assert.equal((await call<Row[]>('product.listAttributes')).value.length, 2)

  const pricingPage = await e2e.client.get('/admin/pricelists/retail?lang=vi', {
    headers: { accept: 'text/html' },
  })
  assert.equal(pricingPage.status, 200)
  const pricingHtml = await pricingPage.text()
  assert.match(pricingHtml, /Bán lẻ/)
  assert.match(pricingHtml, /action="\/admin\/pricelists\/retail\?lang=vi"/)
})

test('e2e stock 19: inventory, reservation, partial completion and backorder cross HTTP', async (t) => {
  const { e2e, call } = await bootSuite(t)
  await seedProduct(call)
  await call('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'none' })
  await call('product.saveTemplate', {
    id: 'service-template',
    name: 'Dịch vụ tư vấn',
    type: 'service',
    uomId: 'unit',
    listPrice: '100',
  })
  await call('product.saveVariant', {
    id: 'service-variant',
    templateId: 'service-template',
    defaultCode: 'SERVICE',
    combinationKey: '',
  })
  assert.deepEqual(
    (await call<Row[]>('stock.listStorableProducts')).value.map((row) => row.id),
    ['tpl'],
  )
  await call('stock.saveWarehouse', { id: 'wh', name: 'Kho chính', code: 'WH' })
  await call('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })

  const warehousesPage = await e2e.client.get('/admin/warehouses?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const warehousesHtml = await warehousesPage.text()
  assert.match(warehousesHtml, /data-ui="record-workspace"/)
  assert.match(warehousesHtml, /id="warehouse-create-form"/)
  assert.match(warehousesHtml, /data-scope="warehouse-create"/)
  assert.match(warehousesHtml, /name="receptionSteps" value="one_step"/)
  assert.match(warehousesHtml, /name="deliverySteps" value="pick_pack_ship"/)
  assert.match(warehousesHtml, /Lô hàng đến/)
  assert.match(warehousesHtml, /Kho chính/)
  assert.doesNotMatch(warehousesHtml, /data-island="mail\.chatter"/)
  await e2e.client.form<string>('/admin/warehouses?lang=vi', {
    name: 'Kho phụ form',
    code: 'WH2',
    receptionSteps: 'two_steps',
    deliverySteps: 'pick_ship',
  })
  assert.equal(
    (await call<Row[]>('stock.listWarehouses', {})).value.some((row) => row.code === 'WH2'),
    true,
  )

  const locationsPage = await e2e.client.get('/admin/locations?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const locationsHtml = await locationsPage.text()
  assert.match(locationsHtml, /data-ui="record-workspace"/)
  assert.match(locationsHtml, /id="location-create-form"/)
  assert.match(locationsHtml, /data-scope="location-create"/)
  assert.match(locationsHtml, /Kho chính \/ Tồn kho/)
  assert.match(locationsHtml, /Loại vị trí/)
  assert.match(locationsHtml, /Vị trí nội bộ/)
  assert.doesNotMatch(locationsHtml, /data-island="mail\.chatter"/)
  await e2e.client.form<string>('/admin/locations?lang=vi', {
    name: 'Kệ HTTP',
    parentId: 'wh:stock',
    usage: 'internal',
    warehouseId: 'wh',
  })
  assert.equal(
    (await call<Row[]>('stock.listLocations', {})).value.some((row) => row.name === 'Kệ HTTP'),
    true,
  )

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
  assert.equal(
    (await call<Row>('stock.getPicking', { id: String(adjustment.pickingId) })).value.state,
    'done',
  )

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

  const inventoryPage = await e2e.client.get('/admin/inventory?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const inventoryHtml = await inventoryPage.text()
  assert.match(inventoryHtml, /data-ui="record-workspace"/)
  assert.match(inventoryHtml, /id="inventory-adjustment-form"/)
  assert.match(inventoryHtml, /data-scope="inventory-adjustment"/)
  assert.match(inventoryHtml, /Áo thun · AO/)
  assert.match(inventoryHtml, /Tồn kho hiện tại/)
  assert.doesNotMatch(inventoryHtml, /data-island="mail\.chatter"/)
  await e2e.client.form<string>('/admin/inventory?lang=vi', {
    productId: 'p1',
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory',
    countedQuantity: '6',
    productUomId: 'unit',
  })
  const appliedInventoryPage = await e2e.client.get('/admin/inventory?applied=1&lang=vi', {
    headers: { accept: 'text/html' },
  })
  assert.match(await appliedInventoryPage.text(), /Đã áp dụng kiểm kê/)

  const transfersPage = await e2e.client.get('/admin/transfers?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const transfersHtml = await transfersPage.text()
  assert.match(transfersHtml, /data-ui="record-workspace"/)
  assert.match(transfersHtml, /id="transfer-create-form"/)
  assert.match(transfersHtml, /data-scope="transfer-create"/)
  assert.match(transfersHtml, /Phiếu chuyển kho/)
  assert.match(transfersHtml, />Từ</)
  assert.match(transfersHtml, />Đến</)
  assert.match(transfersHtml, /Loại hoạt động/)
  assert.match(transfersHtml, /Tồn kho/)
  assert.doesNotMatch(transfersHtml, /data-island="mail\.chatter"/)
  await e2e.client.form<string>('/admin/transfers?lang=vi', {
    name: 'WH/INT/FORM',
    pickingTypeId: 'wh:internal',
    scheduledDate: '2026-08-22T09:00',
  })
  assert.equal(
    (await call<Row[]>('stock.listPickings', {})).value.some((row) => row.name === 'WH/INT/FORM'),
    true,
  )

  // Exercise the same partial flow through the rendered backend form, including
  // the Odoo `ask` backorder choice rather than bypassing it with a direct call.
  await call('stock.createPicking', {
    id: 'ui-pick',
    name: 'WH/OUT/UI',
    pickingTypeId: 'wh:outgoing',
  })
  await call('stock.addMove', {
    id: 'ui-move',
    name: 'Áo thun UI',
    pickingId: 'ui-pick',
    productId: 'p1',
    productUomId: 'unit',
    productUomQty: '3',
  })
  await call('stock.confirmPicking', { id: 'ui-pick' })
  await call('stock.assignPicking', { id: 'ui-pick' })
  const uiPicking = (await call<Row>('stock.getPicking', { id: 'ui-pick' })).value
  const uiLine = ((uiPicking.moves as Row[])[0]!.lines as Row[])[0]!
  const uiPage = await e2e.client.get('/admin/transfers/ui-pick?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const uiHtml = await uiPage.text()
  assert.match(uiHtml, /data-ui="record-workspace"/)
  assert.match(uiHtml, /data-ui="record-aside"/)
  assert.match(uiHtml, /data-island="stock\.editor"/)
  assert.match(uiHtml, /data-scope="stock-transfer"/)
  assert.match(uiHtml, /<select[^>]*name="productId"/)
  assert.match(uiHtml, /<option value="p1"/)
  assert.match(uiHtml, /Áo thun · AO/)
  assert.match(uiHtml, /name="operationId"/)
  assert.match(uiHtml, /name="backorder" value="create"/)
  await e2e.client.form<string>('/admin/transfers/ui-pick?lang=vi', {
    action: 'pick',
    operationId: `line:${String(uiLine.id)}`,
    quantity: '2',
  })
  await e2e.client.form<string>('/admin/transfers/ui-pick?lang=vi', {
    action: 'validate',
    backorder: 'create',
  })
  const uiDone = (await call<Row>('stock.getPicking', { id: 'ui-pick' })).value
  assert.equal(uiDone.state, 'done')
  assert.equal(
    (await call<Row[]>('stock.listPickings', {})).value.filter((row) => row.backorderId === 'ui-pick').length,
    1,
  )
  const localizedDonePage = await e2e.client.get('/admin/transfers/ui-pick?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const localizedDoneHtml = await localizedDonePage.text()
  assert.match(localizedDoneHtml, /<html lang="vi">/)
  assert.doesNotMatch(localizedDoneHtml, /stock_backend\./)

  await call('stock.saveWarehouse', {
    id: 'wh-config',
    name: 'Kho cấu hình',
    code: 'WHC',
    receptionSteps: 'three_steps',
    deliverySteps: 'pick_pack_ship',
  })
  const operationTypesPage = await e2e.client.get('/admin/picking-types?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const operationTypesHtml = await operationTypesPage.text()
  assert.match(operationTypesHtml, /data-ui="record-workspace"/)
  assert.match(operationTypesHtml, /id="picking-type-create-form"/)
  assert.match(operationTypesHtml, /data-scope="picking-type-create"/)
  assert.match(operationTypesHtml, /Kiểm tra chất lượng/)
  assert.match(operationTypesHtml, /Nhập kho nội bộ/)
  assert.match(operationTypesHtml, /Lấy hàng/)
  assert.match(operationTypesHtml, /Đóng gói/)
  assert.doesNotMatch(operationTypesHtml, /Quality Control|Store|Pick|Pack/)
  assert.match(operationTypesHtml, /Kho cấu hình \/ Tồn kho/)
  assert.match(operationTypesHtml, /Hỏi khi hoàn tất/)
  assert.doesNotMatch(operationTypesHtml, /data-island="mail\.chatter"/)
  await e2e.client.form<string>('/admin/picking-types?lang=vi', {
    name: 'Điều chuyển HTTP',
    code: 'internal',
    warehouseId: 'wh-config',
    defaultLocationSrcId: 'wh-config:stock',
    defaultLocationDestId: 'wh-config:output',
    createBackorder: 'ask',
  })
  assert.equal(
    (await call<Row[]>('stock.listPickingTypes', {})).value.some((row) => row.name === 'Điều chuyển HTTP'),
    true,
  )

  const routesPage = await e2e.client.get('/admin/stock-routes?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const routesHtml = await routesPage.text()
  assert.equal(routesPage.status, 200)
  assert.match(routesHtml, /data-ui="record-workspace"/)
  assert.match(routesHtml, /id="stock-route-create-form"/)
  assert.match(routesHtml, /data-scope="stock-route-create"/)
  assert.match(routesHtml, /Tuyến cung ứng đã cấu hình/)
  assert.match(routesHtml, /Kho chính: Nhận hàng trực tiếp/)
  assert.doesNotMatch(routesHtml, /one_step|ship_only/)
  assert.match(routesHtml, />Quy tắc</)
  assert.doesNotMatch(routesHtml, /data-island="mail\.chatter"/)

  const createdRoutePage = await e2e.client.form<string>('/admin/stock-routes?lang=vi', {
    name: 'Tuyến HTTP hai bước',
    sequence: '15',
  })
  assert.match(createdRoutePage, /Quy tắc tuyến cung ứng/)
  assert.equal(
    (await call<Row[]>('stock.listRoutes', {})).value.some(
      (row) => row.name === 'Tuyến HTTP hai bước' && row.sequence === 15,
    ),
    true,
  )
  assert.match(await (await e2e.client.get('/admin/stock-routes?lang=vi')).text(), /Tuyến HTTP hai bước/)

  const invalidRoutePage = await e2e.client.form<string>('/admin/stock-routes?lang=vi', {
    name: '',
    sequence: '10',
  })
  assert.match(invalidRoutePage, /Dữ liệu chưa hợp lệ/)

  await call('stock.createLot', {
    id: 'lot-list-http',
    productId: 'p1',
    name: 'LOT/LIST/001',
    ref: 'LIST-REF',
  })
  await call('stock.adjustInventory', {
    id: 'lot-list-adjustment',
    productId: 'p1',
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory',
    countedQuantity: '3',
    lotId: 'lot-list-http',
    productUomId: 'unit',
  })
  const lotsPage = await e2e.client.get('/admin/lots?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const lotsHtml = await lotsPage.text()
  assert.equal(lotsPage.status, 200)
  assert.match(lotsHtml, /data-ui="record-workspace"/)
  assert.match(lotsHtml, /id="lot-create-form"/)
  assert.match(lotsHtml, /data-scope="lot-create"/)
  assert.match(lotsHtml, /<select[^>]*name="productId"/)
  assert.match(lotsHtml, /Áo thun · AO/)
  assert.match(lotsHtml, /LOT\/LIST\/001/)
  assert.match(lotsHtml, /href="\/admin\/lots\/lot-list-http\?lang=vi"/)
  assert.match(lotsHtml, />3</)
  assert.doesNotMatch(lotsHtml, /Dịch vụ tư vấn|service-variant/)
  assert.doesNotMatch(lotsHtml, /data-island="mail\.chatter"/)

  await e2e.client.form<string>('/admin/lots?lang=vi', {
    productId: 'p1',
    name: 'LOT/LIST/FORM',
    ref: 'FORM-REF',
    note: 'Được tạo từ danh sách.',
  })
  assert.equal(
    (await call<Row[]>('stock.listLots', {})).value.some((row) => row.name === 'LOT/LIST/FORM'),
    true,
  )

  const invalidLotPage = await e2e.client.form<string>('/admin/lots?lang=vi', {
    productId: 'missing-product',
    name: 'LOT/INVALID',
  })
  assert.match(invalidLotPage, /Dữ liệu chưa hợp lệ/)

  const missingLotUpdate = await e2e.client.post(
    '/admin/lots/missing-lot?lang=vi',
    new URLSearchParams({ productId: 'p1', name: 'Không được tạo' }),
    { headers: { accept: 'text/html' } },
  )
  assert.equal(missingLotUpdate.status, 404)
  assert.equal(
    (await call<Row[]>('stock.listLots', {})).value.some((row) => row.id === 'missing-lot'),
    false,
  )

  await call('stock.createLot', {
    id: 'lot-http',
    productId: 'p1',
    name: 'LOT/HTTP/001',
    ref: 'HTTP-REF',
  })
  const lotPage = await e2e.client.get('/admin/lots/lot-http?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const lotHtml = await lotPage.text()
  assert.match(lotHtml, /data-ui="record-workspace"/)
  assert.match(lotHtml, /id="lot-detail-form"/)
  assert.match(lotHtml, /data-scope="stock-lot"/)
  assert.match(lotHtml, /data-island="mail\.chatter"/)
  assert.match(lotHtml, /data-island="activity\.record"/)
  assert.match(lotHtml, /Lô \/ Sê-ri/)
  await e2e.client.form<string>('/admin/lots/lot-http?lang=vi', {
    productId: 'p1',
    name: 'LOT/HTTP/001',
    ref: 'HTTP-REF-UPDATED',
    note: 'Cập nhật qua HTTP.',
  })
  assert.equal(
    String((await call<Row[]>('stock.listLots', {})).value.find((row) => row.id === 'lot-http')?.ref),
    'HTTP-REF-UPDATED',
  )
  await call('stock.saveLot', {
    id: 'lot-http',
    productId: 'p1',
    name: 'LOT/HTTP/001',
    ref: 'HTTP-REF-UPDATED',
    note: 'Lô đã lưu trữ.',
    active: false,
  })
  const archivedLotPage = await e2e.client.get('/admin/lots/lot-http?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const archivedLotHtml = await archivedLotPage.text()
  assert.match(archivedLotHtml, /Đã lưu trữ/)
  assert.match(archivedLotHtml, /data-island="mail\.chatter"/)
  await e2e.client.form<string>('/admin/lots/lot-http?lang=vi', {
    productId: 'p1',
    name: 'LOT/HTTP/001',
    ref: 'HTTP-REF-ARCHIVED',
    note: 'Cập nhật nhưng vẫn lưu trữ.',
  })
  const archivedLot = (await call<Row[]>('stock.listLots', {})).value.find((row) => row.id === 'lot-http')
  assert.equal(archivedLot?.active, false)
  assert.equal(archivedLot?.ref, 'HTTP-REF-ARCHIVED')

  await call('product.saveVariant', {
    id: 'p2',
    templateId: 'tpl',
    defaultCode: 'AO-ALT',
    combinationKey: 'alternate',
  })
  await call('stock.adjustInventory', {
    id: 'lot-guard-adjustment',
    productId: 'p1',
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory',
    countedQuantity: '1',
    lotId: 'lot-http',
    productUomId: 'unit',
  })
  assert.equal(
    (
      await call<Row>('stock.saveLot', {
        id: 'lot-http',
        productId: 'p2',
        name: 'LOT/HTTP/001',
      })
    ).value.ok,
    false,
  )

  const forecastPage = await e2e.client.get('/admin/forecast?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const forecastHtml = await forecastPage.text()
  assert.match(forecastHtml, /<select[^>]*name="productId"/)
  assert.match(forecastHtml, /<option value="p1"/)
  assert.match(forecastHtml, /name="lang" value="vi"/)

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
  assert.deepEqual(lines.map((line) => [line.lotId, line.quantity]).sort(), [
    ['s1', 1],
    ['s2', 1],
  ])
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
    quants
      .filter((row) => row.locationId === 'wh-a:stock' || row.locationId === 'wh-b:stock')
      .map((row) => [row.locationId, row.quantity]),
    [
      ['wh-a:stock', 9],
      ['wh-b:stock', 3],
    ],
  )
  assert.equal(
    quants.reduce((sum, row) => sum + Number(row.quantity), 0),
    0,
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
