import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import { seedAccountingTestFixture } from './accounting-test-fixture.ts'

const bootInvoices = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => app.fixture.call(name, input, { scope })

  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await seedAccountingTestFixture(fixture)
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  return app
}

test('customer invoice HTTP separates filtered ListPage from the stable full FormPage', async (t) => {
  const app = await bootInvoices(t)
  const path = '/admin/accounting/customer-invoices'
  await app.client.get(`${path}?lang=vi`)
  await app.client.call('partner.savePartner', {
    id: 'customer-http',
    kind: 'company',
    name: 'Khách hàng HTTP',
  })
  const journals = (await app.client.call<Row[]>('account.listJournals', {})).value
  const saleJournalId = String(journals.find((row) => row.type === 'sale')?.id)
  await app.client.call('account.createInvoice', {
    id: 'invoice-search-http',
    journalId: saleJournalId,
    moveType: 'out_invoice',
    partnerId: 'customer-http',
    ref: 'NEEDLE-INVOICE',
    description: 'Dịch vụ HTTP',
    quantity: '1',
    priceUnit: '100000',
  })

  const list = await app.client.get(
    `${path}?lang=vi&state=draft&payment=not_paid&type=out_invoice&q=Kh%C3%A1ch+h%C3%A0ng+HTTP`,
  )
  const listHtml = await list.text()
  assert.equal(list.status, 200)
  assert.match(listHtml, /data-ui="list-page"/)
  assert.match(listHtml, /Khách hàng HTTP/)
  assert.match(
    listHtml,
    /data-row-href="\/admin\/accounting\/customer-invoices\/invoice-search-http\?lang=vi"/,
  )
  assert.match(listHtml, /data-ui="facet"[\s\S]*?Nháp/)
  assert.match(listHtml, /data-ui="facet"[\s\S]*?Chưa thanh toán/)
  assert.match(listHtml, /href="\/admin\/accounting\/customer-invoices\/new\?lang=vi&amp;returnTo=/)
  assert.doesNotMatch(listHtml, /id="customer-invoice-create-form"|data-ui="modal-layer"|mail\.chatter/)

  const createHref = `${path}/new?lang=vi&returnTo=${encodeURIComponent(
    `${path}?lang=vi&state=draft&payment=not_paid&type=out_invoice&q=Kh%C3%A1ch+h%C3%A0ng+HTTP`,
  )}`
  const create = await app.client.get(createHref)
  const createHtml = await create.text()
  assert.equal(create.status, 200)
  assert.match(createHtml, /data-ui="form-page" data-scope="account-customer-invoice-form-page"/)
  assert.match(createHtml, /id="customer-invoice-create-form"/)
  for (const name of [
    'journalId',
    'moveType',
    'partnerId',
    'invoiceDate',
    'paymentTermId',
    'ref',
    'description',
    'productId',
    'productUomId',
    'quantity',
    'priceUnit',
    'discount',
    'lineAccountId',
    'counterpartAccountId',
    'taxId',
    'secondTaxId',
    'taxAccountId',
  ])
    assert.match(createHtml, new RegExp(`name="${name}"`), `missing ${name}`)
  assert.equal((createHtml.match(/data-island="backend\.relation-select"/g) ?? []).length, 4)
  assert.match(createHtml, /type="hidden" name="id" value="[^"]+"/)
  assert.match(createHtml, /href="\/admin\/accounting\/customer-invoices\?lang=vi&amp;state=draft/)
  assert.doesNotMatch(createHtml, /data-ui="list-page"|data-ui="modal-layer"|mail\.chatter/)

  const unsafe = await (await app.client.get(`${path}/new?lang=en&returnTo=https://evil.example/`)).text()
  assert.match(unsafe, /href="\/admin\/accounting\/customer-invoices\?lang=en"/)
  assert.doesNotMatch(unsafe, /evil\.example/)

  const unsupported = await app.client.request(`${path}/new?lang=vi`, { method: 'PUT' })
  assert.equal(unsupported.status, 405)
  for (const target of [path, `${path}/new`]) {
    const crossSite = await app.client.post(
      `${target}?lang=vi`,
      new URLSearchParams({ id: 'cross-site-invoice', journalId: saleJournalId }),
      {
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'https://cross-site.example',
        },
        redirect: 'manual',
      },
    )
    assert.equal(crossSite.status, 403)
  }
})

test('customer invoice POST preserves the full rejected document and retries idempotently', async (t) => {
  const app = await bootInvoices(t)
  const path = '/admin/accounting/customer-invoices'
  await app.client.get(`${path}?lang=vi`)
  await app.client.call('partner.savePartner', {
    id: 'customer-retry',
    kind: 'company',
    name: 'Khách hàng Retry',
  })
  const journals = (await app.client.call<Row[]>('account.listJournals', {})).value
  const saleJournalId = String(journals.find((row) => row.type === 'sale')?.id)
  const terms = (await app.client.call<Row[]>('account.listPaymentTerms', {})).value
  const paymentTermId = String(terms[0]?.id)

  const rejected = await app.client.post(
    `${path}/new?lang=vi&returnTo=${encodeURIComponent(`${path}?lang=vi&state=draft`)}`,
    new URLSearchParams({
      id: 'invoice-retry-token',
      journalId: saleJournalId,
      moveType: 'out_invoice',
      partnerId: 'customer-retry',
      invoiceDate: '2026-08-27',
      paymentTermId,
      ref: 'Giá trị nhập dở',
      description: 'Dịch vụ nhập dở',
      quantity: '2',
      priceUnit: '150000',
      discount: '5',
      lineAccountId: 'missing-income-account',
      counterpartAccountId: '',
      taxAccountId: '',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  const rejectedHtml = await rejected.text()
  assert.equal(rejected.status, 200)
  assert.match(rejectedHtml, /data-ui="form-page"/)
  assert.match(rejectedHtml, /data-ui="form-errors" role="alert"/)
  assert.match(rejectedHtml, /type="hidden" name="id" value="invoice-retry-token"/)
  assert.match(rejectedHtml, /name="invoiceDate"[^>]*value="2026-08-27"/)
  assert.match(rejectedHtml, /name="ref"[^>]*value="Giá trị nhập dở"/)
  assert.match(rejectedHtml, /name="description"[^>]*value="Dịch vụ nhập dở"/)
  assert.match(rejectedHtml, /name="quantity"[^>]*value="2"/)
  assert.match(rejectedHtml, /name="priceUnit"[^>]*value="150000"/)
  assert.match(rejectedHtml, /&quot;value&quot;:&quot;customer-retry&quot;/)
  assert.match(rejectedHtml, /&quot;value&quot;:&quot;missing-income-account&quot;/)
  assert.match(rejectedHtml, /href="\/admin\/accounting\/customer-invoices\?lang=vi&amp;state=draft"/)

  const body = new URLSearchParams({
    id: 'invoice-retry-token',
    journalId: saleJournalId,
    moveType: 'out_invoice',
    partnerId: 'customer-retry',
    invoiceDate: '2026-08-27',
    paymentTermId,
    ref: 'Hoá đơn retry',
    description: 'Dịch vụ hoàn chỉnh',
    quantity: '2',
    priceUnit: '150000',
    discount: '5',
  })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const saved = await app.client.post(`${path}/new?lang=en`, body, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    })
    assert.equal(saved.status, 303)
    assert.equal(saved.headers.get('location'), `${path}/invoice-retry-token?lang=en`)
  }
  const invoices = (
    await app.client.call<Row[]>('account.listMoves', {
      moveTypes: ['out_invoice', 'out_refund', 'out_receipt'],
    })
  ).value
  assert.equal(invoices.filter((row) => row.id === 'invoice-retry-token').length, 1)
  assert.equal(invoices.find((row) => row.id === 'invoice-retry-token')?.ref, 'Hoá đơn retry')

  const legacy = await app.client.post(
    `${path}?lang=vi`,
    new URLSearchParams({
      id: 'invoice-legacy-post',
      journalId: saleJournalId,
      moveType: 'out_invoice',
      partnerId: 'customer-retry',
      description: 'Legacy collection POST',
      quantity: '1',
      priceUnit: '1000',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(legacy.status, 303)
  assert.equal(legacy.headers.get('location'), `${path}/invoice-legacy-post?lang=vi`)
})
