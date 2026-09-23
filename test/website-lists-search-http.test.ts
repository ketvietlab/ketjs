// The search-filter bar over the website lists.
//
// Two shapes share one bar here, so both are worth a round trip through real
// HTTP. Content is paged by `website.listEntries`, which takes a query and one
// status, so what matters is that `?q=` and `?preset=` reach those arguments.
// The site's domains and members are complete collections narrowed in memory,
// where what matters is that the URL the bar writes is the URL the page reads.
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const PAGES = '/admin/website/pages'
const LAYOUT = [{ type: 'website.rich_text', settings: { body: 'noi dung' } }]

const boot = async (t: TestContext) => {
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
  await app.client.call('website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Mộc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
    active: true,
  })
  await app.client.call('website.saveEntry', {
    id: 'p-tra',
    siteId: 'site1',
    type: 'website.page',
    slug: 'tra',
    path: '/tra',
    title: 'Trang trà',
    layout: LAYOUT,
  })
  await app.client.call('website.saveEntry', {
    id: 'p-gom',
    siteId: 'site1',
    type: 'website.page',
    slug: 'gom',
    path: '/gom',
    title: 'Trang gốm',
    layout: LAYOUT,
  })
  await app.client.call('website.publishEntry', { id: 'p-gom' })
  await app.client.call('website.saveDomain', {
    id: 'd-primary',
    siteId: 'site1',
    host: 'moc.test',
    primary: true,
  })
  await app.client.call('website.saveDomain', {
    id: 'd-alias',
    siteId: 'site1',
    host: 'alias.test',
    primary: false,
    redirectToPrimary: true,
  })
  return app
}

test('website content HTTP: the bar carries the query and the publication state', async (t) => {
  const app = await boot(t)

  const all = await app.client.get(`${PAGES}?lang=vi&site=site1`)
  const allHtml = await all.text()
  assert.equal(all.status, 200)
  assert.match(allHtml, /data-island="backend\.search-filter"/)
  // The old combined GET form kept only the site selector.
  assert.doesNotMatch(allHtml, /name="status"/)
  assert.match(allHtml, /name="site"/)
  assert.match(allHtml, /Trang trà/)
  assert.match(allHtml, /Trang gốm/)

  const searched = await (await app.client.get(`${PAGES}?lang=vi&site=site1&q=g%E1%BB%91m`)).text()
  assert.match(searched, /Trang gốm/)
  assert.doesNotMatch(searched, /Trang trà/)

  // A state preset reaches `listEntries`' own `status` argument.
  const published = await (await app.client.get(`${PAGES}?lang=vi&site=site1&preset=published`)).text()
  assert.match(published, /Trang gốm/)
  assert.doesNotMatch(published, /Trang trà/)
  const draft = await (await app.client.get(`${PAGES}?lang=vi&site=site1&preset=draft`)).text()
  assert.match(draft, /Trang trà/)
  assert.doesNotMatch(draft, /Trang gốm/)
})

test('website domains HTTP: an in-memory list narrows on query and preset', async (t) => {
  const app = await boot(t)
  const path = '/admin/website/sites/site1/domains'

  const all = await (await app.client.get(`${path}?lang=vi`)).text()
  assert.match(all, /data-island="backend\.search-filter"/)
  assert.match(all, /moc\.test/)
  assert.match(all, /alias\.test/)

  // The primary host is named in the page's own chrome too, so the rows are
  // what these assertions read.
  const searched = await (await app.client.get(`${path}?lang=vi&q=alias`)).text()
  assert.match(searched, /data-row="d-alias"/)
  assert.doesNotMatch(searched, /data-row="d-primary"/)

  const primary = await (await app.client.get(`${path}?lang=vi&preset=primary`)).text()
  assert.match(primary, /data-row="d-primary"/)
  assert.doesNotMatch(primary, /data-row="d-alias"/)

  // Alternatives in one group, so asking for both keeps both rows.
  const both = await (await app.client.get(`${path}?lang=vi&preset=primary&preset=redirecting`)).text()
  assert.match(both, /data-row="d-primary"/)
  assert.match(both, /data-row="d-alias"/)
})

test('website lists HTTP: the bar applies and saves searches through the shared functions', async (t) => {
  const app = await boot(t)
  const returnTo = '/admin/website/sites/site1/domains?lang=vi'

  const applied = await app.client.call<{ href: string }>('website_backend.applySearchFilter', {
    listKey: 'website.domains',
    returnTo,
    query: 'test',
    facets: [{ id: 'preset:primary', type: 'filter', label: 'Primary' }],
    groupBy: [],
    customFilters: [],
  })
  const href = new URL(applied.value.href, 'http://ket.local')
  assert.equal(href.pathname, '/admin/website/sites/site1/domains')
  assert.equal(href.searchParams.get('q'), 'test')
  assert.deepEqual(href.searchParams.getAll('preset'), ['primary'])

  const favorite = await app.client.call<{ id: string }>('website_backend.saveSearchFavorite', {
    name: 'Chỉ tên miền gốc',
    isDefault: true,
    state: {
      listKey: 'website.domains',
      returnTo,
      facets: [{ id: 'preset:primary', type: 'filter', label: 'Primary' }],
      groupBy: [],
      customFilters: [],
    },
  })
  const reopened = await app.client.call<{ href: string }>('website_backend.applySearchFilter', {
    listKey: 'website.domains',
    returnTo,
    favoriteId: favorite.value.id,
    facets: [],
    groupBy: [],
    customFilters: [],
  })
  assert.deepEqual(new URL(reopened.value.href, 'http://ket.local').searchParams.getAll('preset'), [
    'primary',
  ])
  const listed = await (await app.client.get(`${returnTo}`)).text()
  assert.match(listed, /Chỉ tên miền gốc/)

  await app.client.call('website_backend.deleteSearchFavorite', {
    listKey: 'website.domains',
    id: favorite.value.id,
  })
  const without = await (await app.client.get(`${returnTo}`)).text()
  assert.doesNotMatch(without, /Chỉ tên miền gốc/)
})

test('website lists HTTP: every migrated website list carries the bar', async (t) => {
  const app = await boot(t)
  const paths = [
    '/admin/website/pages?site=site1',
    '/admin/website/posts?site=site1',
    '/admin/website/health',
    '/admin/website/sites/site1/members',
    '/admin/website/sites/site1/domains',
    '/admin/website/content/p-tra/revisions',
  ]
  for (const path of paths) {
    const response = await app.client.get(`${path}${path.includes('?') ? '&' : '?'}lang=vi`)
    const html = await response.text()
    assert.equal(response.status, 200, path)
    assert.match(html, /data-island="backend\.search-filter"/, path)
    assert.doesNotMatch(html, /name="q"[^>]*data-ui="chrome-search-input"/, path)
  }
})
