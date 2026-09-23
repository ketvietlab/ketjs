// The search-filter bar over the loyalty lists.
//
// Programs, wallets, the ledger and memberships are paged by their own domain
// functions, so what is worth proving over real HTTP is that the bar's URL is
// the one the route pushes down into those calls: a query, a state preset, and a
// favourite that survives a round trip. Tiers are held in memory and narrow the
// ordinary way.
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const PROGRAMS = '/admin/loyalty/programs'

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })
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
  const call = <T = unknown>(name: string, input: Record<string, unknown> = {}) =>
    app.client.call<T>(name, input)
  for (const [id, name, programType] of [
    ['ket-club', 'Két Club', 'loyalty'],
    ['gift-cards', 'Thẻ quà tặng', 'gift_card'],
  ])
    await call('loyalty.program.save', {
      id,
      name,
      programType,
      sequence: 10,
      currency: 'VND',
      appliesOn: 'future',
      trigger: 'auto',
      portalVisible: true,
      pointName: 'Điểm',
      availableSale: true,
      availablePos: true,
    })
  for (const [id, code, name, sequence] of [
    ['silver', 'SILVER', 'Bạc', 10],
    ['gold', 'GOLD', 'Vàng', 20],
  ])
    await call('loyalty.tier.save', {
      id,
      code,
      name,
      minimumSpend: '0',
      redeemPercent: '1',
      windowMonths: 12,
      sequence,
    })
  return app
}

test('loyalty programs HTTP: the bar owns the query and the program-type presets', async (t) => {
  const app = await boot(t)

  const all = await app.client.get(`${PROGRAMS}?lang=vi`)
  const allHtml = await all.text()
  assert.equal(all.status, 200)
  assert.match(allHtml, /data-island="backend\.search-filter"/)
  assert.match(allHtml, /Két Club/)
  assert.match(allHtml, /Thẻ quà tặng/)

  const searched = await (await app.client.get(`${PROGRAMS}?lang=vi&q=quà`)).text()
  assert.match(searched, /Thẻ quà tặng/)
  assert.doesNotMatch(searched, /Két Club/)

  // The domain function takes one program type, and the preset is how it is said.
  const giftCards = await (await app.client.get(`${PROGRAMS}?lang=vi&preset=gift_card`)).text()
  assert.match(giftCards, /Thẻ quà tặng/)
  assert.doesNotMatch(giftCards, /Két Club/)
})

test('loyalty tiers HTTP: the in-memory list narrows and groups the ordinary way', async (t) => {
  const app = await boot(t)
  const tiers = await (await app.client.get('/admin/loyalty/tiers?lang=vi&q=Vàng')).text()
  assert.match(tiers, /data-island="backend\.search-filter"/)
  assert.match(tiers, /Vàng/)
  assert.doesNotMatch(tiers, /data-row="silver"/)
})

test('loyalty lists HTTP: the bar applies and saves searches through the shared functions', async (t) => {
  const app = await boot(t)
  const returnTo = `${PROGRAMS}?lang=vi`

  const applied = await app.client.call<{ href: string }>('loyalty_backend.applySearchFilter', {
    listKey: 'loyalty.programs',
    returnTo,
    query: 'Club',
    facets: [{ id: 'preset:running', type: 'filter', label: 'Running' }],
    groupBy: [],
    customFilters: [],
  })
  const href = new URL(applied.value.href, 'http://ket.local')
  assert.equal(href.pathname, PROGRAMS)
  assert.equal(href.searchParams.get('q'), 'Club')
  assert.deepEqual(href.searchParams.getAll('preset'), ['running'])

  const favorite = await app.client.call<{ id: string }>('loyalty_backend.saveSearchFavorite', {
    name: 'Thẻ quà đang chạy',
    isDefault: true,
    state: {
      listKey: 'loyalty.programs',
      returnTo,
      facets: [{ id: 'preset:gift_card', type: 'filter', label: 'Gift card' }],
      groupBy: [],
      customFilters: [],
    },
  })
  assert.match(await (await app.client.get(returnTo)).text(), /Thẻ quà đang chạy/)
  await app.client.call('loyalty_backend.deleteSearchFavorite', {
    listKey: 'loyalty.programs',
    id: favorite.value.id,
  })
  assert.doesNotMatch(await (await app.client.get(returnTo)).text(), /Thẻ quà đang chạy/)
})

test('loyalty lists HTTP: every loyalty list carries the bar', async (t) => {
  const app = await boot(t)
  for (const path of [
    PROGRAMS,
    '/admin/loyalty/wallets',
    '/admin/loyalty/ledger',
    '/admin/loyalty/memberships',
    '/admin/loyalty/tiers',
  ]) {
    const response = await app.client.get(`${path}?lang=vi`)
    const html = await response.text()
    assert.equal(response.status, 200, path)
    assert.match(html, /data-island="backend\.search-filter"/, path)
  }
})
