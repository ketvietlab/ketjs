import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from 'ketjs'
import { createTestApp } from 'ketjs/testing'
import { ketsuite } from '../apps/ketsuite/app.ts'

const boot = async (t: TestContext) => {
  const e2e = await createTestApp(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    e2e.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'Két Việt' })
  await fixture('company.saveCompany', {
    id: 'acme',
    code: 'ACME',
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
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  return { e2e, fixture }
}

test('address HTTP: trusted settings route installs VN while generic transport hides installer', async (t) => {
  const { e2e } = await boot(t)
  const before = await e2e.client.get('/admin/addresses', { headers: { accept: 'text/html' } })
  assert.equal(before.status, 200)
  assert.match(await before.text(), /Sẵn sàng cài/)
  const partnerBefore = await e2e.client.get('/admin/partners/acme-party')
  assert.match(await partnerBefore.text(), /Catalog địa giới chưa được cài/)

  const hidden = await e2e.client.request('/_ket/fn/address.installCatalog', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ countryCode: 'VN' }),
  })
  assert.equal(hidden.status, 400)
  assert.equal(((await hidden.json()) as { code: string }).code, 'E_FUNCTION_INTERNAL')

  const installed = await e2e.client.post(
    '/admin/addresses/VN/install',
    new URLSearchParams({ action: '2025-07-01' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(installed.status, 303)
  assert.equal(installed.headers.get('location'), '/admin/addresses/VN')

  const catalog = await e2e.client.get('/admin/addresses')
  const catalogHtml = await catalog.text()
  assert.match(catalogHtml, /Đang hoạt động/)
  assert.match(catalogHtml, /3355/)
  const roots = await e2e.client.get('/admin/addresses/VN')
  const rootsHtml = await roots.text()
  assert.match(rootsHtml, /Hà Nội/)
  assert.match(rootsHtml, /Thành phố trực thuộc trung ương/)
  assert.doesNotMatch(rootsHtml, /address_backend\.[A-Za-z]/)
})

test('address HTTP: partner form renders and submits the Vietnam cascading selector', async (t) => {
  const { e2e, fixture } = await boot(t)
  await fixture('address.installCatalog', { countryCode: 'VN' })
  await fixture('partner.savePartner', { id: 'customer', kind: 'company', name: 'Công ty Minh An' })
  const saved = await e2e.client.post(
    '/admin/partners/customer/addresses',
    new URLSearchParams({
      use: 'delivery',
      street1: '12 Nguyễn Huệ',
      countryId: 'VN',
      divisionId: 'VN:2025-07-01:10101003',
      isDefault: '1',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(saved.status, 303)

  const detail = await e2e.client.get('/admin/partners/customer')
  const html = await detail.text()
  assert.equal(detail.status, 200)
  assert.match(html, /12 Nguyễn Huệ/)
  assert.match(html, /Phường Ba Đình/)
  assert.match(html, /data-island="partner\.address-form"/)
  assert.match(html, /<form[^>]*data-layout="default"[^>]*data-has-fields="true"[^>]*data-address-form/)
  assert.match(html, /name="divisionId"/)
  assert.doesNotMatch(html, /src="(?:undefined|null)?"/)

  const english = await e2e.client.get('/admin/partners/customer?lang=en')
  assert.equal(english.status, 200)
  assert.match(await english.text(), /Province\/City/)
})
