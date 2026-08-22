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
    ['/admin/accounting/accounts', /Hệ thống tài khoản/],
    ['/admin/accounting/journals', /Sổ nhật ký/],
    ['/admin/accounting/taxes', /Thuế/],
    ['/admin/accounting/terms', /name="paymentId"/],
    ['/admin/accounting/entries', /Bút toán/],
    ['/admin/accounting/customer-invoices', /Hoá đơn khách hàng/],
    ['/admin/accounting/vendor-bills', /Hoá đơn nhà cung cấp/],
    ['/admin/accounting/customer-invoices/invoice-1', /SAL\/2026\/00001/],
    ['/admin/accounting/payments', /Thanh toán/],
    ['/admin/accounting/trial-balance', /Bảng cân đối thử/],
    ['/admin/accounting/general-ledger', /Sổ cái/],
    ['/admin/accounting/partner-statement?partnerId=customer', /Sổ đối tác/],
  ]
  for (const [path, expected] of pages) {
    const response = await e2e.client.get(path, { headers: { accept: 'text/html' } })
    const html = await response.text()
    assert.equal(response.status, 200, `${path}: ${html}`)
    assert.match(html, expected, path)
    assert.doesNotMatch(html, /account_backend\.[A-Za-z]/, path)
    if (path === '/admin/accounting/customer-invoices/invoice-1') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /data-ui="record-aside"/)
      assert.match(html, /data-island="mail\.chatter"/)
      assert.match(html, /data-island="activity\.record"/)
    }
    // Every field that names an account reaches the whole chart — over two hundred
    // rows once the TT99 pack is installed — so each is a picker with a search
    // dialog rather than a select the reader scrolls.
    if (
      [
        '/admin/accounting/customer-invoices',
        '/admin/accounting/vendor-bills',
        '/admin/accounting/journals',
        '/admin/accounting/taxes',
        '/admin/accounting/payments',
        '/admin/accounting/general-ledger',
      ].includes(path)
    ) {
      assert.match(html, /data-island="backend\.relation-select"/, path)
      assert.match(html, /&quot;listFunction&quot;:&quot;account\.listAccounts&quot;/, path)
    }
    if (path === '/admin/accounting') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /Nghiệp vụ hằng ngày/)
      assert.match(html, /Báo cáo tài chính/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/accounting/vendor-bills') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="vendor-bill-create-form"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/accounting/customer-invoices') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="customer-invoice-create-form"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/accounting/entries') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="journal-entry-create-form"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/accounting/payments') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="payment-register-form"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/accounting/accounts') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="account-create-form"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/accounting/journals') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="journal-create-form"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/accounting/taxes') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="tax-create-form"/)
      assert.match(html, /Số tiền \/ tỷ lệ/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/accounting/terms') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="payment-term-create-form"/)
      assert.match(html, /id="payment-term-line-form"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/accounting/trial-balance') {
      assert.match(html, /data-ui="record-workspace"/)
      // the range filter is `DatePicker`, which owns its own GET form
      assert.match(html, /data-ui="date-picker" method="get"/)
      assert.match(html, /data-ui="date-picker-control"[^>]*name="dateFrom"/)
      assert.match(html, /data-ui="date-picker-control"[^>]*name="dateTo"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/accounting/general-ledger') {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="general-ledger-filter-form"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path.startsWith('/admin/accounting/partner-statement')) {
      assert.match(html, /data-ui="record-workspace"/)
      assert.match(html, /id="partner-ledger-filter-form"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
  }

  const english = await e2e.client.get('/admin/accounting/accounts?lang=en', {
    headers: { accept: 'text/html' },
  })
  assert.equal(english.status, 200)
  const englishHtml = await english.text()
  assert.match(englishHtml, /Chart of accounts/)
  // The statutory chart reads in the reader's language, not only in Vietnamese.
  assert.match(englishHtml, /Cash/)
  assert.doesNotMatch(englishHtml, /Tiền mặt/)
})

test('e2e accounting: a chart entry is corrected in place, and archived out of the pickers', async (t) => {
  const { e2e, call } = await bootAccounting(t)
  const accounts = (await call<Row[]>('account.listAccounts')).value
  const target = accounts.find((row) => row.code === '111')!
  const path = '/admin/accounting/accounts'

  // The list is also the editor: following a row prefills the form with that row.
  const editor = await e2e.client.get(`${path}?edit=${encodeURIComponent(String(target.id))}`, {
    headers: { accept: 'text/html' },
  })
  const editorHtml = await editor.text()
  assert.equal(editor.status, 200)
  assert.match(editorHtml, /Sửa tài khoản/)
  assert.match(editorHtml, /value="111"/)

  const save = await e2e.client.post(
    `${path}?edit=${encodeURIComponent(String(target.id))}`,
    new URLSearchParams({ code: '111', name: 'Tiền mặt tại quỹ', accountType: 'asset_cash', active: '1' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(save.status, 303)
  const corrected = (await call<Row[]>('account.listAccounts')).value
  assert.equal(corrected.find((row) => row.id === target.id)!.name, 'Tiền mặt tại quỹ')
  // Corrected in place — not duplicated into a second row nobody can remove.
  assert.equal(corrected.filter((row) => row.code === '111').length, 1)
  assert.equal(corrected.length, accounts.length)

  const archive = await e2e.client.post(
    `${path}?edit=${encodeURIComponent(String(target.id))}`,
    new URLSearchParams({ code: '111', name: 'Tiền mặt tại quỹ', accountType: 'asset_cash' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(archive.status, 303)
  const live = (await call<Row[]>('account.listAccounts')).value
  assert.equal(
    live.some((row) => row.id === target.id),
    false,
  )
  assert.equal(
    (await call<Row[]>('account.listAccounts', { includeArchived: true })).value.some(
      (row) => row.id === target.id,
    ),
    true,
  )
})

test('e2e accounting: a posted document is corrected by a reversal reached from its own screen', async (t) => {
  const { e2e, call } = await bootAccounting(t)
  await call('partner.savePartner', { id: 'customer', kind: 'company', name: 'Khách hàng ABC' })
  const accounts = (await call<Row[]>('account.listAccounts')).value
  const journals = (await call<Row[]>('account.listJournals')).value
  const accountId = (code: string) => String(accounts.find((row) => row.code === code)?.id)

  await call('account.createInvoice', {
    id: 'invoice-9',
    journalId: String(journals.find((row) => row.type === 'sale')?.id),
    moveType: 'out_invoice',
    partnerId: 'customer',
    description: 'Ghi nhầm',
    quantity: '1',
    priceUnit: '750000',
    lineAccountId: accountId('511'),
    counterpartAccountId: accountId('1311'),
  })
  await call('account.postMove', { id: 'invoice-9' })

  const detail = await e2e.client.get('/admin/accounting/customer-invoices/invoice-9', {
    headers: { accept: 'text/html' },
  })
  const html = await detail.text()
  assert.equal(detail.status, 200)
  // A posted document offers the correction, not a delete.
  assert.match(html, /Đảo bút toán/)
  assert.match(html, /name="action" value="reverse"/)

  const reversed = await e2e.client.post(
    '/admin/accounting/customer-invoices/invoice-9',
    new URLSearchParams({ action: 'reverse' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(reversed.status, 303)
  // The reversal is a journal entry of its own, and the reader lands on it.
  assert.match(String(reversed.headers.get('location')), /^\/admin\/accounting\/entries\//)

  assert.equal((await call<Row>('account.getMove', { id: 'invoice-9' })).value.paymentState, 'reversed')
  assert.deepEqual((await call<Row[]>('account.listOpenItems', { partnerId: 'customer' })).value, [])
  assert.equal(
    (await call<Row[]>('account.trialBalance')).value.reduce((sum, row) => sum + Number(row.balance), 0),
    0,
  )
})
