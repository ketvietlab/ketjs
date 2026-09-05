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
    'account.listJournals',
    'account.registerInvoicePayment',
    'account.postMove',
    'account.cancelMove',
    'account_staff_channel.beginInvoiceCommand',
    'account_staff_channel.completeInvoiceCommand',
    'account_staff_channel.getInvoiceCommand',
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

test('staff accounting channel returns versioned actionable invoice totals', async (t) => {
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
  assert.deepEqual(detail.data.availableActions, ['collect_payment'])
  assert.equal(detail.data.readOnly, false)

  assert.equal((await e2e.client.get('/api/staff/v1/accounting/invoices/bill-a')).status, 404)
  assert.equal((await e2e.client.get('/api/staff/v1/accounting/invoices/missing')).status, 404)
})

test('staff accounting channel keeps large residual eligibility exact', async (t) => {
  const e2e = await boot(t)
  const fixture = (name: string, input: Record<string, unknown>) =>
    e2e.fixture.call<Row>(name, input, { scope: { company: 'acme', branches: null } })
  await fixture('account.createInvoice', {
    id: 'invoice-large',
    journalId: 'sales-journal',
    moveType: 'out_invoice',
    partnerId: 'customer-a',
    invoiceDate: '2026-08-25T00:00:00.000Z',
    description: 'Giá trị lớn',
    quantity: '1',
    priceUnit: '9007199254740993',
    lineAccountId: 'revenue',
    counterpartAccountId: 'receivable',
  })
  await fixture('account.postMove', { id: 'invoice-large' })
  await e2e.client.login({ login: 'accounting-user', password: 'correct horse battery' })

  const detail = await e2e.client.json<Envelope<Row>>('/api/staff/v1/accounting/invoices/invoice-large')
  assert.deepEqual(detail.data.amountDue, { currency: 'VND', amount: '9007199254740993' })
  assert.deepEqual(detail.data.availableActions, ['collect_payment'])

  const eligibility = await e2e.client.json<Envelope<Row>>(
    '/api/staff/v1/accounting/invoices/invoice-large/payment-eligibility?today=2026-08-25',
  )
  assert.equal(eligibility.data.eligible, true)
  assert.equal(eligibility.data.reason, 'available')
  assert.deepEqual(eligibility.data.amount, { currency: 'VND', amount: '9007199254740993' })
})

test('staff accounting channel reviews exact full-payment eligibility without mutating', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'accounting-user', password: 'correct horse battery' })

  assert.equal(
    (await e2e.client.get('/api/staff/v1/accounting/invoices/invoice-a/payment-eligibility')).status,
    422,
  )
  const detail = await e2e.client.json<Envelope<Row>>('/api/staff/v1/accounting/invoices/invoice-a')
  const response = await e2e.client.get(
    '/api/staff/v1/accounting/invoices/invoice-a/payment-eligibility?today=2026-08-25',
  )
  assert.equal(response.status, 200)
  const body = (await response.json()) as Envelope<Row>
  assert.deepEqual(body.data, {
    eligible: true,
    reason: 'available',
    invoiceId: 'invoice-a',
    expectedVersion: detail.data.version,
    amount: { currency: 'VND', amount: '150' },
    paymentDate: '2026-08-25',
    journals: [{ id: 'cash-journal', name: 'Tiền mặt', type: 'cash' }],
  })
  // The concurrency token is still the invoice's, which is the half worth
  // sharing: a payment command checks it against the invoice. The ETag is not,
  // because this body says more than the invoice does.
  assert.match(String(response.headers.get('etag')), /^"aipe_[0-9a-f]{64}"$/)

  const credit = await e2e.client.json<Envelope<Row>>(
    '/api/staff/v1/accounting/invoices/credit-a/payment-eligibility?today=2026-08-25',
  )
  assert.equal(credit.data.eligible, false)
  assert.equal(credit.data.reason, 'unsupported_invoice_type')
  assert.deepEqual(credit.data.journals, [])
  assert.equal(
    (await e2e.client.get('/api/staff/v1/accounting/invoices/bill-a/payment-eligibility?today=2026-08-25'))
      .status,
    404,
  )
})

test('staff accounting channel reviews only generic lifecycle actions for the current state', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'accounting-user', password: 'correct horse battery' })

  const draft = await e2e.client.get('/api/staff/v1/accounting/invoices/credit-a/lifecycle-eligibility')
  assert.equal(draft.status, 200)
  const draftBody = (await draft.json()) as Envelope<Row>
  assert.deepEqual(draftBody.data.actions, [
    { action: 'post', destructive: false },
    { action: 'cancel_draft', destructive: true },
  ])
  assert.match(String(draftBody.data.expectedVersion), /^aiv_[0-9a-f]{64}$/)
  assert.equal(draft.headers.get('etag'), `"${String(draftBody.data.expectedVersion)}"`)

  const posted = await e2e.client.json<Envelope<Row>>(
    '/api/staff/v1/accounting/invoices/invoice-a/lifecycle-eligibility',
  )
  assert.deepEqual(posted.data.actions, [])
  assert.equal(
    (await e2e.client.get('/api/staff/v1/accounting/invoices/bill-a/lifecycle-eligibility')).status,
    404,
  )
})

const mutationHeaders = (csrfToken: string, key: string, version: string) => ({
  'content-type': 'application/json',
  'x-csrf-token': csrfToken,
  'idempotency-key': key,
  'if-match': `"${version}"`,
})

test('staff accounting channel completes all eight operations with durable payment and lifecycle commands', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'accounting-user', password: 'correct horse battery' })
  const bootstrap = await e2e.client.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')
  const csrf = bootstrap.data.csrfToken

  const invoice = await e2e.client.json<Envelope<Row>>('/api/staff/v1/accounting/invoices/invoice-a')
  const paymentKey = 'account-payment-reviewed-1'
  const paymentBody = {
    journalId: 'cash-journal',
    expectedVersion: invoice.data.version,
  }
  assert.equal(
    (
      await e2e.client.request('/api/staff/v1/accounting/invoices/invoice-a/payments', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': paymentKey,
        },
        body: JSON.stringify(paymentBody),
      })
    ).status,
    403,
  )

  const paid = await e2e.client.request('/api/staff/v1/accounting/invoices/invoice-a/payments', {
    method: 'POST',
    headers: mutationHeaders(csrf, paymentKey, String(invoice.data.version)),
    body: JSON.stringify(paymentBody),
  })
  assert.equal(paid.status, 200)
  const paidBody = (await paid.json()) as Envelope<Row>
  assert.equal(paidBody.data.outcome, 'payment_registered')
  assert.equal(((paidBody.data.invoice as Row).amountDue as Row).amount, '0')
  assert.equal((paidBody.data.invoice as Row).paymentStatus, 'paid')
  assert.deepEqual(paidBody.data.journal, { id: 'cash-journal', name: 'Tiền mặt', type: 'cash' })
  assert.notEqual((paidBody.data.invoice as Row).version, invoice.data.version)

  const paymentReplay = await e2e.client.request('/api/staff/v1/accounting/invoices/invoice-a/payments', {
    method: 'POST',
    headers: mutationHeaders(csrf, paymentKey, String(invoice.data.version)),
    body: JSON.stringify(paymentBody),
  })
  assert.equal(paymentReplay.status, 200)
  assert.equal(((await paymentReplay.json()) as Envelope<Row>).data.outcome, 'payment_registered')

  const paymentCommand = await e2e.client.get(
    `/api/staff/v1/accounting/invoices/invoice-a/payment-commands/${paymentKey}?journalId=cash-journal&expectedVersion=${encodeURIComponent(String(invoice.data.version))}`,
  )
  assert.equal(paymentCommand.status, 200)
  assert.equal(((await paymentCommand.json()) as Envelope<Row>).data.outcome, 'payment_registered')
  assert.equal(
    (
      await e2e.client.get(
        `/api/staff/v1/accounting/invoices/invoice-a/payment-commands/${paymentKey}?journalId=cash-journal&expectedVersion=${`aiv_${'0'.repeat(64)}`}`,
      )
    ).status,
    409,
  )

  const stalePayment = await e2e.client.request('/api/staff/v1/accounting/invoices/invoice-a/payments', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'account-payment-stale-1', String(invoice.data.version)),
    body: JSON.stringify(paymentBody),
  })
  assert.equal(stalePayment.status, 409)

  const draft = await e2e.client.json<Envelope<Row>>('/api/staff/v1/accounting/invoices/credit-a')
  assert.deepEqual(draft.data.availableActions, ['post', 'cancel_draft'])
  const lifecycleKey = 'account-lifecycle-reviewed-1'
  const lifecycleBody = { action: 'post', expectedVersion: draft.data.version }
  const posted = await e2e.client.request('/api/staff/v1/accounting/invoices/credit-a/lifecycle', {
    method: 'POST',
    headers: mutationHeaders(csrf, lifecycleKey, String(draft.data.version)),
    body: JSON.stringify(lifecycleBody),
  })
  assert.equal(posted.status, 200)
  const postedBody = (await posted.json()) as Envelope<Row>
  assert.equal(postedBody.data.outcome, 'post')
  assert.equal((postedBody.data.invoice as Row).state, 'posted')
  assert.notEqual((postedBody.data.invoice as Row).version, draft.data.version)

  const lifecycleReplay = await e2e.client.request('/api/staff/v1/accounting/invoices/credit-a/lifecycle', {
    method: 'POST',
    headers: mutationHeaders(csrf, lifecycleKey, String(draft.data.version)),
    body: JSON.stringify(lifecycleBody),
  })
  assert.equal(lifecycleReplay.status, 200)

  const lifecycleCommand = await e2e.client.get(
    `/api/staff/v1/accounting/invoices/credit-a/lifecycle-commands/${lifecycleKey}?action=post&expectedVersion=${encodeURIComponent(String(draft.data.version))}`,
  )
  assert.equal(lifecycleCommand.status, 200)
  assert.equal(((await lifecycleCommand.json()) as Envelope<Row>).data.outcome, 'post')
})

test('staff invoice version tracks the names it resolves elsewhere', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'accounting-user', password: 'correct horse battery' })
  const read = async () => {
    const response = await e2e.client.get('/api/staff/v1/accounting/invoices/invoice-a')
    const body = (await response.json()) as Envelope<Row>
    return {
      version: String(body.data.version),
      etag: response.headers.get('etag'),
      customer: String((body.data.customer as Row).name),
    }
  }
  const before = await read()
  // The customer name comes from partner, not from the move. Hashing the move
  // alone answered "not modified" after a rename, and a client holding that
  // ETag would have kept the old name.
  await e2e.fixture.call<Row>(
    'partner.savePartner',
    { id: 'customer-a', kind: 'company', name: 'Minh An Đã Đổi' },
    { scope: { company: 'acme', branches: null } },
  )
  const after = await read()
  assert.equal(after.customer, 'Minh An Đã Đổi')
  assert.notEqual(after.version, before.version)
  assert.equal(after.etag, `"${after.version}"`)
})

test('staff payment eligibility ETag tracks the journals and the day it was asked about', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'accounting-user', password: 'correct horse battery' })
  const read = async (today: string) => {
    const response = await e2e.client.get(
      `/api/staff/v1/accounting/invoices/invoice-a/payment-eligibility?today=${today}`,
    )
    const body = (await response.json()) as Envelope<Row>
    return { etag: response.headers.get('etag'), body: body.data }
  }

  // Two different days are two different answers, and an ETag that cannot tell
  // them apart tells a caller its stale copy is current.
  const dayOne = await read('2026-08-25')
  const dayTwo = await read('2026-09-30')
  assert.equal(dayOne.body.paymentDate, '2026-08-25')
  assert.equal(dayTwo.body.paymentDate, '2026-09-30')
  assert.notEqual(dayOne.etag, dayTwo.etag)

  // The journals come from the tenant, not from the invoice.
  await e2e.fixture.call<Row>(
    'account.saveJournal',
    { id: 'cash-journal', name: 'Quỹ tiền mặt', code: 'CSH', type: 'cash', defaultAccountId: 'cash' },
    { scope: { company: 'acme', branches: null } },
  )
  const renamed = await read('2026-08-25')
  assert.deepEqual((renamed.body.journals as Row[])[0], {
    id: 'cash-journal',
    name: 'Quỹ tiền mặt',
    type: 'cash',
  })
  assert.notEqual(renamed.etag, dayOne.etag)
  // The invoice did not change, so the token a payment would check has not.
  assert.equal(renamed.body.expectedVersion, dayOne.body.expectedVersion)
})

test('staff payment reconciliation ETag tracks the journal it hands back', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'accounting-user', password: 'correct horse battery' })
  const bootstrap = await e2e.client.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')
  const csrf = bootstrap.data.csrfToken
  const invoice = await e2e.client.json<Envelope<Row>>('/api/staff/v1/accounting/invoices/invoice-a')
  const key = 'account-payment-etag-1'
  const paid = await e2e.client.request('/api/staff/v1/accounting/invoices/invoice-a/payments', {
    method: 'POST',
    headers: mutationHeaders(csrf, key, String(invoice.data.version)),
    body: JSON.stringify({ journalId: 'cash-journal', expectedVersion: invoice.data.version }),
  })
  assert.equal(paid.status, 200)

  // The reconciliation read is a GET, so a caller can and will act on its ETag.
  // The journal in that body comes from the tenant, not the invoice.
  const reconcile = `/api/staff/v1/accounting/invoices/invoice-a/payment-commands/${key}?journalId=cash-journal&expectedVersion=${encodeURIComponent(String(invoice.data.version))}`
  const read = async () => {
    const response = await e2e.client.get(reconcile)
    const body = (await response.json()) as Envelope<{ journal: Row; invoice: Row }>
    return { etag: response.headers.get('etag'), journal: String(body.data.journal.name) }
  }
  const before = await read()
  assert.equal(before.journal, 'Tiền mặt')
  await e2e.fixture.call<Row>(
    'account.saveJournal',
    { id: 'cash-journal', name: 'Quỹ tiền mặt', code: 'CSH', type: 'cash', defaultAccountId: 'cash' },
    { scope: { company: 'acme', branches: null } },
  )
  const after = await read()
  assert.equal(after.journal, 'Quỹ tiền mặt')
  assert.notEqual(after.etag, before.etag)
  assert.match(String(after.etag), /^"aipr_[0-9a-f]{64}"$/)
})
