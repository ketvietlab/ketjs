import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

async function bootPartner(t: TestContext) {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input, { scope })
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
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  return {
    e2e,
    call: <T = unknown>(name: string, input: Record<string, unknown> = {}) => e2e.client.call<T>(name, input),
  }
}

test('partner-e2e: directory, defaults, roles and accounting bridge cross real HTTP', async (t) => {
  const { e2e, call } = await bootPartner(t)
  await call('partner.savePartner', {
    id: 'customer',
    kind: 'company',
    name: 'Công ty Minh An',
    vat: '0101234567',
    email: 'hello@minhan.example',
  })
  await call('partner.grantRole', { id: 'customer-role', partnerId: 'customer', role: 'customer' })
  await call('partner.saveAddress', {
    id: 'invoice-address',
    partnerId: 'customer',
    use: 'invoice',
    street: '12 Nguyễn Huệ',
    city: 'Thành phố Hồ Chí Minh',
    country: 'VN',
    isDefault: true,
  })
  await call('partner.saveTerms', { id: 'customer-terms', partnerId: 'customer', creditLimit: '50000000' })
  await call('account.saveAccount', {
    id: 'receivable',
    code: '131',
    name: 'Phải thu khách hàng',
    accountType: 'asset_receivable',
  })
  await call('account.saveAccount', {
    id: 'payable',
    code: '331',
    name: 'Phải trả nhà cung cấp',
    accountType: 'liability_payable',
  })
  await call('account.saveAccount', {
    id: 'bank',
    code: '1121',
    name: 'Ngân hàng',
    accountType: 'asset_cash',
  })
  await call('account.savePaymentTerm', { id: 'net30', name: '30 ngày' })
  const wrongAccount = (
    await call<Row>('account_partner.saveAccountingTerms', {
      id: 'wrong-accounting',
      partnerId: 'customer',
      receivableAccountId: 'bank',
    })
  ).value
  assert.equal(wrongAccount.ok, false)
  assert.match(JSON.stringify(wrongAccount.errors), /account_partner\.error\.accountType/)
  assert.deepEqual(
    (
      await call<Row>('account_partner.saveAccountingTerms', {
        id: 'customer-accounting',
        partnerId: 'customer',
        paymentTermId: 'net30',
        receivableAccountId: 'receivable',
        payableAccountId: 'payable',
      })
    ).value,
    { ok: true, id: 'customer-terms' },
  )

  const pages: Array<[string, RegExp]> = [
    ['/admin/partner/partners', /Công ty Minh An/],
    ['/admin/partner/partners?role=customer', /Khách hàng/],
    ['/admin/partner/partners/new', /Tạo đối tác/],
    ['/admin/partner/partners/customer', /partner-identity-form/],
    ['/admin/partner/partners/customer/accounting', /Phải thu khách hàng/],
  ]
  for (const [path, expected] of pages) {
    const response = await e2e.client.get(path, { headers: { accept: 'text/html' } })
    assert.equal(response.status, 200, path)
    const html = await response.text()
    assert.match(html, expected, path)
    assert.doesNotMatch(html, /(?:partner|account_partner)_backend\.[A-Za-z]/, path)
  }

  const partnerList = await (
    await e2e.client.get('/admin/partner/partners', { headers: { accept: 'text/html' } })
  ).text()
  assert.match(partnerList, /data-ui="topbar"/)
  assert.match(partnerList, /data-ui="chrome-create"[^>]*href="\/admin\/partner\/partners\/new"/)
  assert.match(partnerList, /data-ui="search-menu"/)
  assert.match(partnerList, /data-row-href="\/admin\/partner\/partners\/customer"/)
  assert.match(partnerList, /data-ui="partner-list-layout"/)
  assert.match(partnerList, /data-ui="partner-stat-grid"/)
  assert.doesNotMatch(partnerList, /data-ui="row-link"/, 'the partner name cell is plain text')
  assert.doesNotMatch(partnerList, /data-page-frame="true"/)
  for (const hiddenMenu of ['/admin/activities', '/admin/inbox', '/admin/outbox', '/admin/inbound-email']) {
    assert.doesNotMatch(
      partnerList,
      new RegExp(`data-ui="app-entry"[^>]+href="${hiddenMenu}"`),
      `${hiddenMenu} is opened outside the sidebar app list`,
    )
  }

  const partnerForm = await (await e2e.client.get('/admin/partner/partners/customer?lang=vi')).text()
  assert.match(partnerForm, /id="partner-identity-form"/)
  assert.match(partnerForm, /action="\/admin\/partner\/partners\/customer\?lang=vi"/)
  assert.match(partnerForm, /12 Nguyễn Huệ/)
  assert.doesNotMatch(partnerForm, /data-ui="partner-detail-layout"/)
  assert.doesNotMatch(partnerForm, /href="[^"]*\/edit/)
  assert.doesNotMatch(partnerForm, /href="[^"]*tab=(?:addresses|roles)/)

  const legacyEdit = await e2e.client.get('/admin/partner/partners/customer/edit?lang=vi', {
    redirect: 'manual',
  })
  assert.equal(legacyEdit.status, 303)
  assert.equal(legacyEdit.headers.get('location'), '/admin/partner/partners/customer?lang=vi')

  const keptSearch = await (
    await e2e.client.get('/admin/partner/partners?role=customer&archived=1&lang=en')
  ).text()
  assert.match(keptSearch, /name="role" value="customer"/)
  assert.match(keptSearch, /name="archived" value="1"/)
  assert.match(keptSearch, /name="lang" value="en"/)

  const english = await e2e.client.get('/admin/partner/partners?lang=en', {
    headers: { accept: 'text/html' },
  })
  assert.equal(english.status, 200)
  assert.match(await english.text(), /Partner directory|Partners/)

  const archived = await e2e.client.post(
    '/admin/partner/partners/customer/archive?lang=en',
    new URLSearchParams({ action: 'archive' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
  )
  assert.equal(archived.status, 200)
  assert.doesNotMatch(
    await (await e2e.client.get('/admin/partner/partners?lang=en')).text(),
    /Công ty Minh An/,
  )
  assert.match(await (await e2e.client.get('/admin/partner/partners?archived=1&lang=en')).text(), /Archived/)
  await e2e.client.post(
    '/admin/partner/partners/customer/archive?lang=en',
    new URLSearchParams({ action: 'restore' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
  )

  const created = await e2e.client.post(
    '/admin/partner/partners/new',
    new URLSearchParams({ kind: 'person', name: 'Nguyễn An', email: 'an@example.test' }),
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    },
  )
  assert.equal(created.status, 303)
  assert.match(created.headers.get('location') ?? '', /^\/admin\/partner\/partners\/[0-9a-f-]+$/)
})
