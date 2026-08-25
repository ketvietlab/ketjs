import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

type Envelope<T> = { data: T; error: { code: string } | null }

const boot = async (t: TestContext) => {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    e2e.fixture.call<Row>(name, input, { scope })

  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'Kết Việt' })
  await fixture('company.saveCompany', {
    id: 'acme',
    code: 'ACME',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  await fixture('user.createUser', {
    id: 'inventory-user',
    login: 'inventory-user',
    password: 'correct horse battery',
    name: 'Inventory User',
    defaultCompanyId: 'acme',
    superuser: false,
  })
  await fixture('user.grantCompany', {
    id: 'inventory-user:acme',
    userId: 'inventory-user',
    companyId: 'acme',
  })
  await fixture('user.saveRole', { id: 'inventory-reader', name: 'Inventory reader' })
  for (const fnKey of [
    'product.listVariants',
    'product.getVariantSummary',
    'stock.listProductConfigs',
    'stock.listProductAvailability',
    'stock.getProductStockView',
    'uom.listUnits',
    'product_media.listPrimaryMedia',
  ])
    await fixture('user.grantFunction', {
      id: `inventory-reader:${fnKey}`,
      roleId: 'inventory-reader',
      fnKey,
    })
  await fixture('user.assignRole', {
    id: 'inventory-user:inventory-reader',
    userId: 'inventory-user',
    roleId: 'inventory-reader',
  })

  await fixture('uom.saveUnit', { id: 'unit', name: 'Đơn vị', relativeFactor: '1' })
  for (const template of [
    {
      id: 'mango-template',
      name: 'Xoài Cát',
      type: 'goods',
      saleOk: true,
      purchaseOk: true,
    },
    {
      id: 'bag-template',
      name: 'Túi giấy',
      type: 'goods',
      saleOk: true,
      purchaseOk: false,
    },
    {
      id: 'old-template',
      name: 'Hàng cũ',
      type: 'goods',
      saleOk: false,
      purchaseOk: false,
    },
    {
      id: 'service-template',
      name: 'Gói quà',
      type: 'service',
      saleOk: true,
      purchaseOk: false,
    },
  ]) {
    const savedTemplate = await fixture('product.saveTemplate', {
      ...template,
      uomId: 'unit',
      listPrice: '0',
    })
    assert.equal(savedTemplate.value.ok, true, JSON.stringify(savedTemplate.value))
    const savedVariant = await fixture('product.saveVariant', {
      id: template.id.replace('-template', ''),
      templateId: template.id,
      ...(template.id === 'mango-template' ? { defaultCode: 'XCAT-01', barcode: '893000000001' } : {}),
    })
    assert.equal(savedVariant.value.ok, true, JSON.stringify(savedVariant.value))
  }
  await fixture('stock.configureProduct', {
    templateId: 'mango-template',
    isStorable: true,
    tracking: 'none',
  })
  await fixture('stock.configureProduct', {
    templateId: 'bag-template',
    isStorable: false,
    tracking: 'none',
  })
  await fixture('product.archiveTemplate', { id: 'old-template', active: false })
  await fixture('stock.saveWarehouse', { id: 'wh', name: 'Kho chính', code: 'WH' })
  await fixture('stock.saveLocation', { id: 'inventory-loss', name: 'Inventory loss', usage: 'inventory' })
  await fixture('stock.adjustInventory', {
    id: 'adjust-mango',
    productId: 'mango',
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory-loss',
    countedQuantity: '7',
    productUomId: 'unit',
  })
  return e2e
}

test('staff inventory channel pages active goods with stock and channel evidence', async (t) => {
  const e2e = await boot(t)
  assert.equal((await e2e.client.get('/api/staff/v1/inventory/products')).status, 401)
  await e2e.client.login({ login: 'inventory-user', password: 'correct horse battery' })

  const all = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      '/api/staff/v1/inventory/products?limit=50',
    )
  ).data
  assert.deepEqual(
    all.items.map((item) => item.id),
    ['bag', 'mango'],
  )

  const first = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      '/api/staff/v1/inventory/products?limit=1',
    )
  ).data
  assert.deepEqual(first.items, [
    {
      id: 'bag',
      name: 'Túi giấy',
      active: true,
      kind: 'consumable',
      sku: null,
      barcode: null,
      uom: { id: 'unit', name: 'Đơn vị' },
      availableQuantity: '0',
      channels: { sales: true, purchase: false, pointOfSale: true },
      hasImage: false,
    },
  ])
  assert.ok(first.nextCursor)

  const second = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      `/api/staff/v1/inventory/products?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
    )
  ).data
  assert.equal(second.items[0]?.id, 'mango')
  assert.equal(second.items[0]?.availableQuantity, '7')
  assert.equal(second.nextCursor, null)

  const archived = (
    await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/inventory/products?status=archived')
  ).data
  assert.deepEqual(
    archived.items.map((item) => item.id),
    ['old'],
  )
  assert.equal((await e2e.client.get('/api/staff/v1/inventory/products?query=x')).status, 422)
})

test('staff inventory channel returns read-only stock positions and strong versions', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'inventory-user', password: 'correct horse battery' })

  const response = await e2e.client.get('/api/staff/v1/inventory/products/mango')
  assert.equal(response.status, 200)
  const detail = (await response.json()) as Envelope<Row>
  assert.match(String(detail.data.version), /^ipv_[0-9a-f]{64}$/)
  assert.equal(response.headers.get('etag'), `"${String(detail.data.version)}"`)
  assert.equal(detail.data.availableQuantity, '7')
  assert.equal(detail.data.tracking, 'none')
  assert.equal(detail.data.readOnly, true)
  assert.deepEqual(detail.data.availableActions, [])
  assert.deepEqual(detail.data.stockPositions, [
    {
      locationId: 'wh:stock',
      locationName: 'Stock',
      lotId: null,
      lotName: null,
      quantity: '7',
      version: (detail.data.stockPositions as Row[])[0]?.version,
      requiresLotName: false,
    },
  ])
  assert.match(String((detail.data.stockPositions as Row[])[0]?.version), /^sav_[0-9a-f]{64}$/)

  assert.equal((await e2e.client.get('/api/staff/v1/inventory/products/service')).status, 404)
  assert.equal((await e2e.client.get('/api/staff/v1/inventory/products/missing')).status, 404)
})
