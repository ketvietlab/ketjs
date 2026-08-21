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
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
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
  return e2e
}

test('relational select HTTP: empty partner relations keep create flows available', async (t) => {
  const e2e = await boot(t)
  for (const [path, identity, title] of [
    ['/admin/partners/new', 'partner-parent-new', 'Quản lý tổ chức'],
    ['/admin/sales/quotations', 'sale-customer', 'Quản lý khách hàng'],
    ['/admin/purchase/rfqs', 'purchase-vendor', 'Quản lý nhà cung cấp'],
  ]) {
    const response = await e2e.client.get(path)
    assert.equal(response.status, 200, path)
    const html = await response.text()
    assert.match(html, /data-island="backend\.relation-select"/, path)
    assert.match(html, new RegExp(identity), path)
    assert.match(html, new RegExp(title), path)
    assert.match(html, /Xem thêm…/, path)
    assert.match(html, /partner\.listPartners/, path)
    assert.match(html, /partner\.savePartner/, path)
    assert.doesNotMatch(html, /partner\.archivePartner/, path)
  }

  const english = await e2e.client.get('/admin/sales/quotations?lang=en')
  assert.equal(english.status, 200)
  assert.match(await english.text(), /Manage customers/)
})

test('relational select HTTP: browser module and shared view are served by backend', async (t) => {
  const e2e = await boot(t)
  const bootstrap = await e2e.client.get('/_ket/asset/backend/client/relation-select.mjs')
  assert.equal(bootstrap.status, 200)
  assert.match(await bootstrap.text(), /createRelationSelectView/)
  const shared = await e2e.client.get('/_ket/asset/backend/client/relation-select-view.mjs')
  assert.equal(shared.status, 200)
  const source = await shared.text()
  assert.match(source, /relation-footer/)
  assert.match(source, /data-presentation="dialog"/)
  assert.match(source, /data-ui="relation-native"/)
  assert.match(source, /activeRequest === request/)
})

test('relational select HTTP: declared partner capabilities cover create and update', async (t) => {
  const e2e = await boot(t)
  const call = async <T>(name: string, input: Record<string, unknown>) =>
    (await e2e.client.call<T>(name, input)).value

  await call('partner.savePartner', {
    id: 'managed-relation',
    kind: 'company',
    name: 'Managed relation',
  })
  await call('partner.savePartner', {
    id: 'managed-relation',
    kind: 'company',
    name: 'Managed relation updated',
  })
  const active = await call<Row[]>('partner.listPartners', { search: 'relation updated' })
  assert.deepEqual(
    active.map((row) => row.id),
    ['managed-relation'],
  )
})
