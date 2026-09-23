// The search-filter bar over the company list.
//
// The list reads every legal entity the reader may see and narrows it in
// memory, so what is worth proving over real HTTP is that the URL the bar
// writes is the URL the page reads: the query, a group that turns the table
// into openable groups, the archived toggle that replaced the old action link,
// and a favourite that round-trips.
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const COMPANIES = '/admin/companies'

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branch: 'root:acme', branches: ['root:acme'] }
  const fixture = async (name: string, input: Record<string, unknown>) =>
    (await app.fixture.call<Row>(name, input, { scope })).value
  const company = async (id: string, code: string, name: string, currency: string) => {
    await fixture('partner.savePartner', { id: `${id}-party`, kind: 'company', name })
    await fixture('company.saveCompany', { id, code, partnerId: `${id}-party`, currency })
  }
  await company('acme', 'ACME', 'ACME Việt Nam', 'VND')
  await company('euro', 'EURO', 'NEEDLE Europe', 'EUR')
  await company('dollar', 'DOLLAR', 'NEEDLE States', 'USD')
  await company('closed', 'CLOSED', 'NEEDLE đã lưu trữ', 'VND')
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    defaultCompanyId: 'acme',
    defaultBranchId: 'root:acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await fixture('user.archiveCompany', { id: 'closed', active: false })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  return app
}

test('company list HTTP: the bar replaces the GET search and drives the same URL state', async (t) => {
  const app = await boot(t)

  const all = await app.client.get(`${COMPANIES}?lang=vi`)
  const allHtml = await all.text()
  assert.equal(all.status, 200)
  assert.match(allHtml, /data-island="backend\.search-filter"/)
  assert.doesNotMatch(allHtml, /name="q"[^>]*data-ui="chrome-search-input"/)
  assert.match(allHtml, /data-row="euro"/)
  assert.doesNotMatch(allHtml, /data-row="closed"/)

  const searched = await (await app.client.get(`${COMPANIES}?lang=vi&q=EURO`)).text()
  assert.match(searched, /data-row="euro"/)
  assert.doesNotMatch(searched, /data-row="dollar"/)

  // The currency is a column the bar can read, so the query reaches it too.
  const byCurrency = await (await app.client.get(`${COMPANIES}?lang=vi&q=USD`)).text()
  assert.match(byCurrency, /data-row="dollar"/)
  assert.doesNotMatch(byCurrency, /data-row="euro"/)

  // The archived toggle replaced the old include-archived action link.
  const archived = await (await app.client.get(`${COMPANIES}?lang=vi&q=NEEDLE&archived=1`)).text()
  assert.match(archived, /data-row="closed"/)

  const grouped = await (await app.client.get(`${COMPANIES}?lang=vi&group=currency`)).text()
  assert.match(grouped, /data-ui="kt-group-toggle"/)
  assert.doesNotMatch(grouped, /data-ui="kt-row"/)
  const open = grouped.match(/data-ui="kt-group-toggle" href="([^"]+)" aria-expanded="false"/)
  assert.ok(open, 'a group must be expandable')
  assert.match(await (await app.client.get(open[1]!.replaceAll('&amp;', '&'))).text(), /data-ui="kt-row"/)
})

test('company list HTTP: the bar applies and saves searches through the shared functions', async (t) => {
  const app = await boot(t)
  const returnTo = `${COMPANIES}?lang=vi`

  const applied = await app.client.call<{ href: string }>('company_backend.applySearchFilter', {
    listKey: 'company.companies',
    returnTo,
    query: 'NEEDLE',
    facets: [],
    groupBy: ['currency'],
    customFilters: [],
  })
  const href = new URL(applied.value.href, 'http://ket.local')
  assert.equal(href.pathname, COMPANIES)
  assert.equal(href.searchParams.get('q'), 'NEEDLE')
  assert.deepEqual(href.searchParams.getAll('group'), ['currency'])

  const favorite = await app.client.call<{ id: string }>('company_backend.saveSearchFavorite', {
    name: 'Chỉ pháp nhân NEEDLE',
    isDefault: true,
    state: {
      listKey: 'company.companies',
      returnTo,
      query: 'NEEDLE',
      facets: [],
      groupBy: [],
      customFilters: [],
    },
  })
  const reopened = await app.client.call<{ href: string }>('company_backend.applySearchFilter', {
    listKey: 'company.companies',
    returnTo,
    favoriteId: favorite.value.id,
    facets: [],
    groupBy: [],
    customFilters: [],
  })
  assert.equal(new URL(reopened.value.href, 'http://ket.local').searchParams.get('q'), 'NEEDLE')
  assert.match(await (await app.client.get(returnTo)).text(), /Chỉ pháp nhân NEEDLE/)

  await app.client.call('company_backend.deleteSearchFavorite', {
    listKey: 'company.companies',
    id: favorite.value.id,
  })
  assert.doesNotMatch(await (await app.client.get(returnTo)).text(), /Chỉ pháp nhân NEEDLE/)
})
