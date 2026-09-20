// The search-filter bar over the hospitality lists.
//
// Every list here reads a complete, authorised collection and narrows it in
// memory, so what is worth proving is that the URL the bar writes is the URL
// the page reads back: the query, alternatives within one group, groups that
// accumulate, a grouped table, and a favourite that survives a round trip.
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import type { Scope } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const scope: Scope = { company: 'default', companies: ['default'], branches: null }
const PROPERTIES = '/admin/hospitality/properties'

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const seed = (name: string, input: Record<string, unknown>) => app.fixture.call(name, input, { scope })
  await seed('partner.savePartner', { id: 'company-partner', kind: 'company', name: 'Ket Hospitality' })
  await seed('company.saveCompany', { id: 'default', partnerId: 'company-partner', currency: 'VND' })
  await seed('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Hospitality admin',
    defaultCompanyId: 'default',
    superuser: true,
  })
  await seed('user.grantCompany', { id: 'admin:default', userId: 'admin', companyId: 'default' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  await app.client.call('hospitality_core.saveProperty', {
    id: 'hotel',
    code: 'HCM',
    name: 'Ket Hotel',
    accommodationType: 'hotel',
    timezone: 'Asia/Ho_Chi_Minh',
    street1: '123 Nguyễn Huệ',
    locality: 'Thành phố Hồ Chí Minh',
  })
  await app.client.call('hospitality_core.saveProperty', {
    id: 'homestay',
    code: 'DLT',
    name: 'Ket Homestay',
    accommodationType: 'homestay',
    timezone: 'Asia/Ho_Chi_Minh',
    street1: '9 Đà Lạt',
    locality: 'Đà Lạt',
  })
  await app.client.call('hospitality_core.saveAmenity', {
    id: 'pool',
    code: 'POOL',
    name: 'Hồ bơi',
    scope: 'property',
  })
  await app.client.call('hospitality_core.saveAmenity', {
    id: 'balcony',
    code: 'BALC',
    name: 'Ban công',
    scope: 'room',
  })
  return app
}

test('hospitality properties HTTP: the bar replaces the GET search and drives the same URL state', async (t) => {
  const app = await boot(t)

  const all = await app.client.get(`${PROPERTIES}?lang=vi`)
  const allHtml = await all.text()
  assert.equal(all.status, 200)
  assert.match(allHtml, /data-island="backend\.search-filter"/)
  // The legacy GET box is gone, not merely hidden behind the new bar.
  assert.doesNotMatch(allHtml, /name="q"[^>]*data-ui="chrome-search-input"/)
  assert.match(allHtml, /data-row="hotel"/)
  assert.match(allHtml, /data-row="homestay"/)

  const searched = await (await app.client.get(`${PROPERTIES}?lang=vi&q=Homestay`)).text()
  assert.match(searched, /data-row="homestay"/)
  assert.doesNotMatch(searched, /data-row="hotel"/)

  const hotels = await (await app.client.get(`${PROPERTIES}?lang=vi&preset=hotel`)).text()
  assert.match(hotels, /data-row="hotel"/)
  assert.doesNotMatch(hotels, /data-row="homestay"/)

  // Alternatives within one group, so asking for both keeps both houses.
  const both = await (await app.client.get(`${PROPERTIES}?lang=vi&preset=hotel&preset=homestay`)).text()
  assert.match(both, /data-row="hotel"/)
  assert.match(both, /data-row="homestay"/)

  // Groups accumulate, so a type and an attention that nothing has match none.
  const contradiction = await (
    await app.client.get(`${PROPERTIES}?lang=vi&preset=hotel&preset=needsAttention`)
  ).text()
  assert.doesNotMatch(contradiction, /data-row="hotel"|data-row="homestay"/)

  const grouped = await (await app.client.get(`${PROPERTIES}?lang=vi&group=accommodationType`)).text()
  assert.match(grouped, /data-ui="kt-group-toggle"/)
  assert.doesNotMatch(grouped, /data-ui="kt-row"/)
  const open = grouped.match(/data-ui="kt-group-toggle" href="([^"]+)" aria-expanded="false"/)
  assert.ok(open, 'a group must be expandable')
  assert.match(await (await app.client.get(open[1]!.replaceAll('&amp;', '&'))).text(), /data-ui="kt-row"/)
})

test('hospitality lists HTTP: the bar applies and saves searches through the shared functions', async (t) => {
  const app = await boot(t)
  const returnTo = `${PROPERTIES}?lang=vi`

  const applied = await app.client.call<{ href: string }>('hospitality_core.applySearchFilter', {
    listKey: 'hospitality.properties',
    returnTo,
    query: 'Ket',
    facets: [{ id: 'preset:homestay', type: 'filter', label: 'Homestay' }],
    groupBy: ['city'],
    customFilters: [],
  })
  const href = new URL(applied.value.href, 'http://ket.local')
  assert.equal(href.pathname, PROPERTIES)
  assert.equal(href.searchParams.get('q'), 'Ket')
  assert.deepEqual(href.searchParams.getAll('preset'), ['homestay'])
  assert.deepEqual(href.searchParams.getAll('group'), ['city'])

  const favorite = await app.client.call<{ id: string }>('hospitality_core.saveSearchFavorite', {
    name: 'Nhà dân đang mở',
    isDefault: true,
    state: {
      listKey: 'hospitality.properties',
      returnTo,
      facets: [{ id: 'preset:homestay', type: 'filter', label: 'Homestay' }],
      groupBy: [],
      customFilters: [],
    },
  })
  const reopened = await app.client.call<{ href: string }>('hospitality_core.applySearchFilter', {
    listKey: 'hospitality.properties',
    returnTo,
    favoriteId: favorite.value.id,
    facets: [],
    groupBy: [],
    customFilters: [],
  })
  assert.deepEqual(new URL(reopened.value.href, 'http://ket.local').searchParams.getAll('preset'), [
    'homestay',
  ])
  assert.match(await (await app.client.get(returnTo)).text(), /Nhà dân đang mở/)

  await app.client.call('hospitality_core.deleteSearchFavorite', {
    listKey: 'hospitality.properties',
    id: favorite.value.id,
  })
  assert.doesNotMatch(await (await app.client.get(returnTo)).text(), /Nhà dân đang mở/)
})

test('hospitality lists HTTP: every migrated hospitality list carries the bar', async (t) => {
  const app = await boot(t)
  for (const path of [
    '/admin/hospitality/properties',
    '/admin/hospitality/stays',
    '/admin/hospitality/folios',
    '/admin/hospitality/amenities',
    '/admin/hospitality/policies',
  ]) {
    const response = await app.client.get(`${path}?lang=vi`)
    const html = await response.text()
    assert.equal(response.status, 200, path)
    assert.match(html, /data-island="backend\.search-filter"/, path)
    assert.doesNotMatch(html, /name="q"[^>]*data-ui="chrome-search-input"/, path)
  }
})

test('hospitality amenities HTTP: the scope preset narrows what the list shows', async (t) => {
  const app = await boot(t)
  const path = '/admin/hospitality/amenities'
  const rooms = await (await app.client.get(`${path}?lang=vi&preset=room`)).text()
  assert.match(rooms, /data-row="balcony"/)
  assert.doesNotMatch(rooms, /data-row="pool"/)
  const searched = await (await app.client.get(`${path}?lang=vi&q=POOL`)).text()
  assert.match(searched, /data-row="pool"/)
  assert.doesNotMatch(searched, /data-row="balcony"/)
})
