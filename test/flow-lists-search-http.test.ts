// The search-filter bar over the Flow lists.
//
// Two shapes meet here. The documents and epics are paged by their own domain
// function, so what is worth proving is that the query the bar writes is the
// query the page reads. Sprints are a bounded collection narrowed in memory, so
// they get the whole bar: presets over the state, a group that turns the table
// into openable groups, and a favourite that round-trips through the functions.
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const SPRINTS = '/admin/flow/projects/platform/sprints'

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branch: 'root:acme', branches: ['root:acme'] }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', code: 'ACME', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  await app.client.call('flow.project.save', {
    values: { id: 'platform', key: 'PLAT', name: 'Internal platform' },
    idempotencyKey: 'project-platform',
  })
  await app.client.call('flow.sprint.save', {
    id: 'sprint-one',
    projectId: 'platform',
    name: 'Chạy nước rút một',
    startDate: '2026-09-01',
    endDate: '2026-09-14',
    idempotencyKey: 'sprint-one',
  })
  await app.client.call('flow.sprint.save', {
    id: 'sprint-two',
    projectId: 'platform',
    name: 'Chạy nước rút hai',
    startDate: '2026-09-15',
    endDate: '2026-09-28',
    idempotencyKey: 'sprint-two',
  })
  await app.client.call('flow.sprint.start', { id: 'sprint-one', idempotencyKey: 'start-one' })
  return app
}

test('flow lists HTTP: the sprint bar replaces the GET search and drives the same URL state', async (t) => {
  const app = await boot(t)

  const all = await app.client.get(`${SPRINTS}?lang=vi`)
  const allHtml = await all.text()
  assert.equal(all.status, 200)
  assert.match(allHtml, /data-island="backend\.search-filter"/)
  assert.doesNotMatch(allHtml, /name="q"[^>]*data-ui="chrome-search-input"/)
  assert.match(allHtml, /data-row="sprint-one"/)
  assert.match(allHtml, /data-row="sprint-two"/)

  const searched = await (await app.client.get(`${SPRINTS}?lang=vi&q=hai`)).text()
  assert.match(searched, /data-row="sprint-two"/)
  assert.doesNotMatch(searched, /data-row="sprint-one"/)

  const active = await (await app.client.get(`${SPRINTS}?lang=vi&preset=active`)).text()
  assert.match(active, /data-row="sprint-one"/)
  assert.doesNotMatch(active, /data-row="sprint-two"/)

  // Alternatives within one group, so asking for both keeps both sprints.
  const both = await (await app.client.get(`${SPRINTS}?lang=vi&preset=active&preset=planned`)).text()
  assert.match(both, /data-row="sprint-one"/)
  assert.match(both, /data-row="sprint-two"/)

  const grouped = await (await app.client.get(`${SPRINTS}?lang=vi&group=state`)).text()
  assert.match(grouped, /data-ui="kt-group-toggle"/)
  assert.doesNotMatch(grouped, /data-ui="kt-row"/)
  const open = grouped.match(/data-ui="kt-group-toggle" href="([^"]+)" aria-expanded="false"/)
  assert.ok(open, 'a group must be expandable')
  assert.match(await (await app.client.get(open[1]!.replaceAll('&amp;', '&'))).text(), /data-ui="kt-row"/)
})

test('flow lists HTTP: epics and documents carry the bar over their own paged reads', async (t) => {
  const app = await boot(t)
  for (const path of ['/admin/flow/epics', '/admin/flow/pages', '/admin/flow/projects']) {
    const html = await (await app.client.get(`${path}?lang=vi`)).text()
    assert.match(html, /data-island="backend\.search-filter"/, path)
    assert.doesNotMatch(html, /name="q"[^>]*data-ui="chrome-search-input"/, path)
  }
})

test('flow lists HTTP: the bar applies and saves searches through the shared functions', async (t) => {
  const app = await boot(t)
  const returnTo = `${SPRINTS}?lang=vi`

  const applied = await app.client.call<{ href: string }>('flow_backend.applySearchFilter', {
    listKey: 'flow.sprints',
    returnTo,
    query: 'hai',
    facets: [{ id: 'preset:planned', type: 'filter', label: 'Planned' }],
    groupBy: ['state'],
    customFilters: [],
  })
  const href = new URL(applied.value.href, 'http://ket.local')
  assert.equal(href.pathname, SPRINTS)
  assert.equal(href.searchParams.get('q'), 'hai')
  assert.deepEqual(href.searchParams.getAll('preset'), ['planned'])
  assert.deepEqual(href.searchParams.getAll('group'), ['state'])

  const favorite = await app.client.call<{ id: string }>('flow_backend.saveSearchFavorite', {
    name: 'Chỉ sprint đang chạy',
    isDefault: true,
    state: {
      listKey: 'flow.sprints',
      returnTo,
      facets: [{ id: 'preset:active', type: 'filter', label: 'Active' }],
      groupBy: [],
      customFilters: [],
    },
  })
  const reopened = await app.client.call<{ href: string }>('flow_backend.applySearchFilter', {
    listKey: 'flow.sprints',
    returnTo,
    favoriteId: favorite.value.id,
    facets: [],
    groupBy: [],
    customFilters: [],
  })
  assert.deepEqual(new URL(reopened.value.href, 'http://ket.local').searchParams.getAll('preset'), ['active'])
  assert.match(await (await app.client.get(returnTo)).text(), /Chỉ sprint đang chạy/)

  await app.client.call('flow_backend.deleteSearchFavorite', {
    listKey: 'flow.sprints',
    id: favorite.value.id,
  })
  assert.doesNotMatch(await (await app.client.get(returnTo)).text(), /Chỉ sprint đang chạy/)
})
