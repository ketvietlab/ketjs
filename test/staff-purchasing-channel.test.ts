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

const seedProducts = async (e2e: Awaited<ReturnType<typeof boot>>) => {
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    e2e.fixture.call<Row>(name, input, { scope })
  await fixture('uom.saveUnit', { id: 'piece', name: 'Cái', relativeFactor: '1' })
  for (const template of [
    {
      id: 'stock-template',
      name: 'Bao bì 1 kg',
      type: 'goods',
      uomId: 'piece',
      saleOk: false,
      purchaseOk: true,
    },
    {
      id: 'consumable-template',
      name: 'Nhãn giấy',
      type: 'goods',
      uomId: 'piece',
      saleOk: false,
      purchaseOk: true,
    },
    {
      id: 'sale-only-template',
      name: 'Không được mua',
      type: 'goods',
      uomId: 'piece',
      saleOk: true,
      purchaseOk: false,
    },
  ])
    await fixture('product.saveTemplate', { listPrice: '0', ...template })
  for (const [id, templateId, defaultCode] of [
    ['a-stock', 'stock-template', 'BUY-01'],
    ['b-consumable', 'consumable-template', 'BUY-02'],
    ['c-sale-only', 'sale-only-template', 'SALE-ONLY'],
  ])
    await fixture('product.saveVariant', { id, templateId, defaultCode, combinationKey: '' })
  await fixture('stock.configureProduct', {
    templateId: 'stock-template',
    isStorable: true,
    tracking: 'none',
  })
  await fixture('stock.configureProduct', {
    templateId: 'consumable-template',
    isStorable: false,
    tracking: 'none',
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

test('staff purchasing channel returns a narrow versioned order detail', async (t) => {
  const e2e = await boot(t)
  await seedOrdersAndBills(e2e)
  await e2e.client.login({ login: 'purchaser', password: 'correct horse battery' })

  const response = await e2e.client.json<Envelope<Row>>('/api/staff/v1/purchasing/orders/po-a')
  assert.equal(response.data.id, 'po-a')
  assert.equal(response.data.vendorReference, 'SPECIAL-RFQ')
  assert.equal(response.data.readOnly, false)
  assert.deepEqual(response.data.availableActions, ['update', 'cancel', 'confirm'])
  assert.match(String(response.data.version), /^pov_[0-9a-f]{64}$/)
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

test('staff purchasing channel exposes only bounded purchasable product projections', async (t) => {
  const e2e = await boot(t)
  await seedProducts(e2e)
  assert.equal((await e2e.client.get('/api/staff/v1/purchasing/products')).status, 401)
  await e2e.client.login({ login: 'purchaser', password: 'correct horse battery' })

  const first = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      '/api/staff/v1/purchasing/products?limit=1',
    )
  ).data
  assert.deepEqual(first.items, [
    {
      id: 'a-stock',
      name: 'Bao bì 1 kg',
      kind: 'stockable',
      sku: 'BUY-01',
      category: null,
      uom: { id: 'piece', name: 'Cái' },
    },
  ])
  assert.ok(first.nextCursor)

  const second = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      `/api/staff/v1/purchasing/products?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
    )
  ).data
  assert.deepEqual(
    second.items.map((item) => [item.id, item.kind]),
    [['b-consumable', 'consumable']],
  )
  assert.equal(second.nextCursor, null)

  const searched = (
    await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/purchasing/products?query=Nhãn')
  ).data
  assert.deepEqual(
    searched.items.map((item) => item.id),
    ['b-consumable'],
  )
  assert.equal((await e2e.client.get('/api/staff/v1/purchasing/products?query=n')).status, 422)
})

test('staff purchasing channel reads one purchasable product and hides unsuitable variants', async (t) => {
  const e2e = await boot(t)
  await seedProducts(e2e)
  await e2e.client.login({ login: 'purchaser', password: 'correct horse battery' })

  const product = await e2e.client.json<Envelope<Row>>('/api/staff/v1/purchasing/products/a-stock')
  assert.deepEqual(product.data, {
    id: 'a-stock',
    name: 'Bao bì 1 kg',
    kind: 'stockable',
    sku: 'BUY-01',
    category: null,
    uom: { id: 'piece', name: 'Cái' },
    readOnly: true,
  })
  assert.equal((await e2e.client.get('/api/staff/v1/purchasing/products/c-sale-only')).status, 404)
  assert.equal((await e2e.client.get('/api/staff/v1/purchasing/products/missing')).status, 404)
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

const mutationHeaders = (csrfToken: string, key: string, version?: string) => ({
  'content-type': 'application/json',
  'x-csrf-token': csrfToken,
  'idempotency-key': key,
  ...(version ? { 'if-match': `"${version}"` } : {}),
})

test('staff purchasing channel completes all fourteen operations with one reviewed receipt lifecycle', async (t) => {
  const e2e = await boot(t)
  await seedOrdersAndBills(e2e)
  await e2e.client.login({ login: 'purchaser', password: 'correct horse battery' })
  const bootstrap = await e2e.client.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')
  const csrf = bootstrap.data.csrfToken
  const draft = { vendorId: 'vendor-a', lines: [{ productId: 'desk', quantity: '2' }] }

  assert.equal(
    (
      await e2e.client.request('/api/staff/v1/purchasing/orders/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'purchase-create-no-csrf' },
        body: JSON.stringify(draft),
      })
    ).status,
    403,
  )

  const create = await e2e.client.request('/api/staff/v1/purchasing/orders/create', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'purchase-create-reviewed-1'),
    body: JSON.stringify(draft),
  })
  assert.equal(create.status, 200)
  const created = (await create.json()) as Envelope<Row>
  assert.equal(created.data.state, 'draft')
  assert.equal((created.data.lines as Row[])[0]?.quantity, '2')
  assert.match(String(created.data.version), /^pov_[0-9a-f]{64}$/)
  assert.equal(create.headers.get('etag'), `"${String(created.data.version)}"`)

  const replay = await e2e.client.request('/api/staff/v1/purchasing/orders/create', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'purchase-create-reviewed-1'),
    body: JSON.stringify(draft),
  })
  assert.equal(replay.status, 200)
  assert.equal(((await replay.json()) as Envelope<Row>).data.id, created.data.id)

  const id = String(created.data.id)
  const updateBody = {
    vendorId: 'vendor-b',
    lines: [{ productId: 'desk', quantity: '3' }],
    expectedVersion: created.data.version,
  }
  const update = await e2e.client.request(`/api/staff/v1/purchasing/orders/${id}/update`, {
    method: 'PUT',
    headers: mutationHeaders(csrf, 'purchase-update-reviewed-1', String(created.data.version)),
    body: JSON.stringify(updateBody),
  })
  assert.equal(update.status, 200)
  const updated = (await update.json()) as Envelope<Row>
  assert.deepEqual(updated.data.vendor, { id: 'vendor-b', name: 'Bình An' })
  assert.equal((updated.data.lines as Row[])[0]?.quantity, '3')
  assert.notEqual(updated.data.version, created.data.version)

  const stale = await e2e.client.request(`/api/staff/v1/purchasing/orders/${id}/update`, {
    method: 'PUT',
    headers: mutationHeaders(csrf, 'purchase-update-stale-1', String(created.data.version)),
    body: JSON.stringify(updateBody),
  })
  assert.equal(stale.status, 409)
  assert.equal(((await stale.json()) as Envelope<null>).error?.code, 'purchase_staff_channel.versionConflict')

  const confirmation = await e2e.client.request(`/api/staff/v1/purchasing/orders/${id}/confirm`, {
    method: 'POST',
    headers: mutationHeaders(csrf, 'purchase-confirm-reviewed-1', String(updated.data.version)),
    body: JSON.stringify({ expectedVersion: updated.data.version }),
  })
  assert.equal(confirmation.status, 200)
  const confirmed = (await confirmation.json()) as Envelope<Row>
  assert.equal(confirmed.data.state, 'to approve')
  assert.deepEqual(confirmed.data.availableActions, ['approve'])

  const staleConfirmation = await e2e.client.request(`/api/staff/v1/purchasing/orders/${id}/confirm`, {
    method: 'POST',
    headers: mutationHeaders(csrf, 'purchase-confirm-stale-1', String(updated.data.version)),
    body: JSON.stringify({ expectedVersion: updated.data.version }),
  })
  assert.equal(staleConfirmation.status, 409)

  const approve = await e2e.client.request(`/api/staff/v1/purchasing/orders/${id}/approve`, {
    method: 'POST',
    headers: mutationHeaders(csrf, 'purchase-approve-reviewed-1', String(confirmed.data.version)),
    body: JSON.stringify({ expectedVersion: confirmed.data.version }),
  })
  assert.equal(approve.status, 200)
  const approved = (await approve.json()) as Envelope<Row>
  assert.equal(approved.data.state, 'purchase')
  assert.equal((approved.data.receipts as Row[]).length, 1)
  assert.deepEqual((approved.data.receipts as Row[])[0]?.availableActions, [])

  const receiptId = String((approved.data.receipts as Row[])[0]?.id)
  const scope = { company: 'acme', branches: null }
  const picking = (await e2e.fixture.call<Row>('stock.getPicking', { id: receiptId }, { scope })).value
  const move = (picking.moves as Row[])[0]!
  await e2e.fixture.call<Row>(
    'stock.saveMoveLine',
    {
      id: `${String(move.id)}:mobile-prepared`,
      moveId: move.id,
      quantity: move.productUomQty,
      picked: true,
    },
    { scope },
  )
  const prepared = await e2e.client.json<Envelope<Row>>(`/api/staff/v1/purchasing/orders/${id}`)
  assert.deepEqual((prepared.data.receipts as Row[])[0]?.availableActions, ['receive'])

  const receive = await e2e.client.request(
    `/api/staff/v1/purchasing/orders/${id}/receipts/${receiptId}/receive`,
    {
      method: 'POST',
      headers: mutationHeaders(csrf, 'purchase-receive-reviewed-1', String(prepared.data.version)),
      body: JSON.stringify({ expectedVersion: prepared.data.version }),
    },
  )
  assert.equal(receive.status, 200)
  const received = (await receive.json()) as Envelope<Row>
  assert.equal(received.data.outcome, 'received')
  assert.equal(received.data.receiptId, receiptId)
  assert.equal(received.data.lineCount, 1)
  assert.equal(((received.data.order as Row).lines as Row[])[0]?.receivedQuantity, '3')

  const cancelCreate = await e2e.client.request('/api/staff/v1/purchasing/orders/create', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'purchase-create-cancel-1'),
    body: JSON.stringify(draft),
  })
  assert.equal(cancelCreate.status, 200)
  const cancellable = (await cancelCreate.json()) as Envelope<Row>
  const cancel = await e2e.client.request(
    `/api/staff/v1/purchasing/orders/${String(cancellable.data.id)}/cancel`,
    {
      method: 'POST',
      headers: mutationHeaders(csrf, 'purchase-cancel-reviewed-1', String(cancellable.data.version)),
      body: JSON.stringify({ expectedVersion: cancellable.data.version }),
    },
  )
  assert.equal(cancel.status, 200)
  assert.equal(((await cancel.json()) as Envelope<Row>).data.state, 'cancel')
})
