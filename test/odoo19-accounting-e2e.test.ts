import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from 'ketjs'
import { createTestApp } from 'ketjs/testing'
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

test('e2e accounting 19: invoice, payment reconciliation and reports cross real HTTP', async (t) => {
  const { e2e, call } = await bootAccounting(t)
  await call('partner.savePartner', { id: 'customer', kind: 'company', name: 'Khách hàng ABC' })
  for (const [id, code, name, accountType] of [
    ['receivable', '131', 'Phải thu', 'asset_receivable'],
    ['bank', '1121', 'Ngân hàng', 'asset_cash'],
    ['revenue', '5111', 'Doanh thu', 'income'],
    ['tax', '3331', 'Thuế GTGT', 'liability_current'],
  ])
    await call('account.saveAccount', { id, code, name, accountType })
  await call('account.saveJournal', {
    id: 'sales',
    name: 'Bán hàng',
    code: 'SAL',
    type: 'sale',
  })
  await call('account.saveJournal', {
    id: 'bank-journal',
    name: 'Ngân hàng',
    code: 'BNK',
    type: 'bank',
    defaultAccountId: 'bank',
  })
  await call('account.saveTax', {
    id: 'vat10',
    name: 'GTGT 10%',
    typeTaxUse: 'sale',
    amountType: 'percent',
    amount: '10',
  })
  await call('account.savePaymentTerm', { id: 'net30', name: '30 ngày' })
  await call('account.savePaymentTermLine', {
    id: 'net30:line',
    paymentId: 'net30',
    value: 'percent',
    valueAmount: '100',
    delayType: 'days_after',
    nbDays: 30,
  })

  const created = (
    await call<Row>('account.createInvoice', {
      id: 'invoice-1',
      journalId: 'sales',
      moveType: 'out_invoice',
      partnerId: 'customer',
      invoiceDate: '2026-08-20T00:00:00.000Z',
      paymentTermId: 'net30',
      ref: 'INV/DEMO',
      description: 'Dịch vụ triển khai',
      quantity: '2',
      priceUnit: '100',
      lineAccountId: 'revenue',
      counterpartAccountId: 'receivable',
      taxId: 'vat10',
      taxAccountId: 'tax',
    })
  ).value
  assert.deepEqual(created, { ok: true, id: 'invoice-1', amountTotal: '220' })
  assert.equal((await call<Row>('account.postMove', { id: 'invoice-1' })).value.name, 'SAL/2026/00001')

  const openItems = (await call<Row[]>('account.listOpenItems', { partnerId: 'customer' })).value
  assert.equal(openItems.length, 1)
  assert.equal(openItems[0]!.accountId, 'receivable')
  const receivableLineId = String(openItems[0]!.id)

  await call('account.registerPayment', {
    id: 'payment-1',
    name: 'PAY/1',
    paymentType: 'inbound',
    partnerType: 'customer',
    partnerId: 'customer',
    journalId: 'bank-journal',
    destinationAccountId: 'receivable',
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
    journalId: 'bank-journal',
    destinationAccountId: 'receivable',
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
  assert.ok((await call<Row[]>('account.generalLedger', { accountId: 'receivable' })).value.length >= 3)

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
  }

  const english = await e2e.client.get('/admin/accounts?lang=en', {
    headers: { accept: 'text/html' },
  })
  assert.equal(english.status, 200)
  assert.match(await english.text(), /Chart of accounts/)
})
