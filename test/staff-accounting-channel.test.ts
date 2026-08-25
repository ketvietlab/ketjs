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
    id: 'accounting-user',
    login: 'accounting-user',
    password: 'correct horse battery',
    name: 'Accounting User',
    defaultCompanyId: 'acme',
    superuser: false,
  })
  await fixture('user.grantCompany', {
    id: 'accounting-user:acme',
    userId: 'accounting-user',
    companyId: 'acme',
  })
  await fixture('user.saveRole', { id: 'invoice-reader', name: 'Invoice reader' })
  for (const fnKey of [
    'account.listMoves',
    'account.listMoveResiduals',
    'account.getMove',
    'partner.listPartners',
  ])
    await fixture('user.grantFunction', {
      id: `invoice-reader:${fnKey}`,
      roleId: 'invoice-reader',
      fnKey,
    })
  await fixture('user.assignRole', {
    id: 'accounting-user:invoice-reader',
    userId: 'accounting-user',
    roleId: 'invoice-reader',
  })

  for (const [id, name] of [
    ['customer-a', 'Minh An'],
    ['customer-b', 'Bình Minh'],
    ['vendor-a', 'Nhà cung cấp'],
  ])
    await fixture('partner.savePartner', { id, kind: 'company', name })
  await fixture('account.saveAccount', {
    id: 'revenue',
    code: '511',
    name: 'Doanh thu',
    accountType: 'income',
  })
  await fixture('account.saveAccount', {
    id: 'receivable',
    code: '131',
    name: 'Phải thu',
    accountType: 'asset_receivable',
    reconcile: true,
  })
  await fixture('account.saveAccount', {
    id: 'cash',
    code: '111',
    name: 'Tiền mặt',
    accountType: 'asset_cash',
  })
  await fixture('account.saveAccount', {
    id: 'expense',
    code: '642',
    name: 'Chi phí',
    accountType: 'expense',
  })
  await fixture('account.saveAccount', {
    id: 'payable',
    code: '331',
    name: 'Phải trả',
    accountType: 'liability_payable',
    reconcile: true,
  })
  await fixture('account.saveJournal', {
    id: 'sales-journal',
    name: 'Bán hàng',
    code: 'SAL',
    type: 'sale',
  })
  await fixture('account.saveJournal', {
    id: 'purchase-journal',
    name: 'Mua hàng',
    code: 'PUR',
    type: 'purchase',
  })
  await fixture('account.saveJournal', {
    id: 'cash-journal',
    name: 'Tiền mặt',
    code: 'CSH',
    type: 'cash',
    defaultAccountId: 'cash',
  })
  await fixture('account.createInvoice', {
    id: 'invoice-a',
    journalId: 'sales-journal',
    moveType: 'out_invoice',
    partnerId: 'customer-a',
    invoiceDate: '2026-08-20T00:00:00.000Z',
    ref: 'SPECIAL-ORDER',
    description: 'Dịch vụ triển khai',
    quantity: '2',
    priceUnit: '100',
    lineAccountId: 'revenue',
    counterpartAccountId: 'receivable',
  })
  await fixture('account.postMove', { id: 'invoice-a' })
  const postedInvoice = await fixture('account.getMove', { id: 'invoice-a' })
  const receivableLine = (postedInvoice.value.lines as Row[]).find((line) => Number(line.amountResidual) > 0)
  assert.ok(receivableLine)
  const payment = await fixture('account.registerPayment', {
    id: 'payment-a',
    name: 'PAY/1',
    paymentType: 'inbound',
    partnerType: 'customer',
    partnerId: 'customer-a',
    journalId: 'cash-journal',
    destinationAccountId: 'receivable',
    amount: '50',
    reconcileLineId: receivableLine.id,
  })
  assert.equal(payment.value.ok, true, JSON.stringify(payment.value))
  await fixture('account.createInvoice', {
    id: 'credit-a',
    journalId: 'sales-journal',
    moveType: 'out_refund',
    partnerId: 'customer-b',
    invoiceDate: '2026-08-21T00:00:00.000Z',
    description: 'Điều chỉnh',
    quantity: '1',
    priceUnit: '50',
    lineAccountId: 'revenue',
    counterpartAccountId: 'receivable',
  })
  await fixture('account.createInvoice', {
    id: 'bill-a',
    journalId: 'purchase-journal',
    moveType: 'in_invoice',
    partnerId: 'vendor-a',
    invoiceDate: '2026-08-22T00:00:00.000Z',
    description: 'Không thuộc customer invoice',
    quantity: '1',
    priceUnit: '75',
    lineAccountId: 'expense',
    counterpartAccountId: 'payable',
  })
  return e2e
}

test('staff accounting channel pages customer invoices with residuals and filters', async (t) => {
  const e2e = await boot(t)
  assert.equal((await e2e.client.get('/api/staff/v1/accounting/invoices')).status, 401)
  await e2e.client.login({ login: 'accounting-user', password: 'correct horse battery' })

  const first = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      '/api/staff/v1/accounting/invoices?limit=1',
    )
  ).data
  assert.deepEqual(first.items, [
    {
      id: 'credit-a',
      reference: 'credit-a',
      kind: 'credit_note',
      state: 'draft',
      paymentStatus: 'unpaid',
      customer: { id: 'customer-b', name: 'Bình Minh' },
      invoiceDate: '2026-08-21T00:00:00.000Z',
      dueAt: '2026-08-21T00:00:00.000Z',
      total: { currency: 'VND', amount: '50' },
      amountDue: { currency: 'VND', amount: '50' },
    },
  ])
  assert.ok(first.nextCursor)

  const second = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      `/api/staff/v1/accounting/invoices?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
    )
  ).data
  assert.equal(second.items[0]?.id, 'invoice-a')
  assert.equal(second.items[0]?.paymentStatus, 'partial')
  assert.deepEqual(second.items[0]?.amountDue, { currency: 'VND', amount: '150' })
  assert.equal(second.nextCursor, null)

  const creditNotes = (
    await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/accounting/invoices?status=credit_note')
  ).data
  assert.deepEqual(
    creditNotes.items.map((item) => item.id),
    ['credit-a'],
  )
  const searched = (
    await e2e.client.json<Envelope<{ items: Row[] }>>(
      '/api/staff/v1/accounting/invoices?query=SPECIAL&dateFrom=2026-08-20&dateTo=2026-08-20',
    )
  ).data
  assert.deepEqual(
    searched.items.map((item) => item.id),
    ['invoice-a'],
  )
  const unpaid = (
    await e2e.client.json<Envelope<{ items: Row[] }>>(
      '/api/staff/v1/accounting/invoices?status=unpaid&query=SPECIAL',
    )
  ).data
  assert.deepEqual(
    unpaid.items.map((item) => item.id),
    ['invoice-a'],
  )
  assert.equal((await e2e.client.get('/api/staff/v1/accounting/invoices?query=x')).status, 422)
})

test('staff accounting channel returns versioned read-only invoice totals', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'accounting-user', password: 'correct horse battery' })

  const response = await e2e.client.get('/api/staff/v1/accounting/invoices/invoice-a')
  assert.equal(response.status, 200)
  const detail = (await response.json()) as Envelope<Row>
  assert.match(String(detail.data.version), /^aiv_[0-9a-f]{64}$/)
  assert.equal(response.headers.get('etag'), `"${String(detail.data.version)}"`)
  assert.equal(detail.data.sourceReference, 'SPECIAL-ORDER')
  assert.equal(detail.data.postingLineCount, 2)
  assert.deepEqual(detail.data.totals, {
    untaxed: { currency: 'VND', amount: '200' },
    tax: { currency: 'VND', amount: '0' },
    total: { currency: 'VND', amount: '200' },
    amountDue: { currency: 'VND', amount: '150' },
  })
  assert.deepEqual(detail.data.availableActions, [])
  assert.equal(detail.data.readOnly, true)

  assert.equal((await e2e.client.get('/api/staff/v1/accounting/invoices/bill-a')).status, 404)
  assert.equal((await e2e.client.get('/api/staff/v1/accounting/invoices/missing')).status, 404)
})
