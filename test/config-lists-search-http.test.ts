// The search-filter bar over the configuration lists that had no test of their
// own: address catalogues and pricelists.
//
// Both read a bounded collection and narrow it in memory, so what is worth
// proving over real HTTP is that the URL the bar writes is the URL the page
// reads: the query, a preset, a group, and a favourite that round-trips.
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const CATALOGS = '/admin/addresses'
const PRICELISTS = '/admin/pricing/pricelists'

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
  return app
}

test('address catalogues HTTP: the bar replaces the GET search over the packaged catalogues', async (t) => {
  const app = await boot(t)
  const all = await app.client.get(`${CATALOGS}?lang=vi`)
  const html = await all.text()
  assert.equal(all.status, 200)
  assert.match(html, /data-island="backend\.search-filter"/)
  assert.doesNotMatch(html, /name="q"[^>]*data-ui="chrome-search-input"/)
  assert.match(html, /data-row="VN:/)

  // Nothing is installed in a fresh deployment, so the two presets split the list.
  assert.match(await (await app.client.get(`${CATALOGS}?lang=vi&preset=available`)).text(), /data-row="VN:/)
  assert.doesNotMatch(
    await (await app.client.get(`${CATALOGS}?lang=vi&preset=installed`)).text(),
    /data-row="VN:/,
  )
  assert.match(await (await app.client.get(`${CATALOGS}?lang=vi&q=VN`)).text(), /data-row="VN:/)
  assert.doesNotMatch(await (await app.client.get(`${CATALOGS}?lang=vi&q=ZZ`)).text(), /data-row="VN:/)
  assert.match(
    await (await app.client.get(`${CATALOGS}?lang=vi&group=installed`)).text(),
    /data-ui="kt-group-toggle"/,
  )
})

test('pricelists HTTP: the bar replaces the GET search and drives the same URL state', async (t) => {
  const app = await boot(t)
  await app.client.call('pricing.savePricelist', { id: 'retail', name: 'Retail', sequence: 8, active: true })
  await app.client.call('pricing.savePricelist', { id: 'old', name: 'Kênh cũ', sequence: 9, active: false })

  const all = await (await app.client.get(`${PRICELISTS}?lang=vi`)).text()
  assert.match(all, /data-island="backend\.search-filter"/)
  assert.match(all, /data-row="retail"/)
  assert.match(all, /data-row="old"/)

  const searched = await (await app.client.get(`${PRICELISTS}?lang=vi&q=Retail`)).text()
  assert.match(searched, /data-row="retail"/)
  assert.doesNotMatch(searched, /data-row="old"/)

  const archived = await (await app.client.get(`${PRICELISTS}?lang=vi&preset=archived`)).text()
  assert.match(archived, /data-row="old"/)
  assert.doesNotMatch(archived, /data-row="retail"/)

  const grouped = await (await app.client.get(`${PRICELISTS}?lang=vi&group=state`)).text()
  assert.match(grouped, /data-ui="kt-group-toggle"/)
  assert.doesNotMatch(grouped, /data-ui="kt-row"/)

  const favorite = await app.client.call<{ id: string }>('pricing_backend.saveSearchFavorite', {
    name: 'Bảng giá đã lưu trữ',
    isDefault: true,
    state: {
      listKey: 'pricing.pricelists',
      returnTo: `${PRICELISTS}?lang=vi`,
      facets: [{ id: 'preset:archived', type: 'filter', label: 'Archived' }],
      groupBy: [],
      customFilters: [],
    },
  })
  const reopened = await app.client.call<{ href: string }>('pricing_backend.applySearchFilter', {
    listKey: 'pricing.pricelists',
    returnTo: `${PRICELISTS}?lang=vi`,
    favoriteId: favorite.value.id,
    facets: [],
    groupBy: [],
    customFilters: [],
  })
  assert.deepEqual(new URL(reopened.value.href, 'http://ket.local').searchParams.getAll('preset'), [
    'archived',
  ])
})
