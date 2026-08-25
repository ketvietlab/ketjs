import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { SALE_STATES } from '../packages/ketsuite/src/modules/sale/functions.ts'
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

const seedProducts = async (e2e: Awaited<ReturnType<typeof boot>>) => {
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    e2e.fixture.call<Row>(name, input, { scope })
  await fixture('uom.saveUnit', { id: 'kg', name: 'kg', relativeFactor: '1' })
  await fixture('product.saveCategory', { id: 'fruit', name: 'Trái cây' })
  for (const template of [
    {
      id: 'stock-template',
      name: 'Xoài Cát',
      type: 'goods',
      categoryId: 'fruit',
      uomId: 'kg',
      saleOk: true,
      purchaseOk: false,
    },
    {
      id: 'consumable-template',
      name: 'Túi giấy',
      type: 'goods',
      uomId: 'kg',
      saleOk: true,
      purchaseOk: false,
    },
    {
      id: 'service-template',
      name: 'Gói quà',
      type: 'service',
      uomId: 'kg',
      saleOk: true,
      purchaseOk: false,
    },
    {
      id: 'purchase-only-template',
      name: 'Không được bán',
      type: 'goods',
      uomId: 'kg',
      saleOk: false,
      purchaseOk: true,
    },
  ])
    await fixture('product.saveTemplate', { listPrice: '0', ...template })
  for (const [id, templateId, defaultCode] of [
    ['a-stock', 'stock-template', 'XCAT-01'],
    ['b-consumable', 'consumable-template', 'TUI-01'],
    ['c-service', 'service-template', 'GOI-01'],
    ['d-purchase-only', 'purchase-only-template', 'BUY-ONLY'],
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

test('staff sales channel projects the canonical order delivery and invoice lifecycle', async (t) => {
  const e2e = await boot(t)
  await seedOrders(e2e)
  await e2e.fixture.call<Row>(
    'sale.confirmOrder',
    { id: 'so-a' },
    { scope: { company: 'acme', branches: null } },
  )
  await e2e.client.login({ login: 'salesperson', password: 'correct horse battery' })

  const response = await e2e.client.get('/api/staff/v1/sales/orders/so-a/lifecycle')
  assert.equal(response.status, 200)
  const body = (await response.json()) as Envelope<Row>
  assert.deepEqual(body.data.order, {
    id: 'so-a',
    reference: 'S00001',
    state: 'sale',
  })
  assert.deepEqual(body.data.deliveries, [
    {
      id: 'so-a:delivery',
      reference: 'Delivery S00001',
      state: 'draft',
    },
  ])
  assert.deepEqual(body.data.invoices, [])
  assert.equal(body.data.readOnly, true)
  assert.match(String(body.data.version), /^solv_[0-9a-f]{64}$/)
  assert.equal(response.headers.get('etag'), `"${String(body.data.version)}"`)

  assert.equal((await e2e.client.get('/api/staff/v1/sales/orders/missing/lifecycle')).status, 404)
})

test('staff sales channel exposes only bounded sellable product projections', async (t) => {
  const e2e = await boot(t)
  await seedProducts(e2e)
  assert.equal((await e2e.client.get('/api/staff/v1/sales/products')).status, 401)
  await e2e.client.login({ login: 'salesperson', password: 'correct horse battery' })

  const first = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      '/api/staff/v1/sales/products?limit=1',
    )
  ).data
  assert.deepEqual(first.items, [
    {
      id: 'a-stock',
      name: 'Xoài Cát',
      kind: 'stockable',
      sku: 'XCAT-01',
      category: 'Trái cây',
      uom: { id: 'kg', name: 'kg' },
    },
  ])
  assert.ok(first.nextCursor)

  const rest = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      `/api/staff/v1/sales/products?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
    )
  ).data
  assert.deepEqual(
    rest.items.map((item) => [item.id, item.kind]),
    [
      ['b-consumable', 'consumable'],
      ['c-service', 'service'],
    ],
  )
  assert.equal(rest.nextCursor, null)

  const searched = (
    await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/sales/products?query=Xoài')
  ).data
  assert.deepEqual(
    searched.items.map((item) => item.id),
    ['a-stock'],
  )
  assert.equal((await e2e.client.get('/api/staff/v1/sales/products?query=x')).status, 422)
})

test('staff sales channel reads one sellable product and hides unsuitable variants', async (t) => {
  const e2e = await boot(t)
  await seedProducts(e2e)
  await e2e.client.login({ login: 'salesperson', password: 'correct horse battery' })

  const product = await e2e.client.json<Envelope<Row>>('/api/staff/v1/sales/products/a-stock')
  assert.deepEqual(product.data, {
    id: 'a-stock',
    name: 'Xoài Cát',
    kind: 'stockable',
    sku: 'XCAT-01',
    category: 'Trái cây',
    uom: { id: 'kg', name: 'kg' },
    readOnly: true,
  })
  assert.equal((await e2e.client.get('/api/staff/v1/sales/products/d-purchase-only')).status, 404)
  assert.equal((await e2e.client.get('/api/staff/v1/sales/products/missing')).status, 404)
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

test('staff sales channel accepts every state its domain can reach', async (t) => {
  const e2e = await boot(t)
  await seedOrders(e2e)
  await e2e.client.login({ login: 'salesperson', password: 'correct horse battery' })
  // The published enum is now binding, so a contract that drifts behind the
  // domain does not read as stale documentation — it refuses a filter the
  // salesperson is entitled to use.
  for (const state of SALE_STATES) {
    const response = await e2e.client.get(`/api/staff/v1/sales/orders?state=${encodeURIComponent(state)}`)
    assert.equal(response.status, 200, state)
  }
})

test('staff product directory reads only the units and categories a page names', async (t) => {
  const e2e = await boot(t)
  await seedProducts(e2e)
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    e2e.fixture.call<Row>(name, input, { scope })
  // Units and categories nothing on the page points at. Labelling a product must
  // not become a reason to read them.
  for (const id of ['box', 'pallet', 'crate'])
    await fixture('uom.saveUnit', { id, name: id, relativeFactor: '1' })
  for (const id of ['electronics', 'furniture']) await fixture('product.saveCategory', { id, name: id })

  const units = (await e2e.fixture.call<Row[]>('uom.listUnits', { ids: ['kg'] }, { scope })).value
  assert.deepEqual(
    units.map((row) => String(row.id)),
    ['kg'],
  )
  const categories = (await e2e.fixture.call<Row[]>('product.listCategories', { ids: ['fruit'] }, { scope }))
    .value
  assert.deepEqual(
    categories.map((row) => String(row.id)),
    ['fruit'],
  )
  assert.deepEqual((await e2e.fixture.call<Row[]>('uom.listUnits', { ids: [] }, { scope })).value, [])

  // The route still labels the page correctly while asking for that much less.
  await e2e.client.login({ login: 'salesperson', password: 'correct horse battery' })
  const page = (await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/sales/products?limit=50'))
    .data
  assert.deepEqual(page.items[0]?.uom, { id: 'kg', name: 'kg' })
  assert.equal(page.items[0]?.category, 'Trái cây')
})

test('staff product routes tolerate undeclared query parameters like their siblings', async (t) => {
  const e2e = await boot(t)
  await seedProducts(e2e)
  await e2e.client.login({ login: 'salesperson', password: 'correct horse battery' })
  // A native client that appends an analytics or cache-busting parameter must
  // not find one endpoint working and the one beside it answering 422.
  assert.equal((await e2e.client.get('/api/staff/v1/sales/products?_cacheBust=1')).status, 200)
  assert.equal((await e2e.client.get('/api/staff/v1/sales/orders?_cacheBust=1')).status, 200)
  // What the contract does declare is still enforced.
  assert.equal((await e2e.client.get('/api/staff/v1/sales/products?query=x')).status, 422)
  assert.equal((await e2e.client.get('/api/staff/v1/sales/products?limit=999')).status, 422)
})

const mutationHeaders = (csrfToken: string, key: string, version?: string) => ({
  'content-type': 'application/json',
  'x-csrf-token': csrfToken,
  'idempotency-key': key,
  ...(version ? { 'if-match': `"${version}"` } : {}),
})

test('staff sales channel completes the twelve-operation module with one versioned draft lifecycle', async (t) => {
  const e2e = await boot(t)
  await seedOrders(e2e)
  await e2e.client.login({ login: 'salesperson', password: 'correct horse battery' })
  const bootstrap = await e2e.client.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')
  const csrf = bootstrap.data.csrfToken
  const createBody = {
    partnerId: 'customer-a',
    warehouseId: 'wh',
    customerReference: 'NATIVE-001',
    notes: 'Giao buổi sáng',
    lines: [{ productId: 'chair', quantity: '2', uomId: 'unit' }],
  }

  assert.equal(
    (
      await e2e.client.request('/api/staff/v1/sales/orders/create', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'staff-sales-create-1',
        },
        body: JSON.stringify(createBody),
      })
    ).status,
    403,
  )

  const create = await e2e.client.request('/api/staff/v1/sales/orders/create', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'staff-sales-create-1'),
    body: JSON.stringify(createBody),
  })
  assert.equal(create.status, 200)
  const created = (await create.json()) as Envelope<Row>
  assert.equal(created.data.state, 'draft')
  assert.equal(created.data.customerReference, 'NATIVE-001')
  assert.match(String(created.data.version), /^sov_[0-9a-f]{64}$/)
  assert.match(String(created.data.availabilityVersion), /^sav_[0-9a-f]{64}$/)
  assert.equal(created.data.warehouseId, 'wh')
  assert.equal(create.headers.get('etag'), `"${String(created.data.version)}"`)

  const replay = await e2e.client.request('/api/staff/v1/sales/orders/create', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'staff-sales-create-1'),
    body: JSON.stringify(createBody),
  })
  assert.equal(replay.status, 200)
  assert.equal(((await replay.json()) as Envelope<Row>).data.id, created.data.id)

  const id = String(created.data.id)
  const canonical = await e2e.client.json<Envelope<Row>>(`/api/staff/v1/sales/orders/${id}`)
  assert.equal(canonical.data.version, created.data.version)

  const updateBody = {
    ...createBody,
    notes: 'Giao trước 10 giờ',
    lines: [{ productId: 'chair', quantity: '3', uomId: 'unit' }],
    expectedVersion: created.data.version,
  }
  const update = await e2e.client.request(`/api/staff/v1/sales/orders/${id}/update`, {
    method: 'PUT',
    headers: mutationHeaders(csrf, 'staff-sales-update-1', String(created.data.version)),
    body: JSON.stringify(updateBody),
  })
  assert.equal(update.status, 200)
  const updated = (await update.json()) as Envelope<Row>
  assert.equal(updated.data.notes, 'Giao trước 10 giờ')
  assert.equal((updated.data.lines as Row[])[0]?.quantity, '3')
  assert.deepEqual(updated.data.total, { currency: 'VND', amount: '9000000' })
  assert.notEqual(updated.data.version, created.data.version)

  const stale = await e2e.client.request(`/api/staff/v1/sales/orders/${id}/update`, {
    method: 'PUT',
    headers: mutationHeaders(csrf, 'staff-sales-update-stale', String(created.data.version)),
    body: JSON.stringify(updateBody),
  })
  assert.equal(stale.status, 409)
  assert.equal(((await stale.json()) as Envelope<null>).error?.code, 'sale_staff_channel.versionConflict')

  const wrongAvailability = await e2e.client.request(`/api/staff/v1/sales/orders/${id}/confirm`, {
    method: 'POST',
    headers: mutationHeaders(csrf, 'staff-sales-confirm-stale', String(updated.data.version)),
    body: JSON.stringify({
      expectedVersion: updated.data.version,
      availabilityVersion: `sav_${'0'.repeat(64)}`,
    }),
  })
  assert.equal(wrongAvailability.status, 409)
  assert.equal(
    ((await wrongAvailability.json()) as Envelope<null>).error?.code,
    'sale_staff_channel.availabilityChanged',
  )

  const confirm = await e2e.client.request(`/api/staff/v1/sales/orders/${id}/confirm`, {
    method: 'POST',
    headers: mutationHeaders(csrf, 'staff-sales-confirm-1', String(updated.data.version)),
    body: JSON.stringify({
      expectedVersion: updated.data.version,
      availabilityVersion: updated.data.availabilityVersion,
    }),
  })
  assert.equal(confirm.status, 200)
  const confirmed = (await confirm.json()) as Envelope<Row>
  assert.equal(confirmed.data.state, 'sale')
  assert.notEqual(confirmed.data.version, updated.data.version)

  const lifecycle = await e2e.client.json<Envelope<Row>>(`/api/staff/v1/sales/orders/${id}/lifecycle`)
  assert.equal((lifecycle.data.deliveries as Row[]).length, 1)

  const cancel = await e2e.client.request(`/api/staff/v1/sales/orders/${id}/cancel`, {
    method: 'POST',
    headers: mutationHeaders(csrf, 'staff-sales-cancel-1', String(confirmed.data.version)),
    body: JSON.stringify({ expectedVersion: confirmed.data.version }),
  })
  assert.equal(cancel.status, 200)
  const cancelled = (await cancel.json()) as Envelope<Row>
  assert.equal(cancelled.data.state, 'cancel')
  assert.notEqual(cancelled.data.version, confirmed.data.version)
})
