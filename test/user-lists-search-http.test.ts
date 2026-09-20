// The search-filter bar over the identity lists.
//
// People and roles both read a bounded collection and narrow it in memory, so
// what is worth proving over real HTTP is that the URL the bar writes is the
// URL the page reads: the query, a preset, a group that turns the table into
// openable groups, the archived toggle, and a favourite that round-trips.
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const PEOPLE = '/admin/users'
const ROLES = '/admin/roles'

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branch: 'root:acme', branches: ['root:acme'] }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })
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
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await fixture('user.createUser', {
    id: 'portal-guest',
    login: 'guest',
    name: 'Khách Portal',
    accessKind: 'portal',
  })
  await fixture('user.createUser', { id: 'left', login: 'left', name: 'Người Đã Nghỉ' })
  await fixture('user.archiveUser', { id: 'left', active: false })
  await fixture('user.saveRole', { id: 'manager', name: 'Manager', description: 'Operational manager' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  return app
}

test('identity lists HTTP: the bar replaces the GET search and drives the same URL state', async (t) => {
  const app = await boot(t)

  const all = await app.client.get(`${PEOPLE}?lang=vi`)
  const allHtml = await all.text()
  assert.equal(all.status, 200)
  assert.match(allHtml, /data-island="backend\.search-filter"/)
  assert.doesNotMatch(allHtml, /name="q"[^>]*data-ui="chrome-search-input"/)
  assert.match(allHtml, /data-row="portal-guest"/)
  assert.doesNotMatch(allHtml, /data-row="left"/)

  const searched = await (await app.client.get(`${PEOPLE}?lang=vi&q=Portal`)).text()
  assert.match(searched, /data-row="portal-guest"/)
  assert.doesNotMatch(searched, /data-row="admin"/)

  const portal = await (await app.client.get(`${PEOPLE}?lang=vi&preset=portal`)).text()
  assert.match(portal, /data-row="portal-guest"/)
  assert.doesNotMatch(portal, /data-row="admin"/)

  // Alternatives within one group, so asking for both keeps both kinds.
  const both = await (await app.client.get(`${PEOPLE}?lang=vi&preset=portal&preset=internal`)).text()
  assert.match(both, /data-row="portal-guest"/)
  assert.match(both, /data-row="admin"/)

  // The archived toggle reaches the domain call as well as the row filter.
  assert.match(await (await app.client.get(`${PEOPLE}?lang=vi&archived=1`)).text(), /data-row="left"/)

  const grouped = await (await app.client.get(`${PEOPLE}?lang=vi&group=accessKind`)).text()
  assert.match(grouped, /data-ui="kt-group-toggle"/)
  assert.doesNotMatch(grouped, /data-ui="kt-row"/)
  const open = grouped.match(/data-ui="kt-group-toggle" href="([^"]+)" aria-expanded="false"/)
  assert.ok(open, 'a group must be expandable')
  assert.match(await (await app.client.get(open[1]!.replaceAll('&amp;', '&'))).text(), /data-ui="kt-row"/)
})

test('identity lists HTTP: roles carry the bar and read its presets', async (t) => {
  const app = await boot(t)
  const roles = await app.client.get(`${ROLES}?lang=vi`)
  const html = await roles.text()
  assert.equal(roles.status, 200)
  assert.match(html, /data-island="backend\.search-filter"/)
  assert.match(html, /data-row="manager"/)
  assert.doesNotMatch(await (await app.client.get(`${ROLES}?lang=vi&preset=managed`)).text(), /data-row="manager"/)
  assert.match(await (await app.client.get(`${ROLES}?lang=vi&preset=custom`)).text(), /data-row="manager"/)
  assert.match(await (await app.client.get(`${ROLES}?lang=vi&preset=unassigned`)).text(), /data-row="manager"/)
})

test('identity lists HTTP: the bar applies and saves searches through the shared functions', async (t) => {
  const app = await boot(t)
  const returnTo = `${PEOPLE}?lang=vi`

  const applied = await app.client.call<{ href: string }>('user_backend.applySearchFilter', {
    listKey: 'user.users',
    returnTo,
    query: 'Portal',
    facets: [{ id: 'preset:portal', type: 'filter', label: 'Portal' }],
    groupBy: ['accessKind'],
    customFilters: [],
  })
  const href = new URL(applied.value.href, 'http://ket.local')
  assert.equal(href.pathname, PEOPLE)
  assert.equal(href.searchParams.get('q'), 'Portal')
  assert.deepEqual(href.searchParams.getAll('preset'), ['portal'])
  assert.deepEqual(href.searchParams.getAll('group'), ['accessKind'])

  const favorite = await app.client.call<{ id: string }>('user_backend.saveSearchFavorite', {
    name: 'Chỉ khách portal',
    isDefault: true,
    state: {
      listKey: 'user.users',
      returnTo,
      facets: [{ id: 'preset:portal', type: 'filter', label: 'Portal' }],
      groupBy: [],
      customFilters: [],
    },
  })
  const reopened = await app.client.call<{ href: string }>('user_backend.applySearchFilter', {
    listKey: 'user.users',
    returnTo,
    favoriteId: favorite.value.id,
    facets: [],
    groupBy: [],
    customFilters: [],
  })
  assert.deepEqual(new URL(reopened.value.href, 'http://ket.local').searchParams.getAll('preset'), ['portal'])
  assert.match(await (await app.client.get(returnTo)).text(), /Chỉ khách portal/)

  await app.client.call('user_backend.deleteSearchFavorite', {
    listKey: 'user.users',
    id: favorite.value.id,
  })
  assert.doesNotMatch(await (await app.client.get(returnTo)).text(), /Chỉ khách portal/)
})
