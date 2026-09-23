// The search-filter bar over the accounting lists.
//
// Every accounting list reads a bounded collection and narrows it in memory, so
// what is worth proving over real HTTP is that the URL the bar writes is the
// URL the page reads: the query, presets that are alternatives within one group,
// a group that turns the table into openable groups, the archived toggle that
// replaced the old status facet, and a favourite that round-trips.
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const JOURNALS = '/admin/accounting/journals'

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
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
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  await app.client.call('account.initializeCompany', {})
  await app.client.call('account.saveJournal', {
    id: 'needle-bank',
    code: 'NEEDLEB',
    name: 'Sổ NEEDLE ngân hàng',
    type: 'bank',
  })
  await app.client.call('account.saveJournal', {
    id: 'needle-cash',
    code: 'NEEDLEC',
    name: 'Sổ NEEDLE tiền mặt',
    type: 'cash',
  })
  await app.client.call('account.saveJournal', {
    id: 'needle-old',
    code: 'NEEDLEO',
    name: 'Sổ NEEDLE đã lưu trữ',
    type: 'general',
    active: false,
  })
  return app
}

test('accounting lists HTTP: the bar replaces the GET search and drives the same URL state', async (t) => {
  const app = await boot(t)

  const all = await app.client.get(`${JOURNALS}?lang=vi`)
  const allHtml = await all.text()
  assert.equal(all.status, 200)
  assert.match(allHtml, /data-island="backend\.search-filter"/)
  assert.doesNotMatch(allHtml, /name="q"[^>]*data-ui="chrome-search-input"/)
  assert.match(allHtml, /data-row="needle-bank"/)
  assert.doesNotMatch(allHtml, /data-row="needle-old"/)

  const searched = await (await app.client.get(`${JOURNALS}?lang=vi&q=NEEDLEB`)).text()
  assert.match(searched, /data-row="needle-bank"/)
  assert.doesNotMatch(searched, /data-row="needle-cash"/)

  const bank = await (await app.client.get(`${JOURNALS}?lang=vi&preset=bank&q=NEEDLE`)).text()
  assert.match(bank, /data-row="needle-bank"/)
  assert.doesNotMatch(bank, /data-row="needle-cash"/)

  // Alternatives within one group, so asking for both kinds keeps both.
  const both = await (await app.client.get(`${JOURNALS}?lang=vi&preset=bank&preset=cash&q=NEEDLE`)).text()
  assert.match(both, /data-row="needle-bank"/)
  assert.match(both, /data-row="needle-cash"/)

  // The archived toggle supersedes the old status facet over the same field.
  const archived = await (await app.client.get(`${JOURNALS}?lang=vi&q=NEEDLE&archived=1`)).text()
  assert.match(archived, /data-row="needle-old"/)

  const grouped = await (await app.client.get(`${JOURNALS}?lang=vi&group=type`)).text()
  assert.match(grouped, /data-ui="kt-group-toggle"/)
  assert.doesNotMatch(grouped, /data-ui="kt-row"/)
  const open = grouped.match(/data-ui="kt-group-toggle" href="([^"]+)" aria-expanded="false"/)
  assert.ok(open, 'a group must be expandable')
  assert.match(await (await app.client.get(open[1]!.replaceAll('&amp;', '&'))).text(), /data-ui="kt-row"/)
})

test('accounting lists HTTP: the bar applies and saves searches through the shared functions', async (t) => {
  const app = await boot(t)
  const returnTo = `${JOURNALS}?lang=vi`

  const applied = await app.client.call<{ href: string }>('account_backend.applySearchFilter', {
    listKey: 'account.journals',
    returnTo,
    query: 'NEEDLE',
    facets: [{ id: 'preset:bank', type: 'filter', label: 'Ngân hàng' }],
    groupBy: ['type'],
    customFilters: [],
  })
  const href = new URL(applied.value.href, 'http://ket.local')
  assert.equal(href.pathname, JOURNALS)
  assert.equal(href.searchParams.get('q'), 'NEEDLE')
  assert.deepEqual(href.searchParams.getAll('preset'), ['bank'])
  assert.deepEqual(href.searchParams.getAll('group'), ['type'])

  const favorite = await app.client.call<{ id: string }>('account_backend.saveSearchFavorite', {
    name: 'Chỉ sổ ngân hàng',
    isDefault: true,
    state: {
      listKey: 'account.journals',
      returnTo,
      facets: [{ id: 'preset:bank', type: 'filter', label: 'Ngân hàng' }],
      groupBy: [],
      customFilters: [],
    },
  })
  const reopened = await app.client.call<{ href: string }>('account_backend.applySearchFilter', {
    listKey: 'account.journals',
    returnTo,
    favoriteId: favorite.value.id,
    facets: [],
    groupBy: [],
    customFilters: [],
  })
  assert.deepEqual(new URL(reopened.value.href, 'http://ket.local').searchParams.getAll('preset'), ['bank'])
  assert.match(await (await app.client.get(returnTo)).text(), /Chỉ sổ ngân hàng/)

  await app.client.call('account_backend.deleteSearchFavorite', {
    listKey: 'account.journals',
    id: favorite.value.id,
  })
  assert.doesNotMatch(await (await app.client.get(returnTo)).text(), /Chỉ sổ ngân hàng/)
})
