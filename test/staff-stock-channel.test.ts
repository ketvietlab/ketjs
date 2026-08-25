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
    id: 'warehouse-user',
    login: 'warehouse-user',
    password: 'correct horse battery',
    name: 'Warehouse User',
    defaultCompanyId: 'acme',
    superuser: false,
  })
  await fixture('user.grantCompany', {
    id: 'warehouse-user:acme',
    userId: 'warehouse-user',
    companyId: 'acme',
  })
  await fixture('user.saveRole', { id: 'warehouse-reader', name: 'Warehouse reader' })
  for (const fnKey of [
    'stock.listPickingViews',
    'stock.getPickingView',
    'company.getCompany',
    'product.listVariants',
    'uom.listUnits',
  ])
    await fixture('user.grantFunction', {
      id: `warehouse-reader:${fnKey}`,
      roleId: 'warehouse-reader',
      fnKey,
    })
  await fixture('user.assignRole', {
    id: 'warehouse-user:warehouse-reader',
    userId: 'warehouse-user',
    roleId: 'warehouse-reader',
  })
  await fixture('uom.saveUnit', { id: 'unit', name: 'Đơn vị', relativeFactor: '1' })
  await fixture('product.saveTemplate', {
    id: 'mango-template',
    name: 'Xoài Cát',
    type: 'goods',
    uomId: 'unit',
    listPrice: '50000',
    saleOk: true,
  })
  await fixture('product.saveVariant', {
    id: 'mango',
    templateId: 'mango-template',
    defaultCode: 'XCAT-01',
    combinationKey: '',
  })
  await fixture('stock.configureProduct', {
    templateId: 'mango-template',
    isStorable: true,
    tracking: 'none',
  })
  await fixture('stock.saveWarehouse', { id: 'wh', name: 'Kho chính', code: 'WH' })
  for (const [id, name, scheduledDate] of [
    ['pick-a', 'WH/OUT/00001', '2026-08-20T00:00:00.000Z'],
    ['pick-b', 'WH/OUT/00002', '2026-08-21T00:00:00.000Z'],
  ]) {
    await fixture('stock.createPicking', {
      id,
      name,
      pickingTypeId: 'wh:outgoing',
      scheduledDate,
    })
    await fixture('stock.addMove', {
      id: `${id}:move`,
      name: 'Xoài Cát',
      pickingId: id,
      productId: 'mango',
      productUomId: 'unit',
      productUomQty: id === 'pick-a' ? '10' : '5',
      origin: id === 'pick-a' ? 'SO/00001' : undefined,
    })
  }
  return e2e
}

test('staff warehouse channel pages company-scoped transfer summaries', async (t) => {
  const e2e = await boot(t)
  assert.equal((await e2e.client.get('/api/staff/v1/warehouse/pickings')).status, 401)
  await e2e.client.login({ login: 'warehouse-user', password: 'correct horse battery' })

  const first = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      '/api/staff/v1/warehouse/pickings?limit=1',
    )
  ).data
  assert.equal(first.items[0]?.id, 'pick-b')
  assert.deepEqual(first.items[0]?.context, {
    company: { id: 'acme', name: 'Kết Việt' },
    warehouse: { id: 'wh', name: 'Kho chính' },
    sourceLocation: { id: 'wh:stock', name: 'Stock' },
    destinationLocation: { id: 'wh:customer', name: 'Customer' },
    operation: { code: 'outgoing', name: 'Delivery Orders' },
    sourceDocument: { type: 'none' },
  })
  assert.match(String(first.items[0]?.version), /^pkv_[0-9a-f]{64}$/)
  assert.ok(first.nextCursor)

  const second = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      `/api/staff/v1/warehouse/pickings?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
    )
  ).data
  assert.equal(second.items[0]?.id, 'pick-a')
  assert.equal(second.nextCursor, null)
})

test('staff warehouse channel returns canonical transfer lines and a strong ETag', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'warehouse-user', password: 'correct horse battery' })

  const response = await e2e.client.get('/api/staff/v1/warehouse/pickings/pick-a')
  assert.equal(response.status, 200)
  const detail = (await response.json()) as Envelope<Row>
  assert.equal(response.headers.get('etag'), `"${String(detail.data.version)}"`)
  assert.deepEqual(detail.data.context, {
    company: { id: 'acme', name: 'Kết Việt' },
    warehouse: { id: 'wh', name: 'Kho chính' },
    sourceLocation: { id: 'wh:stock', name: 'Stock' },
    destinationLocation: { id: 'wh:customer', name: 'Customer' },
    operation: { code: 'outgoing', name: 'Delivery Orders' },
    sourceDocument: { type: 'other', reference: 'SO/00001' },
  })
  assert.deepEqual(detail.data.lines, [
    {
      id: 'pick-a:move',
      product: { id: 'mango', name: 'Xoài Cát', sku: 'XCAT-01' },
      uom: { id: 'unit', name: 'Đơn vị' },
      expectedQuantity: '10',
      doneQuantity: '0',
      remainingQuantity: '10',
      tracking: 'none',
      trackingRequirement: 'not_required',
      lots: [],
    },
  ])
  assert.deepEqual(detail.data.progress, { lineCount: 1, completedLineCount: 0 })
  assert.deepEqual(detail.data.tracking, {
    lotOrSerialRequired: false,
    allRequirementsSatisfied: true,
  })
  assert.deepEqual(detail.data.quality, { status: 'unavailable', requirements: [] })
  assert.equal((detail.data.nextAction as Row).supported, false)

  const missing = await e2e.client.get('/api/staff/v1/warehouse/pickings/missing')
  assert.equal(missing.status, 404)
  assert.equal(((await missing.json()) as Envelope<null>).error?.code, 'stock_staff_channel.pickingNotFound')
})
