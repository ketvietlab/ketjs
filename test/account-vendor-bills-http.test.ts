import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const bootBills = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => app.fixture.call(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
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

test('vendor bill HTTP separates filtered ListPage from the stable full FormPage', async (t) => {
  const app = await bootBills(t)
  const path = '/admin/accounting/vendor-bills'
  await app.client.get(`${path}?lang=vi`)
  await app.client.call('partner.savePartner', {
    id: 'vendor-http',
    kind: 'company',
    name: 'Nhà cung cấp HTTP',
  })
  const journals = (await app.client.call<Row[]>('account.listJournals', {})).value
  const purchaseJournalId = String(journals.find((row) => row.type === 'purchase')?.id)
  await app.client.call('account.createInvoice', {
    id: 'bill-search-http',
    journalId: purchaseJournalId,
    moveType: 'in_invoice',
    partnerId: 'vendor-http',
    ref: 'NEEDLE-BILL',
    description: 'Chi phí HTTP',
    quantity: '1',
    priceUnit: '100000',
  })

  const list = await app.client.get(
    `${path}?lang=vi&state=draft&payment=not_paid&type=in_invoice&q=Nh%C3%A0+cung+c%E1%BA%A5p+HTTP`,
  )
  const listHtml = await list.text()
  assert.equal(list.status, 200)
  assert.match(listHtml, /data-ui="list-page"/)
  assert.match(listHtml, /Nhà cung cấp HTTP/)
  assert.match(listHtml, /data-row-href="\/admin\/accounting\/vendor-bills\/bill-search-http\?lang=vi"/)
  assert.match(listHtml, /data-ui="facet"[\s\S]*?Nháp/)
  assert.match(listHtml, /data-ui="facet"[\s\S]*?Chưa thanh toán/)
  assert.match(listHtml, /href="\/admin\/accounting\/vendor-bills\/new\?lang=vi&amp;returnTo=/)
  assert.doesNotMatch(listHtml, /id="vendor-bill-create-form"|data-ui="modal-layer"|mail\.chatter/)

  const returnTo = `${path}?lang=vi&state=draft&payment=not_paid&type=in_invoice&q=Nh%C3%A0+cung+c%E1%BA%A5p+HTTP`
  const create = await app.client.get(`${path}/new?lang=vi&returnTo=${encodeURIComponent(returnTo)}`)
  const createHtml = await create.text()
  assert.equal(create.status, 200)
  assert.match(createHtml, /data-ui="form-page" data-scope="account-vendor-bill-form-page"/)
  assert.match(createHtml, /id="vendor-bill-create-form"/)
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
  assert.match(createHtml, /href="\/admin\/accounting\/vendor-bills\?lang=vi&amp;state=draft/)
  assert.doesNotMatch(createHtml, /data-ui="list-page"|data-ui="modal-layer"|mail\.chatter/)

  const unsafe = await (await app.client.get(`${path}/new?lang=en&returnTo=https://evil.example/`)).text()
  assert.match(unsafe, /href="\/admin\/accounting\/vendor-bills\?lang=en"/)
  assert.doesNotMatch(unsafe, /evil\.example/)
  assert.equal((await app.client.request(`${path}/new`, { method: 'PUT' })).status, 405)
  for (const target of [path, `${path}/new`]) {
    const crossSite = await app.client.post(
      target,
      new URLSearchParams({ id: 'cross-site-bill', journalId: purchaseJournalId }),
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

test('vendor bill POST preserves rejected relations and retries the same record identity', async (t) => {
  const app = await bootBills(t)
  const path = '/admin/accounting/vendor-bills'
  await app.client.get(`${path}?lang=vi`)
  await app.client.call('partner.savePartner', {
    id: 'vendor-retry',
    kind: 'company',
    name: 'Nhà cung cấp Retry',
  })
  const journals = (await app.client.call<Row[]>('account.listJournals', {})).value
  const purchaseJournalId = String(journals.find((row) => row.type === 'purchase')?.id)
  const terms = (await app.client.call<Row[]>('account.listPaymentTerms', {})).value
  const paymentTermId = String(terms[0]?.id)

  const rejected = await app.client.post(
    `${path}/new?lang=vi&returnTo=${encodeURIComponent(`${path}?lang=vi&state=draft`)}`,
    new URLSearchParams({
      id: 'bill-retry-token',
      journalId: purchaseJournalId,
      moveType: 'in_invoice',
      partnerId: 'vendor-retry',
      invoiceDate: '2026-08-27',
      paymentTermId,
      ref: 'Chứng từ nhập dở',
      description: 'Chi phí nhập dở',
      quantity: '2',
      priceUnit: '150000',
      discount: '5',
      lineAccountId: 'missing-expense-account',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  const rejectedHtml = await rejected.text()
  assert.equal(rejected.status, 200)
  assert.match(rejectedHtml, /data-ui="form-page"/)
  assert.match(rejectedHtml, /data-ui="form-errors" role="alert"/)
  assert.match(rejectedHtml, /type="hidden" name="id" value="bill-retry-token"/)
  assert.match(rejectedHtml, /name="invoiceDate"[^>]*value="2026-08-27"/)
  assert.match(rejectedHtml, /name="ref"[^>]*value="Chứng từ nhập dở"/)
  assert.match(rejectedHtml, /name="description"[^>]*value="Chi phí nhập dở"/)
  assert.match(rejectedHtml, /&quot;value&quot;:&quot;vendor-retry&quot;/)
  assert.match(rejectedHtml, /&quot;value&quot;:&quot;missing-expense-account&quot;/)
  assert.match(rejectedHtml, /href="\/admin\/accounting\/vendor-bills\?lang=vi&amp;state=draft"/)

  const body = new URLSearchParams({
    id: 'bill-retry-token',
    journalId: purchaseJournalId,
    moveType: 'in_invoice',
    partnerId: 'vendor-retry',
    invoiceDate: '2026-08-27',
    paymentTermId,
    ref: 'Hoá đơn mua retry',
    description: 'Chi phí hoàn chỉnh',
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
    assert.equal(saved.headers.get('location'), `${path}/bill-retry-token?lang=en`)
  }
  const bills = (
    await app.client.call<Row[]>('account.listMoves', {
      moveTypes: ['in_invoice', 'in_refund', 'in_receipt'],
    })
  ).value
  assert.equal(bills.filter((row) => row.id === 'bill-retry-token').length, 1)
  assert.equal(bills.find((row) => row.id === 'bill-retry-token')?.ref, 'Hoá đơn mua retry')

  const legacy = await app.client.post(
    `${path}?lang=vi`,
    new URLSearchParams({
      id: 'bill-legacy-post',
      journalId: purchaseJournalId,
      moveType: 'in_invoice',
      partnerId: 'vendor-retry',
      description: 'Legacy collection POST',
      quantity: '1',
      priceUnit: '1000',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(legacy.status, 303)
  assert.equal(legacy.headers.get('location'), `${path}/bill-legacy-post?lang=vi`)
})
