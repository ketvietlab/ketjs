import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestApp } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/app.ts'

async function bootAccounting(t: TestContext) {
  const e2e = await createTestApp(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input, { scope })
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

test('e2e accounting: invoice, payment reconciliation and reports cross real HTTP', async (t) => {
  const { e2e, call } = await bootAccounting(t)
  await call('partner.savePartner', { id: 'customer', kind: 'company', name: 'Khách hàng ABC' })
  const dashboard = await e2e.client.get('/admin/accounting', { headers: { accept: 'text/html' } })
  assert.equal(dashboard.status, 200)
  const accounts = (await call<Row[]>('account.listAccounts')).value
  const journals = (await call<Row[]>('account.listJournals')).value
  const taxes = (await call<Row[]>('account.listTaxes', { typeTaxUse: 'sale' })).value
  const terms = (await call<Row[]>('account.listPaymentTerms')).value
  assert.equal(accounts.length, 216)
  const accountId = (code: string) => String(accounts.find((row) => row.code === code)?.id)
  const salesJournalId = String(journals.find((row) => row.type === 'sale')?.id)
  const bankJournalId = String(journals.find((row) => row.type === 'bank')?.id)
  const vat10Id = String(taxes.find((row) => Number(row.amount) === 10)?.id)
  const net30Id = String(terms.find((row) => row.name === '30 ngày')?.id)

  const created = (
    await call<Row>('account.createInvoice', {
      id: 'invoice-1',
      journalId: salesJournalId,
      moveType: 'out_invoice',
      partnerId: 'customer',
      invoiceDate: '2026-08-20T00:00:00.000Z',
      paymentTermId: net30Id,
      ref: 'INV/DEMO',
      description: 'Dịch vụ triển khai',
      quantity: '2',
      priceUnit: '100',
      lineAccountId: accountId('511'),
      counterpartAccountId: accountId('1311'),
      taxId: vat10Id,
    })
  ).value
  assert.deepEqual(created, { ok: true, id: 'invoice-1', amountTotal: '220' })
  assert.equal((await call<Row>('account.postMove', { id: 'invoice-1' })).value.name, 'SAL/2026/00001')

  const openItems = (await call<Row[]>('account.listOpenItems', { partnerId: 'customer' })).value
  assert.equal(openItems.length, 1)
  assert.equal(openItems[0]!.accountId, accountId('1311'))
  const receivableLineId = String(openItems[0]!.id)

  await call('account.registerPayment', {
    id: 'payment-1',
    name: 'PAY/1',
    paymentType: 'inbound',
    partnerType: 'customer',
    partnerId: 'customer',
    journalId: bankJournalId,
    destinationAccountId: accountId('1311'),
    amount: '100',
    reconcileLineId: receivableLineId,
  })
  assert.equal((await call<Row>('account.getMove', { id: 'invoice-1' })).value.paymentState, 'partial')
  await call('account.registerPayment', {
    id: 'payment-2',
    name: 'PAY/2',
    paymentType: 'inbound',
    partnerType: 'customer',
    partnerId: 'customer',
    journalId: bankJournalId,
    destinationAccountId: accountId('1311'),
    amount: '120',
    reconcileLineId: receivableLineId,
  })
  assert.equal((await call<Row>('account.getMove', { id: 'invoice-1' })).value.paymentState, 'paid')
  assert.deepEqual((await call<Row[]>('account.listOpenItems', { partnerId: 'customer' })).value, [])

  const trial = (await call<Row[]>('account.trialBalance')).value
  assert.equal(
    trial.reduce((sum, row) => sum + Number(row.debit), 0),
    440,
  )
  assert.equal(
    trial.reduce((sum, row) => sum + Number(row.credit), 0),
    440,
  )
  assert.ok((await call<Row[]>('account.generalLedger', { accountId: accountId('1311') })).value.length >= 3)

  const pages: Array<[string, RegExp]> = [
    ['/admin/accounting', /Tổng quan kế toán/],
    ['/admin/accounts', /Hệ thống tài khoản/],
    ['/admin/journals', /Sổ nhật ký/],
    ['/admin/taxes', /Thuế/],
    ['/admin/payment-terms', /name="paymentId"/],
    ['/admin/journal-entries', /Bút toán/],
    ['/admin/customer-invoices', /Hoá đơn khách hàng/],
    ['/admin/vendor-bills', /Hoá đơn nhà cung cấp/],
    ['/admin/customer-invoices/invoice-1', /SAL\/2026\/00001/],
    ['/admin/payments', /Thanh toán/],
    ['/admin/trial-balance', /Bảng cân đối thử/],
    ['/admin/general-ledger', /Sổ cái/],
    ['/admin/partner-statement?partnerId=customer', /Sổ đối tác/],
  ]
  for (const [path, expected] of pages) {
    const response = await e2e.client.get(path, { headers: { accept: 'text/html' } })
    const html = await response.text()
    assert.equal(response.status, 200, `${path}: ${html}`)
    assert.match(html, expected, path)
    assert.doesNotMatch(html, /account_backend\.[A-Za-z]/, path)
    if (path === '/admin/customer-invoices/invoice-1') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /data-ui="record-aside"/)
      assert.match(html, /data-island="mail\.chatter"/)
      assert.match(html, /data-island="activity\.record"/)
    }
    if (path === '/admin/accounting') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /Nghiệp vụ hằng ngày/)
      assert.match(html, /Báo cáo tài chính/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/vendor-bills') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="vendor-bill-create-form"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/customer-invoices') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="customer-invoice-create-form"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/journal-entries') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="journal-entry-create-form"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/payments') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="payment-register-form"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/accounts') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="account-create-form"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/journals') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="journal-create-form"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/taxes') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="tax-create-form"/)
      assert.match(html, /Số tiền \/ tỷ lệ/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/payment-terms') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="payment-term-create-form"/)
      assert.match(html, /id="payment-term-line-form"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/trial-balance') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="trial-balance-filter-form"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/general-ledger') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="general-ledger-filter-form"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path.startsWith('/admin/partner-statement')) {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="partner-ledger-filter-form"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
  }

  const english = await e2e.client.get('/admin/accounts?lang=en', {
    headers: { accept: 'text/html' },
  })
  assert.equal(english.status, 200)
  assert.match(await english.text(), /Chart of accounts/)
})
