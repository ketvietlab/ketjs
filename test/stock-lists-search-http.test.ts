// The search-filter bar over a list whose rows are narrowed in memory.
//
// A query-backed list proves its filter by the SQL it compiles; a collection
// list has no SQL to inspect, so what matters is that the URL state the bar
// produces is the URL state the page reads back — searching, presets, grouping
// and a saved favourite all in one round trip through real HTTP.
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const PATH = '/admin/stock/warehouses'

const bootWarehouses = async (t: TestContext) => {
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
  await app.client.call('stock.saveWarehouse', {
    id: 'wh-direct',
    name: 'Kho trực tiếp',
    code: 'WHD',
    receptionSteps: 'one_step',
    deliverySteps: 'ship_only',
  })
  await app.client.call('stock.saveWarehouse', {
    id: 'wh-staged',
    name: 'Kho nhiều bước',
    code: 'WHS',
    receptionSteps: 'three_steps',
    deliverySteps: 'pick_pack_ship',
  })
  return app
}

test('stock warehouses HTTP: the bar replaces the GET search and drives the same URL state', async (t) => {
  const app = await bootWarehouses(t)

  const all = await app.client.get(`${PATH}?lang=vi`)
  const allHtml = await all.text()
  assert.equal(all.status, 200)
  assert.match(allHtml, /data-island="backend\.search-filter"/)
  // The legacy GET form is gone, not merely hidden behind the new bar.
  assert.doesNotMatch(allHtml, /data-ui="chrome-search"[^-]/)
  assert.match(allHtml, /Kho trực tiếp/)
  assert.match(allHtml, /Kho nhiều bước/)

  const searched = await (await app.client.get(`${PATH}?lang=vi&q=nhi%E1%BB%81u`)).text()
  assert.match(searched, /Kho nhiều bước/)
  assert.doesNotMatch(searched, /Kho trực tiếp/)

  const preset = await (await app.client.get(`${PATH}?lang=vi&preset=directReception`)).text()
  assert.match(preset, /Kho trực tiếp/)
  assert.doesNotMatch(preset, /Kho nhiều bước/)

  // Presets in one group are alternatives, so asking for both keeps both rows.
  const both = await (
    await app.client.get(`${PATH}?lang=vi&preset=directReception&preset=stagedReception`)
  ).text()
  assert.match(both, /Kho trực tiếp/)
  assert.match(both, /Kho nhiều bước/)

  // Different groups accumulate, so these two together match nothing.
  const contradiction = await (
    await app.client.get(`${PATH}?lang=vi&preset=directReception&preset=stagedDelivery`)
  ).text()
  assert.doesNotMatch(contradiction, /Kho trực tiếp|Kho nhiều bước/)

  const grouped = await (await app.client.get(`${PATH}?lang=vi&group=receptionSteps`)).text()
  assert.match(grouped, /data-ui="kt-group-toggle"/)
  assert.match(grouped, /Nhận hàng trực tiếp/)
  // A closed group shows its label and count, not its rows.
  assert.doesNotMatch(grouped, /data-ui="kt-row"/)
  const open = grouped.match(/data-ui="kt-group-toggle" href="([^"]+)" aria-expanded="false"/)
  assert.ok(open, 'a group must be expandable')
  const opened = await (await app.client.get(open[1]!.replaceAll('&amp;', '&'))).text()
  assert.match(opened, /data-ui="kt-row"/)
})

test('stock warehouses HTTP: the bar applies and saves searches through the shared functions', async (t) => {
  const app = await bootWarehouses(t)
  const returnTo = `${PATH}?lang=vi`

  const applied = await app.client.call<{ href: string }>('stock_backend.applySearchFilter', {
    listKey: 'stock.warehouses',
    returnTo,
    query: 'Kho',
    facets: [{ id: 'preset:stagedDelivery', type: 'filter', label: 'Staged delivery' }],
    groupBy: ['deliverySteps'],
    customFilters: [],
  })
  const href = new URL(applied.value.href, 'http://ket.local')
  assert.equal(href.pathname, PATH)
  assert.equal(href.searchParams.get('q'), 'Kho')
  assert.deepEqual(href.searchParams.getAll('preset'), ['stagedDelivery'])
  assert.deepEqual(href.searchParams.getAll('group'), ['deliverySteps'])
  assert.equal(href.searchParams.get('lang'), 'vi')

  const favorite = await app.client.call<{ id: string }>('stock_backend.saveSearchFavorite', {
    name: 'Kho giao nhiều bước',
    isDefault: true,
    state: {
      listKey: 'stock.warehouses',
      returnTo,
      facets: [{ id: 'preset:stagedDelivery', type: 'filter', label: 'Staged delivery' }],
      groupBy: [],
      customFilters: [],
    },
  })
  const reopened = await app.client.call<{ href: string }>('stock_backend.applySearchFilter', {
    listKey: 'stock.warehouses',
    returnTo,
    favoriteId: favorite.value.id,
    facets: [],
    groupBy: [],
    customFilters: [],
  })
  assert.deepEqual(new URL(reopened.value.href, 'http://ket.local').searchParams.getAll('preset'), [
    'stagedDelivery',
  ])
  const listed = await (await app.client.get(`${PATH}?lang=vi`)).text()
  assert.match(listed, /Kho giao nhiều bước/)

  await app.client.call('stock_backend.deleteSearchFavorite', {
    listKey: 'stock.warehouses',
    id: favorite.value.id,
  })
  const withoutFavorite = await (await app.client.get(`${PATH}?lang=vi`)).text()
  assert.doesNotMatch(withoutFavorite, /Kho giao nhiều bước/)
})

test('stock lists HTTP: every stock list carries the bar and no legacy search box', async (t) => {
  const app = await bootWarehouses(t)
  const paths = [
    '/admin/stock/warehouses',
    '/admin/stock/transfers',
    '/admin/stock/locations',
    '/admin/stock/picking-types',
    '/admin/stock/lots',
    '/admin/stock/routes',
    '/admin/stock/replenishment',
  ]
  for (const path of paths) {
    const response = await app.client.get(`${path}?lang=vi`)
    const html = await response.text()
    assert.equal(response.status, 200, path)
    assert.match(html, /data-island="backend\.search-filter"/, path)
    assert.doesNotMatch(html, /name="q"[^>]*data-ui="chrome-search-input"/, path)
  }
})
