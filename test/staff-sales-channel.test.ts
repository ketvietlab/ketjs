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
    id: 'salesperson',
    login: 'salesperson',
    password: 'correct horse battery',
    name: 'Salesperson',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', {
    id: 'salesperson:acme',
    userId: 'salesperson',
    companyId: 'acme',
  })
  for (const [id, name, role] of [
    ['customer-a', 'An Nhiên', 'customer'],
    ['customer-b', 'Bình Minh', 'customer'],
    ['supplier', 'Chỉ Cung Cấp', 'supplier'],
  ]) {
    await fixture('partner.savePartner', { id, kind: 'company', name })
    await fixture('partner.grantRole', { id: `${id}:${role}`, partnerId: id, role })
  }
  return e2e
}

const seedOrders = async (e2e: Awaited<ReturnType<typeof boot>>) => {
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    e2e.fixture.call<Row>(name, input, { scope })
  await fixture('uom.saveUnit', { id: 'unit', name: 'Đơn vị', relativeFactor: '1' })
  await fixture('product.saveTemplate', {
    id: 'goods',
    name: 'Ghế công thái học',
    type: 'goods',
    uomId: 'unit',
    listPrice: '3000000',
    saleOk: true,
  })
  await fixture('product.saveVariant', {
    id: 'chair',
    templateId: 'goods',
    defaultCode: 'GHE-01',
    combinationKey: '',
  })
  await fixture('stock.saveWarehouse', { id: 'wh', name: 'Kho chính', code: 'WH' })
  await fixture('sale.createOrder', {
    id: 'so-a',
    partnerId: 'customer-a',
    warehouseId: 'wh',
    clientOrderRef: 'SPECIAL-ORDER',
    dateOrder: '2026-08-20T00:00:00.000Z',
    notes: 'Giao giờ hành chính',
  })
  await fixture('sale.addLine', {
    id: 'so-a:line',
    orderId: 'so-a',
    productId: 'chair',
    productUomQty: '2',
    productUomId: 'unit',
  })
  await fixture('sale.createOrder', {
    id: 'so-b',
    partnerId: 'customer-b',
    warehouseId: 'wh',
    dateOrder: '2026-08-21T00:00:00.000Z',
  })
}

test('staff sales channel lists only customers with bounded cursor pagination', async (t) => {
  const e2e = await boot(t)
  assert.equal((await e2e.client.get('/api/staff/v1/sales/customers')).status, 401)
  await e2e.client.login({ login: 'salesperson', password: 'correct horse battery' })

  const first = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      '/api/staff/v1/sales/customers?limit=1',
    )
  ).data
  assert.deepEqual(first.items, [{ id: 'customer-a', name: 'An Nhiên', kind: 'company' }])
  assert.ok(first.nextCursor)

  const second = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      `/api/staff/v1/sales/customers?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
    )
  ).data
  assert.deepEqual(second.items, [{ id: 'customer-b', name: 'Bình Minh', kind: 'company' }])
  assert.equal(second.nextCursor, null)
})

test('staff sales channel returns a read-only customer and hides non-customer partners', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'salesperson', password: 'correct horse battery' })

  const customer = await e2e.client.json<Envelope<Row>>('/api/staff/v1/sales/customers/customer-a')
  assert.deepEqual(customer.data, {
    id: 'customer-a',
    name: 'An Nhiên',
    kind: 'company',
    readOnly: true,
  })

  const supplier = await e2e.client.get('/api/staff/v1/sales/customers/supplier')
  assert.equal(supplier.status, 404)
  assert.equal(((await supplier.json()) as Envelope<null>).error?.code, 'sale_staff_channel.customerNotFound')
})

test('staff sales channel pages and searches bounded order summaries', async (t) => {
  const e2e = await boot(t)
  await seedOrders(e2e)
  assert.equal((await e2e.client.get('/api/staff/v1/sales/orders')).status, 401)
  await e2e.client.login({ login: 'salesperson', password: 'correct horse battery' })

  const first = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      '/api/staff/v1/sales/orders?limit=1',
    )
  ).data
  assert.equal(first.items[0]?.id, 'so-b')
  assert.ok(first.nextCursor)

  const searched = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      '/api/staff/v1/sales/orders?query=SPECIAL',
    )
  ).data
  assert.deepEqual(
    searched.items.map((item) => item.id),
    ['so-a'],
  )
  assert.deepEqual(searched.items[0]?.customer, { id: 'customer-a', name: 'An Nhiên' })
  assert.deepEqual(searched.items[0]?.total, { currency: 'VND', amount: '6000000' })
})

test('staff sales channel returns a narrow read-only order detail', async (t) => {
  const e2e = await boot(t)
  await seedOrders(e2e)
  await e2e.client.login({ login: 'salesperson', password: 'correct horse battery' })

  const response = await e2e.client.json<Envelope<Row>>('/api/staff/v1/sales/orders/so-a/detail')
  assert.equal(response.data.id, 'so-a')
  assert.equal(response.data.customerReference, 'SPECIAL-ORDER')
  assert.equal(response.data.readOnly, true)
  assert.deepEqual(response.data.lines, [
    {
      id: 'so-a:line',
      productId: 'chair',
      name: 'Ghế công thái học',
      quantity: '2',
      uomId: 'unit',
      unitPrice: '3000000',
      discount: '0',
      subtotal: '6000000',
    },
  ])

  assert.equal((await e2e.client.get('/api/staff/v1/sales/orders/missing/detail')).status, 404)
})

test('staff sales channel names every customer on a page in one lookup', async (t) => {
  const e2e = await boot(t)
  await seedOrders(e2e)
  // A customer retired after the order was placed still has to render its label:
  // batching the names must not quietly inherit the "active only" default that
  // partner.listPartners applies to a browse screen.
  await e2e.fixture.call<Row>(
    'partner.archivePartner',
    { id: 'customer-b', active: false },
    { scope: { company: 'acme', branches: null } },
  )
  await e2e.client.login({ login: 'salesperson', password: 'correct horse battery' })

  const page = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      '/api/staff/v1/sales/orders?limit=50',
    )
  ).data
  assert.deepEqual(
    page.items.map((item) => (item.customer as Row).name),
    ['Bình Minh', 'An Nhiên'],
  )
})

test('staff sales channel refuses query values its published contract forbids', async (t) => {
  const e2e = await boot(t)
  await seedOrders(e2e)
  await e2e.client.login({ login: 'salesperson', password: 'correct horse battery' })

  const refused = async (query: string) => {
    const response = await e2e.client.get(`/api/staff/v1/sales/orders?${query}`)
    const body = (await response.json()) as Envelope<null>
    return { status: response.status, code: body.error?.code }
  }
  const accepted = async (query: string) =>
    (await e2e.client.get(`/api/staff/v1/sales/orders?${query}`)).status

  // The enum reaches native clients through the OpenAPI document, so the server
  // is the thing that has to mean it.
  assert.deepEqual(await refused('state=nonsense'), {
    status: 422,
    code: 'channel_api.invalidRequest',
  })
  // A published bound is a bound, not a suggestion the handler silently clamps.
  assert.deepEqual(await refused('limit=999'), { status: 422, code: 'channel_api.invalidRequest' })
  assert.deepEqual(await refused('limit=many'), { status: 422, code: 'channel_api.invalidRequest' })

  // An empty value is how a client spells "no filter", and the handlers already
  // read it that way, so it stays a 200.
  assert.equal(await accepted('state='), 200)
  assert.equal(await accepted('state=sale&limit=50'), 200)
  // Undeclared parameters stay tolerated: the contract does not close the set.
  assert.equal(await accepted('_cacheBust=1'), 200)
})
