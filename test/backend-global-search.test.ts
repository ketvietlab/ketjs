import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

test('global search requires authentication, keeps native URLs and enforces record permissions', async (t) => {
  const app = await createTestDeployment(ketsuite)
  t.after(() => app.close())
  const fixture = (fn: string, input: Record<string, unknown>) =>
    app.fixture.call(fn, input, { scope: { company: 'search-co', branches: null } })
  await fixture('partner.savePartner', { id: 'search-co-partner', kind: 'company', name: 'Search company' })
  await fixture('company.saveCompany', { id: 'search-co', partnerId: 'search-co-partner', currency: 'VND' })
  for (const [id, superuser] of [
    ['search-admin', true],
    ['search-restricted', false],
  ] as const) {
    await fixture('partner.savePartner', { id, kind: 'person', name: id })
    await fixture('user.createUser', {
      id,
      partnerId: id,
      login: id,
      password: 'search-test-password',
      name: id,
      defaultCompanyId: 'search-co',
      superuser,
    })
    await fixture('user.grantCompany', { id: `${id}:co`, userId: id, companyId: 'search-co' })
  }
  await fixture('uom.saveUnit', { id: 'unit-search', name: 'Unit', relativeFactor: '1' })
  await fixture('product.saveTemplate', {
    id: 'needle-product',
    name: 'Needle <product>',
    type: 'goods',
    uomId: 'unit-search',
    listPrice: '100',
  })
  const anon = await app.client.get('/admin/search?q=Needle', {
    redirect: 'manual',
    headers: { accept: 'text/html' },
  })
  assert.equal(anon.status, 303)
  await app.client.login({ login: 'search-admin', password: 'search-test-password' })
  const response = await app.client.get('/admin/search?q=Needle&lang=vi')
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.match(html, /Needle &lt;product&gt;/)
  assert.match(html, /record=product.template%3Aneedle-product&amp;lang=vi/)
  assert.match(html, /data-ui="global-search-input"[^>]*value="Needle"/)
  const empty = await (await app.client.get('/admin/search?lang=vi')).text()
  assert.doesNotMatch(empty, /Needle &lt;product&gt;/)
  const menu = await (await app.client.get('/admin/search?q=san%20pham&lang=vi')).text()
  assert.match(menu, /data-ui="nav-item"[^>]*href="\/admin\/product\/templates\?lang=vi"/)
  const restricted = app.client.anonymous()
  await restricted.login({ login: 'search-restricted', password: 'search-test-password' })
  const forbidden = await (await restricted.get('/admin/search?q=Needle&lang=vi')).text()
  assert.doesNotMatch(forbidden, /Needle &lt;product&gt;|record=product.template/)
})
