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
    id: 'purchaser',
    login: 'purchaser',
    password: 'correct horse battery',
    name: 'Purchaser',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', {
    id: 'purchaser:acme',
    userId: 'purchaser',
    companyId: 'acme',
  })
  for (const [id, name, role] of [
    ['vendor-a', 'An Phát', 'supplier'],
    ['vendor-b', 'Bình An', 'supplier'],
    ['customer', 'Chỉ Mua Hàng', 'customer'],
  ]) {
    await fixture('partner.savePartner', { id, kind: 'company', name })
    await fixture('partner.grantRole', { id: `${id}:${role}`, partnerId: id, role })
  }
  return e2e
}

const seedOrdersAndBills = async (e2e: Awaited<ReturnType<typeof boot>>) => {
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    e2e.fixture.call<Row>(name, input, { scope })
  await fixture('uom.saveUnit', { id: 'unit', name: 'Đơn vị', relativeFactor: '1' })
  await fixture('product.saveTemplate', {
    id: 'goods',
    name: 'Bàn làm việc',
    type: 'goods',
    uomId: 'unit',
    listPrice: '2000000',
    purchaseOk: true,
  })
  await fixture('product.saveVariant', {
    id: 'desk',
    templateId: 'goods',
    defaultCode: 'BAN-01',
    combinationKey: '',
  })
  await fixture('stock.saveLocation', { id: 'supplier-location', name: 'Nhà cung cấp', usage: 'supplier' })
  await fixture('stock.saveLocation', { id: 'stock-location', name: 'Kho chính', usage: 'internal' })
  await fixture('stock.savePickingType', {
    id: 'incoming',
    name: 'Nhập hàng',
    code: 'incoming',
    defaultLocationSrcId: 'supplier-location',
    defaultLocationDestId: 'stock-location',
  })
  await fixture('purchase.createOrder', {
    id: 'po-a',
    partnerId: 'vendor-a',
    partnerRef: 'SPECIAL-RFQ',
    pickingTypeId: 'incoming',
    dateOrder: '2026-08-20T00:00:00.000Z',
    datePlanned: '2026-08-25T00:00:00.000Z',
    notes: 'Kiểm hàng khi nhận',
  })
  await fixture('purchase.addLine', {
    id: 'po-a:line',
    orderId: 'po-a',
    productId: 'desk',
    productQty: '2',
    productUomId: 'unit',
    priceUnit: '1500000',
  })
  await fixture('purchase.createOrder', {
    id: 'po-b',
    partnerId: 'vendor-b',
    pickingTypeId: 'incoming',
    dateOrder: '2026-08-21T00:00:00.000Z',
  })

  await fixture('account.saveAccount', {
    id: 'expense',
    code: '6421',
    name: 'Chi phí mua hàng',
    accountType: 'expense',
  })
  await fixture('account.saveAccount', {
    id: 'payable',
    code: '331',
    name: 'Phải trả nhà cung cấp',
    accountType: 'liability_payable',
  })
  await fixture('account.saveJournal', {
    id: 'purchase-journal',
    name: 'Mua hàng',
    code: 'PUR',
    type: 'purchase',
  })
  await fixture('account.createInvoice', {
    id: 'bill-a',
    journalId: 'purchase-journal',
    moveType: 'in_invoice',
    partnerId: 'vendor-a',
    invoiceDate: '2026-08-20T00:00:00.000Z',
    ref: 'SPECIAL-BILL',
    description: 'Bàn làm việc',
    quantity: '2',
    priceUnit: '1500000',
    lineAccountId: 'expense',
    counterpartAccountId: 'payable',
  })
  await fixture('account.createInvoice', {
    id: 'credit-a',
    journalId: 'purchase-journal',
    moveType: 'in_refund',
    partnerId: 'vendor-a',
    invoiceDate: '2026-08-22T00:00:00.000Z',
    description: 'Điều chỉnh',
    quantity: '1',
    priceUnit: '100000',
    lineAccountId: 'expense',
    counterpartAccountId: 'payable',
  })
}

test('staff purchasing channel lists only vendors with bounded cursor pagination', async (t) => {
  const e2e = await boot(t)
  assert.equal((await e2e.client.get('/api/staff/v1/purchasing/vendors')).status, 401)
  await e2e.client.login({ login: 'purchaser', password: 'correct horse battery' })

  const first = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      '/api/staff/v1/purchasing/vendors?limit=1',
    )
  ).data
  assert.deepEqual(first.items, [{ id: 'vendor-a', name: 'An Phát', kind: 'company' }])
  assert.ok(first.nextCursor)

  const second = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      `/api/staff/v1/purchasing/vendors?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
    )
  ).data
  assert.deepEqual(second.items, [{ id: 'vendor-b', name: 'Bình An', kind: 'company' }])
  assert.equal(second.nextCursor, null)
})

test('staff purchasing channel returns a read-only vendor and hides non-vendors', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'purchaser', password: 'correct horse battery' })

  const vendor = await e2e.client.json<Envelope<Row>>('/api/staff/v1/purchasing/vendors/vendor-a')
  assert.deepEqual(vendor.data, {
    id: 'vendor-a',
    name: 'An Phát',
    kind: 'company',
    readOnly: true,
  })

  const customer = await e2e.client.get('/api/staff/v1/purchasing/vendors/customer')
  assert.equal(customer.status, 404)
  assert.equal(
    ((await customer.json()) as Envelope<null>).error?.code,
    'purchase_staff_channel.vendorNotFound',
  )
})

test('staff purchasing channel pages and searches bounded order summaries', async (t) => {
  const e2e = await boot(t)
  await seedOrdersAndBills(e2e)
  assert.equal((await e2e.client.get('/api/staff/v1/purchasing/orders')).status, 401)
  await e2e.client.login({ login: 'purchaser', password: 'correct horse battery' })

  const first = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      '/api/staff/v1/purchasing/orders?limit=1',
    )
  ).data
  assert.equal(first.items[0]?.id, 'po-b')
  assert.ok(first.nextCursor)

  const searched = (
    await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/purchasing/orders?query=SPECIAL')
  ).data
  assert.deepEqual(
    searched.items.map((item) => item.id),
    ['po-a'],
  )
  assert.deepEqual(searched.items[0]?.vendor, { id: 'vendor-a', name: 'An Phát' })
})

test('staff purchasing channel returns a narrow read-only order detail', async (t) => {
  const e2e = await boot(t)
  await seedOrdersAndBills(e2e)
  await e2e.client.login({ login: 'purchaser', password: 'correct horse battery' })

  const response = await e2e.client.json<Envelope<Row>>('/api/staff/v1/purchasing/orders/po-a')
  assert.equal(response.data.id, 'po-a')
  assert.equal(response.data.vendorReference, 'SPECIAL-RFQ')
  assert.equal(response.data.readOnly, true)
  assert.deepEqual(response.data.lines, [
    {
      id: 'po-a:line',
      productId: 'desk',
      name: 'Bàn làm việc',
      quantity: '2',
      receivedQuantity: '0',
      billedQuantity: '0',
      uomId: 'unit',
      unitPrice: '1500000',
      discount: '0',
      subtotal: '3000000',
    },
  ])
  assert.equal((await e2e.client.get('/api/staff/v1/purchasing/orders/missing')).status, 404)
})

test('staff purchasing channel lists and reads vendor bills without ledger lines', async (t) => {
  const e2e = await boot(t)
  await seedOrdersAndBills(e2e)
  assert.equal((await e2e.client.get('/api/staff/v1/purchasing/vendor-bills')).status, 401)
  await e2e.client.login({ login: 'purchaser', password: 'correct horse battery' })

  const bills = (
    await e2e.client.json<Envelope<{ items: Row[] }>>(
      '/api/staff/v1/purchasing/vendor-bills?kind=bill&query=SPECIAL',
    )
  ).data
  assert.deepEqual(
    bills.items.map((item) => item.id),
    ['bill-a'],
  )
  assert.equal(bills.items[0]?.kind, 'bill')
  assert.deepEqual(bills.items[0]?.vendor, { id: 'vendor-a', name: 'An Phát' })

  const detail = await e2e.client.json<Envelope<Row>>('/api/staff/v1/purchasing/vendor-bills/bill-a')
  assert.equal(detail.data.sourceReference, 'SPECIAL-BILL')
  assert.equal(detail.data.lineCount, 2)
  assert.equal(detail.data.readOnly, true)
  assert.equal((await e2e.client.get('/api/staff/v1/purchasing/vendor-bills/missing')).status, 404)
})
