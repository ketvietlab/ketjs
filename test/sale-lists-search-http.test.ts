// The search-filter bar over the sales lists.
//
// Quotations, orders and invoicing policies each read a bounded collection and
// narrow it in memory, so what is worth proving over real HTTP is that the URL
// the bar writes is the URL the page reads: the query, a state preset, groups
// that accumulate, a grouped table, and a favourite that survives a round trip.
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const QUOTATIONS = '/admin/sales/quotations'

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => app.fixture.call(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', { id: 'minh', kind: 'company', name: 'Khách Minh Anh' })
  await fixture('partner.savePartner', { id: 'lan', kind: 'company', name: 'Khách Lan Chi' })
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
  const call = (name: string, input: Record<string, unknown> = {}) => app.client.call(name, input)
  await call('uom.saveUnit', { id: 'unit', name: 'Đơn vị', relativeFactor: '1' })
  await call('product.saveTemplate', {
    id: 'goods',
    name: 'Ghế công thái học',
    type: 'goods',
    uomId: 'unit',
    listPrice: '3000000',
    saleOk: true,
  })
  await call('product.saveVariant', {
    id: 'chair',
    templateId: 'goods',
    defaultCode: 'GHE',
    combinationKey: '',
  })
  await call('stock.saveWarehouse', { id: 'wh', name: 'Kho chính', code: 'WH' })
  await call('sale.createOrder', { id: 'so-draft', partnerId: 'minh', warehouseId: 'wh' })
  await call('sale.createOrder', { id: 'so-cancel', partnerId: 'lan', warehouseId: 'wh' })
  await call('sale.cancelOrder', { id: 'so-cancel' })
  return app
}

test('sale quotations HTTP: the bar replaces the GET search and drives the same URL state', async (t) => {
  const app = await boot(t)

  const all = await app.client.get(`${QUOTATIONS}?lang=vi`)
  const allHtml = await all.text()
  assert.equal(all.status, 200)
  assert.match(allHtml, /data-island="backend\.search-filter"/)
  assert.doesNotMatch(allHtml, /name="q"[^>]*data-ui="chrome-search-input"/)
  assert.match(allHtml, /data-row="so-draft"/)
  assert.match(allHtml, /data-row="so-cancel"/)

  const searched = await (await app.client.get(`${QUOTATIONS}?lang=vi&q=Lan`)).text()
  assert.match(searched, /data-row="so-cancel"/)
  assert.doesNotMatch(searched, /data-row="so-draft"/)

  const draft = await (await app.client.get(`${QUOTATIONS}?lang=vi&preset=draft`)).text()
  assert.match(draft, /data-row="so-draft"/)
  assert.doesNotMatch(draft, /data-row="so-cancel"/)

  // Alternatives within one group, so asking for both keeps both quotations.
  const both = await (await app.client.get(`${QUOTATIONS}?lang=vi&preset=draft&preset=cancel`)).text()
  assert.match(both, /data-row="so-draft"/)
  assert.match(both, /data-row="so-cancel"/)

  const grouped = await (await app.client.get(`${QUOTATIONS}?lang=vi&group=state`)).text()
  assert.match(grouped, /data-ui="kt-group-toggle"/)
  assert.doesNotMatch(grouped, /data-ui="kt-row"/)
  const open = grouped.match(/data-ui="kt-group-toggle" href="([^"]+)" aria-expanded="false"/)
  assert.ok(open, 'a group must be expandable')
  assert.match(await (await app.client.get(open[1]!.replaceAll('&amp;', '&'))).text(), /data-ui="kt-row"/)
})

test('sale lists HTTP: the bar applies and saves searches through the shared functions', async (t) => {
  const app = await boot(t)
  const returnTo = `${QUOTATIONS}?lang=vi`

  const applied = await app.client.call<{ href: string }>('sale_backend.applySearchFilter', {
    listKey: 'sale.quotations',
    returnTo,
    query: 'Minh',
    facets: [{ id: 'preset:draft', type: 'filter', label: 'Draft' }],
    groupBy: ['state'],
    customFilters: [],
  })
  const href = new URL(applied.value.href, 'http://ket.local')
  assert.equal(href.pathname, QUOTATIONS)
  assert.equal(href.searchParams.get('q'), 'Minh')
  assert.deepEqual(href.searchParams.getAll('preset'), ['draft'])
  assert.deepEqual(href.searchParams.getAll('group'), ['state'])

  const favorite = await app.client.call<{ id: string }>('sale_backend.saveSearchFavorite', {
    name: 'Báo giá còn nháp',
    isDefault: true,
    state: {
      listKey: 'sale.quotations',
      returnTo,
      facets: [{ id: 'preset:draft', type: 'filter', label: 'Draft' }],
      groupBy: [],
      customFilters: [],
    },
  })
  const reopened = await app.client.call<{ href: string }>('sale_backend.applySearchFilter', {
    listKey: 'sale.quotations',
    returnTo,
    favoriteId: favorite.value.id,
    facets: [],
    groupBy: [],
    customFilters: [],
  })
  assert.deepEqual(new URL(reopened.value.href, 'http://ket.local').searchParams.getAll('preset'), ['draft'])
  assert.match(await (await app.client.get(returnTo)).text(), /Báo giá còn nháp/)

  await app.client.call('sale_backend.deleteSearchFavorite', {
    listKey: 'sale.quotations',
    id: favorite.value.id,
  })
  assert.doesNotMatch(await (await app.client.get(returnTo)).text(), /Báo giá còn nháp/)
})

test('sale lists HTTP: every sales list carries the bar', async (t) => {
  const app = await boot(t)
  for (const path of ['/admin/sales/quotations', '/admin/sales/orders', '/admin/sales/invoicing-policies']) {
    const response = await app.client.get(`${path}?lang=vi`)
    const html = await response.text()
    assert.equal(response.status, 200, path)
    assert.match(html, /data-island="backend\.search-filter"/, path)
    assert.doesNotMatch(html, /name="q"[^>]*data-ui="chrome-search-input"/, path)
  }
})
