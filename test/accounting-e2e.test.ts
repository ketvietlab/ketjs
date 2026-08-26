import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

async function bootAccounting(t: TestContext) {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
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
      // The overview reports the ledger now; the card grid that used to be here
      // only counted the lists the sidebar already links to.
      assert.match(html, /Chỉ số chính/)
      assert.match(html, /Doanh thu thuần/)
      assert.match(html, /Tổng nợ phải trả/)
      assert.match(html, /data-ui="delta"/)
      assert.match(html, /data-island="backend\.chart"/)
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

test('e2e accounting: a refused form says which rule it broke and keeps what was typed', async (t) => {
  const { e2e, call } = await bootAccounting(t)
  await call('partner.savePartner', { id: 'supplier', kind: 'company', name: 'Nhà cung cấp ABC' })
  const accounts = (await call<Row[]>('account.listAccounts')).value
  const journals = (await call<Row[]>('account.listJournals')).value
  const receivable = String(accounts.find((row) => row.code === '1311')?.id)

  const form = new URLSearchParams({
    name: 'PAY/CHI/001',
    paymentType: 'outbound',
    // A supplier payment must settle a payable, so a receivable is the wrong one.
    partnerType: 'supplier',
    partnerId: 'supplier',
    journalId: String(journals.find((row) => row.type === 'bank')?.id),
    destinationAccountId: receivable,
    amount: '750000',
    memo: 'Thanh toán đợt 1',
  })
  const refused = await e2e.client.post('/admin/accounting/payments?lang=vi', form, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  const html = await refused.text()
  // The form comes back rendered, not a redirect to a page that says only "invalid".
  assert.equal(refused.status, 200)
  assert.doesNotMatch(html, /invalid=1/)
  // The reason names the rule, in the reader's language.
  assert.match(html, /phải tất toán một tài khoản phải trả/)
  assert.doesNotMatch(html, /account\.error\./)
  // Everything typed is still there, so the correction is one control away.
  assert.match(html, /value="PAY\/CHI\/001"/)
  assert.match(html, /value="750000"/)
  assert.match(html, /value="Thanh toán đợt 1"/)
  // Nothing was written.
  assert.deepEqual((await call<Row[]>('account.listPayments')).value, [])
})

test('e2e accounting: a payment can only be pointed at an account it could settle', async (t) => {
  const { e2e, call } = await bootAccounting(t)
  const accounts = (await call<Row[]>('account.listAccounts')).value
  const response = await e2e.client.get('/admin/accounting/payments?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const html = await response.text()
  const options = [...html.matchAll(/<select[^>]*name="destinationAccountId"[^>]*>([\s\S]*?)<\/select>/g)]
    .flatMap((match) => [...match[1]!.matchAll(/value="([^"]*)"/g)])
    .map((match) => match[1]!)
    .filter(Boolean)
  assert.ok(options.length > 0)
  // Offering all 216 accounts made the default selection a guaranteed refusal.
  const offered = accounts.filter((row) => options.includes(String(row.id)))
  assert.equal(offered.length, options.length)
  assert.ok(
    offered.every((row) => ['asset_receivable', 'liability_payable'].includes(String(row.accountType))),
    offered.map((row) => `${String(row.code)}:${String(row.accountType)}`).join(', '),
  )
})

test('e2e accounting: the overview reports posted moves, and never a draft', async (t) => {
  const { e2e, call } = await bootAccounting(t)
  await call('partner.savePartner', { id: 'customer', kind: 'company', name: 'Khách hàng ABC' })
  const accounts = (await call<Row[]>('account.listAccounts')).value
  const journals = (await call<Row[]>('account.listJournals')).value
  const accountId = (code: string) => String(accounts.find((row) => row.code === code)?.id)
  const salesJournalId = String(journals.find((row) => row.type === 'sale')?.id)
  await call('account.createInvoice', {
    id: 'invoice-overview',
    journalId: salesJournalId,
    moveType: 'out_invoice',
    partnerId: 'customer',
    invoiceDate: '2026-06-10T00:00:00.000Z',
    description: 'Dịch vụ',
    quantity: '1',
    priceUnit: '100000',
    lineAccountId: accountId('511'),
    counterpartAccountId: accountId('1311'),
  })
  // A second document that is never posted. The card that used to be here
  // counted rows, so a draft moved it; this screen reports the ledger, and a
  // draft is not in the ledger.
  await call('account.createInvoice', {
    id: 'invoice-draft',
    journalId: salesJournalId,
    moveType: 'out_invoice',
    partnerId: 'customer',
    invoiceDate: '2026-06-12T00:00:00.000Z',
    description: 'Chưa ghi sổ',
    quantity: '1',
    priceUnit: '900000',
    lineAccountId: accountId('511'),
    counterpartAccountId: accountId('1311'),
  })

  const june = 'dateFrom=2026-06-01&dateTo=2026-06-30'
  const read = async (): Promise<string> =>
    (
      await (
        await e2e.client.get(`/admin/accounting?lang=vi&${june}`, { headers: { accept: 'text/html' } })
      ).text()
    ).replace(/<!--[^>]*-->/g, '')

  const metricNamed = (html: string, label: string): string => {
    const cards = [...html.matchAll(/<article data-ui="metric"[\s\S]*?<\/article>/g)].map((match) => match[0])
    const card = cards.find((held) => held.includes(label))
    assert.ok(card, label)
    return /data-ui="metric-value"[^>]*>([^<]*)</.exec(card)?.[1] ?? ''
  }
  const digits = (value: string): number => Number(value.replace(/[^0-9-]/g, ''))

  const drafted = await read()
  assert.equal(digits(metricNamed(drafted, 'Doanh thu thuần')), 0)

  await call('account.postMove', { id: 'invoice-overview' })
  const posted = await read()
  assert.match(posted, /data-ui="record-workspace"/)
  assert.doesNotMatch(posted, /data-ui="list-page"|data-ui="form-page"/)
  assert.match(posted, /data-ui="date-picker" method="get" action="\/admin\/accounting"/)
  assert.match(posted, /name="lang" value="vi"/)
  assert.equal(digits(metricNamed(posted, 'Doanh thu thuần')), 100000)
  // And the same number the trial balance reports over the same window.
  const trial = (
    await call<Row[]>('account.trialBalance', {
      dateFrom: '2026-06-01T00:00:00.000Z',
      dateTo: '2026-06-30T23:59:59.999Z',
    })
  ).value
  assert.equal(Number(trial.find((row) => row.code === '511')?.credit), 100000)
  // The expense breakdown links into the ledger behind each account, and the
  // window travels with it: a figure nobody can open is one to trust blindly.
  assert.match(posted, /data-island="backend\.chart"/)
  assert.doesNotMatch(posted, /data-island="mail\.chatter"/)
  assert.doesNotMatch(posted, /account_backend\.[A-Za-z]/)
})

test('e2e accounting: the ledger names the account, and a draft is not titled by its id', async (t) => {
  const { e2e, call } = await bootAccounting(t)
  await call('partner.savePartner', { id: 'customer', kind: 'company', name: 'Khách hàng ABC' })
  const accounts = (await call<Row[]>('account.listAccounts')).value
  const journals = (await call<Row[]>('account.listJournals')).value
  const accountId = (code: string) => String(accounts.find((row) => row.code === code)?.id)
  await call('account.createInvoice', {
    id: 'invoice-ledger',
    journalId: String(journals.find((row) => row.type === 'sale')?.id),
    moveType: 'out_invoice',
    partnerId: 'customer',
    description: 'Dịch vụ',
    quantity: '1',
    priceUnit: '100000',
    lineAccountId: accountId('511'),
    counterpartAccountId: accountId('1311'),
  })
  await call('account.postMove', { id: 'invoice-ledger' })
  await call('account.createMove', {
    id: 'draft-ledger',
    journalId: String(journals.find((row) => row.type === 'general')?.id),
    moveType: 'entry',
  })

  // A general ledger with no account column is a list of amounts.
  const ledger = await (
    await e2e.client.get('/admin/accounting/general-ledger?lang=vi', { headers: { accept: 'text/html' } })
  ).text()
  assert.match(ledger, /511 · Doanh thu/)
  assert.match(ledger, /1311 · Phải thu/)

  // A draft carries no journal number yet, so `name` still holds its raw id. The
  // id belongs in the link, never in what the reader is shown.
  const entries = (
    await (
      await e2e.client.get('/admin/accounting/entries?lang=vi', { headers: { accept: 'text/html' } })
    ).text()
  ).replace(/<!--[^>]*-->/g, '')
  assert.match(entries, /Bút toán nháp/)
  assert.match(entries, /href="\/admin\/accounting\/entries\/draft-ledger/)
  assert.doesNotMatch(entries, />[^<]*draft-ledger[^<]*</)

  const detail = (
    await (
      await e2e.client.get('/admin/accounting/entries/draft-ledger?lang=vi', {
        headers: { accept: 'text/html' },
      })
    ).text()
  ).replace(/<!--[^>]*-->/g, '')
  assert.match(detail, /Bút toán nháp/)
  assert.doesNotMatch(detail, />[^<]*draft-ledger[^<]*</)
  // A manual entry has no payment state, so it must not claim to be paid.
  assert.doesNotMatch(detail, /Đã thanh toán/)
})

test('e2e accounting: a payment term shows the milestones that define it, and they are editable', async (t) => {
  const { e2e, call } = await bootAccounting(t)
  const terms = (await call<Row[]>('account.listPaymentTerms')).value
  const net30 = terms.find((row) => row.name === '30 ngày')!
  const line = (net30.lines as Row[])[0]!

  const listed = await (
    await e2e.client.get('/admin/accounting/terms?lang=vi', { headers: { accept: 'text/html' } })
  ).text()
  // Counting the milestones and hiding them left the screen unable to say what
  // "30 ngày" actually means.
  assert.match(listed, /Số ngày sau ngày hoá đơn/)
  assert.match(listed, new RegExp(`editLine=${encodeURIComponent(String(line.id)).replace(/%/g, '%')}`))

  const editing = await (
    await e2e.client.get(`/admin/accounting/terms?lang=vi&editLine=${encodeURIComponent(String(line.id))}`, {
      headers: { accept: 'text/html' },
    })
  ).text()
  assert.match(editing, /Sửa mốc đến hạn/)
  assert.match(editing, /value="30"/)

  const saved = await e2e.client.post(
    `/admin/accounting/terms?lang=vi&editLine=${encodeURIComponent(String(line.id))}`,
    new URLSearchParams({
      action: 'line',
      paymentId: String(net30.id),
      value: 'percent',
      valueAmount: '100',
      delayType: 'days_after',
      nbDays: '45',
      sequence: '10',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(saved.status, 303)
  const after = (await call<Row[]>('account.listPaymentTerms')).value.find((row) => row.id === net30.id)!
  // Corrected in place, not duplicated into a second milestone.
  assert.equal((after.lines as Row[]).length, 1)
  assert.equal(Number((after.lines as Row[])[0]!.nbDays), 45)
})

test('e2e accounting: a figure on a report opens the rows that produced it', async (t) => {
  const { e2e, call } = await bootAccounting(t)
  await call('partner.savePartner', { id: 'customer', kind: 'company', name: 'Khách hàng ABC' })
  const accounts = (await call<Row[]>('account.listAccounts')).value
  const idOf = (code: string) => String(accounts.find((row) => row.code === code)?.id)
  await call('account.createInvoice', {
    id: 'invoice-drill',
    journalId: String(
      (await call<Row[]>('account.listJournals')).value.find((row) => row.type === 'sale')?.id,
    ),
    moveType: 'out_invoice',
    partnerId: 'customer',
    description: 'Dịch vụ',
    quantity: '1',
    priceUnit: '1000000',
  })
  await call('account.postMove', { id: 'invoice-drill' })
  await call('account.registerPayment', {
    id: 'payment-drill',
    name: 'PAY/1',
    paymentType: 'inbound',
    partnerType: 'customer',
    partnerId: 'customer',
    journalId: String(
      (await call<Row[]>('account.listJournals')).value.find((row) => row.type === 'bank')?.id,
    ),
    destinationAccountId: idOf('1311'),
    amount: '400000',
  })

  // A total nobody can open is a number to trust blindly. The balance carries its
  // own date window into the ledger.
  const trial = await (
    await e2e.client.get('/admin/accounting/trial-balance?lang=vi&dateFrom=2026-01-01', {
      headers: { accept: 'text/html' },
    })
  ).text()
  assert.match(
    trial,
    new RegExp(`href="/admin/accounting/general-ledger\\?accountId=${encodeURIComponent(idOf('1311'))}`),
  )
  assert.match(trial, /dateFrom=2026-01-01/)

  // A payment reaches the journal entry it wrote.
  const payments = await (
    await e2e.client.get('/admin/accounting/payments?lang=vi', { headers: { accept: 'text/html' } })
  ).text()
  assert.match(payments, /href="\/admin\/accounting\/entries\/payment-drill%3Amove/)

  // So does a line on the partner ledger.
  const ledger = await (
    await e2e.client.get('/admin/accounting/partner-statement?lang=vi&partnerId=customer', {
      headers: { accept: 'text/html' },
    })
  ).text()
  assert.match(ledger, /href="\/admin\/accounting\/entries\/invoice-drill/)
})

test('e2e accounting: an invoice form no longer asks which accounts to post to', async (t) => {
  const { e2e, call } = await bootAccounting(t)
  await call('partner.savePartner', { id: 'customer', kind: 'company', name: 'Khách hàng ABC' })

  // The install decides the statutory answer once, so the company starts configured.
  const defaults = (await call<Row>('account.getDefaults')).value
  const accounts = (await call<Row[]>('account.listAccounts')).value
  const codeOf = (id: unknown) => String(accounts.find((row) => String(row.id) === String(id))?.code)
  assert.equal(codeOf(defaults.incomeAccountId), '511')
  assert.equal(codeOf(defaults.receivableAccountId), '1311')

  // Neither account field is required, and each says where its value comes from.
  const form = await (
    await e2e.client.get('/admin/accounting/customer-invoices?lang=vi', {
      headers: { accept: 'text/html' },
    })
  ).text()
  const required = (name: string) =>
    new RegExp(`name="${name}"[^>]*\\srequired`).test(form.replace(/<!--[^>]*-->/g, ''))
  assert.equal(required('lineAccountId'), false)
  assert.equal(required('counterpartAccountId'), false)
  assert.match(form, /Để trống để lấy theo nhóm sản phẩm/)

  // Posting the form without them produces a complete, balanced invoice.
  const created = await e2e.client.post(
    '/admin/accounting/customer-invoices?lang=vi',
    new URLSearchParams({
      journalId: String(
        (await call<Row[]>('account.listJournals')).value.find((row) => row.type === 'sale')?.id,
      ),
      moveType: 'out_invoice',
      partnerId: 'customer',
      description: 'Dịch vụ',
      quantity: '1',
      priceUnit: '1000000',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(created.status, 303)
  const id = String(created.headers.get('location')).split('/').pop()?.split('?')[0]
  const invoice = (await call<Row>('account.getMove', { id })).value as Row & { lines: Row[] }
  assert.equal(codeOf(invoice.lines.find((row) => String(row.id).endsWith(':base'))?.accountId), '511')
  assert.equal(
    codeOf(invoice.lines.find((row) => String(row.id).endsWith(':counterpart'))?.accountId),
    '1311',
  )
})

test('e2e accounting: a product category posts to the accounts it was given', async (t) => {
  const { e2e, call } = await bootAccounting(t)
  await call('partner.savePartner', { id: 'customer', kind: 'company', name: 'Khách hàng ABC' })
  const accounts = (await call<Row[]>('account.listAccounts')).value
  const idOf = (code: string) => String(accounts.find((row) => row.code === code)?.id)
  await call('product.saveCategory', { id: 'services', name: 'Dịch vụ' })

  const saved = await e2e.client.post(
    '/admin/accounting/defaults?lang=vi',
    new URLSearchParams({ action: 'category', categoryId: 'services', incomeAccountId: idOf('515') }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(saved.status, 303)

  const screen = await (
    await e2e.client.get('/admin/accounting/defaults?lang=vi', { headers: { accept: 'text/html' } })
  ).text()
  assert.match(screen, /Dịch vụ/)
  assert.match(screen, /515 · Doanh thu hoạt động tài chính/)

  await call('product.saveTemplate', {
    id: 'consulting',
    name: 'Tư vấn',
    type: 'service',
    categoryId: 'services',
    listPrice: '0',
  })
  await call('product.saveVariant', { id: 'consulting-1', templateId: 'consulting' })
  await call('account.createInvoice', {
    id: 'invoice-category',
    journalId: String(
      (await call<Row[]>('account.listJournals')).value.find((row) => row.type === 'sale')?.id,
    ),
    moveType: 'out_invoice',
    partnerId: 'customer',
    productId: 'consulting-1',
    description: 'Tư vấn',
    quantity: '1',
    priceUnit: '1000000',
  })
  const invoice = (await call<Row>('account.getMove', { id: 'invoice-category' })).value as Row & {
    lines: Row[]
  }
  // The category is narrower than the company, so it decides the revenue account.
  assert.equal(invoice.lines.find((row) => String(row.id).endsWith(':base'))?.accountId, idOf('515'))
  assert.equal(invoice.lines.find((row) => String(row.id).endsWith(':counterpart'))?.accountId, idOf('1311'))
})
