// The search-filter bar over the HR lists.
//
// Employees and leave approvals both read a bounded collection and narrow it in
// memory, so what is worth proving over real HTTP is that the URL the bar
// writes is the URL the page reads: the query, a preset, a group that turns the
// table into openable groups, the archived toggle, and a favourite that
// survives a round trip.
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const EMPLOYEES = '/admin/hr'

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'default', branch: 'root:default', branches: ['root:default'] }
  const fixture = async (name: string, input: Record<string, unknown>, actor?: string) =>
    (await app.fixture.call<Row>(name, input, { scope, actor })).value
  await fixture('partner.savePartner', { id: 'default-party', kind: 'company', name: 'Két Việt' })
  await fixture('company.saveCompany', {
    id: 'default',
    code: 'KET',
    partnerId: 'default-party',
    currency: 'VND',
  })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    defaultCompanyId: 'default',
    defaultBranchId: 'root:default',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:default', userId: 'admin', companyId: 'default' })
  await fixture('hr.employee.create', {
    id: 'minh',
    code: 'NV001',
    name: 'Nguyễn Minh Anh',
    homeBranchId: 'root:default',
    timezone: 'Asia/Ho_Chi_Minh',
    startDate: '2026-01-01',
  })
  await fixture('hr.employee.create', {
    id: 'lan',
    code: 'NV002',
    name: 'Trần Lan Chi',
    homeBranchId: 'root:default',
    timezone: 'UTC',
    startDate: '2026-02-01',
  })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  return { app, fixture }
}

test('HR employees HTTP: the bar replaces the GET search and drives the same URL state', async (t) => {
  const { app } = await boot(t)

  const all = await app.client.get(`${EMPLOYEES}?lang=vi`)
  const allHtml = await all.text()
  assert.equal(all.status, 200)
  assert.match(allHtml, /data-island="backend\.search-filter"/)
  assert.doesNotMatch(allHtml, /name="q"[^>]*data-ui="chrome-search-input"/)
  assert.match(allHtml, /data-row="minh"/)
  assert.match(allHtml, /data-row="lan"/)

  const searched = await (await app.client.get(`${EMPLOYEES}?lang=vi&q=Lan`)).text()
  assert.match(searched, /data-row="lan"/)
  assert.doesNotMatch(searched, /data-row="minh"/)

  const byTimezone = await (await app.client.get(`${EMPLOYEES}?lang=vi&group=timezone`)).text()
  assert.match(byTimezone, /data-ui="kt-group-toggle"/)
  assert.doesNotMatch(byTimezone, /data-ui="kt-row"/)
  const open = byTimezone.match(/data-ui="kt-group-toggle" href="([^"]+)" aria-expanded="false"/)
  assert.ok(open, 'a group must be expandable')
  assert.match(await (await app.client.get(open[1]!.replaceAll('&amp;', '&'))).text(), /data-ui="kt-row"/)
})

test('HR employees HTTP: the archived toggle is the only way to see archived employees', async (t) => {
  const { app } = await boot(t)
  await app.client.post(`${EMPLOYEES}?lang=vi`, new URLSearchParams({ action: 'archive', id: 'lan' }), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.doesNotMatch(await (await app.client.get(`${EMPLOYEES}?lang=vi`)).text(), /data-row="lan"/)
  assert.match(await (await app.client.get(`${EMPLOYEES}?lang=vi&archived=1`)).text(), /data-row="lan"/)
})

test('HR lists HTTP: the bar applies and saves searches through the shared functions', async (t) => {
  const { app } = await boot(t)
  const returnTo = `${EMPLOYEES}?lang=vi`

  const applied = await app.client.call<{ href: string }>('hr_backend.applySearchFilter', {
    listKey: 'hr.employees',
    returnTo,
    query: 'Minh',
    facets: [],
    groupBy: ['branch'],
    customFilters: [],
  })
  const href = new URL(applied.value.href, 'http://ket.local')
  assert.equal(href.pathname, EMPLOYEES)
  assert.equal(href.searchParams.get('q'), 'Minh')
  assert.deepEqual(href.searchParams.getAll('group'), ['branch'])

  const favorite = await app.client.call<{ id: string }>('hr_backend.saveSearchFavorite', {
    name: 'Nhân viên theo chi nhánh',
    isDefault: true,
    state: {
      listKey: 'hr.employees',
      returnTo,
      facets: [],
      groupBy: ['branch'],
      customFilters: [],
    },
  })
  const reopened = await app.client.call<{ href: string }>('hr_backend.applySearchFilter', {
    listKey: 'hr.employees',
    returnTo,
    favoriteId: favorite.value.id,
    facets: [],
    groupBy: [],
    customFilters: [],
  })
  assert.deepEqual(new URL(reopened.value.href, 'http://ket.local').searchParams.getAll('group'), ['branch'])
  assert.match(await (await app.client.get(returnTo)).text(), /Nhân viên theo chi nhánh/)

  await app.client.call('hr_backend.deleteSearchFavorite', {
    listKey: 'hr.employees',
    id: favorite.value.id,
  })
  assert.doesNotMatch(await (await app.client.get(returnTo)).text(), /Nhân viên theo chi nhánh/)
})

test('HR lists HTTP: leave approvals carry the bar and read its presets', async (t) => {
  const { app } = await boot(t)
  const leaves = await app.client.get('/admin/hr/leaves?lang=vi')
  const html = await leaves.text()
  assert.equal(leaves.status, 200)
  assert.match(html, /data-island="backend\.search-filter"/)
  assert.doesNotMatch(html, /name="q"[^>]*data-ui="chrome-search-input"/)
  assert.equal((await app.client.get('/admin/hr/leaves?lang=vi&preset=requested&group=state')).status, 200)
})
