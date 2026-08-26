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
    id: 'report-user',
    login: 'report-user',
    password: 'correct horse battery',
    name: 'Report User',
    defaultCompanyId: 'acme',
    superuser: false,
  })
  await fixture('user.grantCompany', {
    id: 'report-user:acme',
    userId: 'report-user',
    companyId: 'acme',
  })
  await fixture('user.saveRole', { id: 'report-reader', name: 'Report reader' })
  for (const fnKey of [
    'company.getCompany',
    'sale.listOrders',
    'account.listMoves',
    'account.listOpenItems',
    'stock.listPickingViews',
    'partner.listPartners',
  ])
    await fixture('user.grantFunction', {
      id: `report-reader:${fnKey}`,
      roleId: 'report-reader',
      fnKey,
    })
  await fixture('user.assignRole', {
    id: 'report-user:report-reader',
    userId: 'report-user',
    roleId: 'report-reader',
  })
  return e2e
}

test('staff business report returns a complete zero-safe cross-domain snapshot', async (t) => {
  const e2e = await boot(t)
  assert.equal((await e2e.client.get('/api/staff/v1/reports/business-overview')).status, 401)
  await e2e.client.login({ login: 'report-user', password: 'correct horse battery' })

  const response = await e2e.client.get('/api/staff/v1/reports/business-overview?period=this_week')
  assert.equal(response.status, 200)
  const body = (await response.json()) as Envelope<Row>
  assert.deepEqual(body.data.company, { name: 'Kết Việt', currency: 'VND' })
  assert.equal((body.data.period as Row).key, 'this_week')
  assert.equal((body.data.period as Row).timezone, 'UTC')
  assert.equal((body.data.trend as Row[]).length, 7)
  assert.deepEqual(body.data.operations, { pendingOutboundPickings: 0, activeDeliveries: 0 })
  assert.deepEqual(
    (body.data.pipeline as Row[]).map((entry) => entry.state),
    ['draft', 'sent', 'confirmed', 'cancelled'],
  )
  assert.deepEqual(body.data.topCustomers, [])
  assert.deepEqual(body.data.recentOrders, [])

  assert.equal(
    (await e2e.client.get('/api/staff/v1/reports/business-overview?period=unsupported')).status,
    422,
  )
})

/**
 * The overview reads a window, not a history.
 *
 * It used to page `sale.listOrders` until the table ran out and keep the two
 * windows it wanted out of the result, so the cost of one dashboard grew with
 * every order the company had ever taken — and the loop's own ceiling meant a
 * large enough tenant got a quietly short revenue figure. What the fetch may not
 * do is change the answer, which is what this pins: orders far outside the
 * window are neither counted nor compared against.
 */
test('staff business report ignores orders outside the reported window', async (t) => {
  const e2e = await boot(t)
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    e2e.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'buyer', kind: 'company', name: 'Buyer' })
  await fixture('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' })
  await fixture('product.saveTemplate', {
    id: 'tpl',
    name: 'Item',
    type: 'goods',
    uomId: 'unit',
    listPrice: '100',
    saleOk: true,
    purchaseOk: true,
  })
  await fixture('product.saveVariant', { id: 'prod', templateId: 'tpl', combinationKey: '' })
  await fixture('stock.saveWarehouse', { id: 'wh', code: 'WH', name: 'Main' })
  for (let index = 0; index < 3; index++) {
    const id = `historic-order-${index}`
    await fixture('sale.createOrder', {
      id,
      partnerId: 'buyer',
      warehouseId: 'wh',
      dateOrder: '2019-03-04T00:00:00.000Z',
    })
    await fixture('sale.addLine', {
      id: `${id}:line`,
      orderId: id,
      productId: 'prod',
      productUomQty: '1',
      priceUnit: '100',
      productUomId: 'unit',
    })
    await fixture('sale.confirmOrder', { id })
  }

  await e2e.client.login({ login: 'report-user', password: 'correct horse battery' })
  const body = await e2e.client.json<Envelope<Row>>('/api/staff/v1/reports/business-overview?period=today')
  const kpis = body.data.kpis as Row
  const orderCount = kpis.orderCount as Row
  const orderValue = kpis.confirmedOrderValue as Row
  assert.equal(orderCount.current, 0)
  assert.equal(orderCount.previous, 0)
  assert.equal((orderValue.current as Row).amount, '0')
  assert.equal((orderValue.previous as Row).amount, '0')
  assert.deepEqual(body.data.topCustomers, [])
  assert.deepEqual(body.data.recentOrders, [])
})
