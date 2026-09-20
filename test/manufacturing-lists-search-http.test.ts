// The search-filter bar over the manufacturing lists.
//
// Production orders, bills of materials and work centers each read a bounded
// collection and narrow it in memory, so what is worth proving over real HTTP is
// that the URL the bar writes is the URL the page reads: the query, a state
// preset, a grouped table, and a favourite that survives a round trip.
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const ORDERS = '/admin/manufacturing'

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
  await fixture('uom.saveUnit', { id: 'kg', name: 'kg', relativeFactor: '1' })
  for (const [id, name] of [
    ['basket-template', 'Giỏ trái cây'],
    ['crate-template', 'Thùng gỗ'],
  ])
    await fixture('product.saveTemplate', { id, name, type: 'goods', uomId: 'kg', listPrice: '0' })
  for (const [id, templateId, code] of [
    ['basket', 'basket-template', 'BASKET'],
    ['crate', 'crate-template', 'CRATE'],
  ])
    await fixture('product.saveVariant', { id, templateId, combinationKey: '', defaultCode: code })
  for (const [id, name, usage] of [
    ['stock', 'Stock', 'internal'],
    ['production', 'Production', 'production'],
    ['finished', 'Finished goods', 'internal'],
  ])
    await fixture('stock.saveLocation', { id, name, usage })
  for (const [id, code, productId] of [
    ['basket-bom', 'BASKET-01', 'basket'],
    ['crate-bom', 'CRATE-01', 'crate'],
  ])
    await fixture('manufacturing.saveBom', {
      id,
      code,
      productId,
      productQty: '1',
      productUomId: 'kg',
      lines: [],
      operations: [],
    })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  const call = <T = unknown>(name: string, input: Record<string, unknown> = {}) =>
    app.client.call<T>(name, input)
  await call('manufacturing.saveProduction', {
    id: 'mo-draft',
    name: 'MO-BASKET',
    bomId: 'basket-bom',
    productQty: '1',
    productUomId: 'kg',
    sourceLocationId: 'stock',
    productionLocationId: 'production',
    destinationLocationId: 'finished',
    scheduledStart: '2026-09-21T00:00:00.000Z',
  })
  const confirmed = await call<{ version: number }>('manufacturing.saveProduction', {
    id: 'mo-confirmed',
    name: 'MO-CRATE',
    bomId: 'crate-bom',
    productQty: '2',
    productUomId: 'kg',
    sourceLocationId: 'stock',
    productionLocationId: 'production',
    destinationLocationId: 'finished',
    scheduledStart: '2026-09-21T00:00:00.000Z',
  })
  await call('manufacturing.confirmProduction', { id: 'mo-confirmed', version: confirmed.value.version })
  await call('manufacturing.saveWorkCenter', {
    id: 'assembly',
    code: 'ASM',
    name: 'Lắp ráp',
    capacity: '2',
    timeEfficiency: '100',
    costPerHour: '120000',
  })
  return app
}

test('manufacturing orders HTTP: the bar replaces the GET search and drives the same URL state', async (t) => {
  const app = await boot(t)

  const all = await app.client.get(`${ORDERS}?lang=vi`)
  const allHtml = await all.text()
  assert.equal(all.status, 200)
  assert.match(allHtml, /data-island="backend\.search-filter"/)
  assert.match(allHtml, /data-row="mo-draft"/)
  assert.match(allHtml, /data-row="mo-confirmed"/)

  const searched = await (await app.client.get(`${ORDERS}?lang=vi&q=CRATE`)).text()
  assert.match(searched, /data-row="mo-confirmed"/)
  assert.doesNotMatch(searched, /data-row="mo-draft"/)

  const draft = await (await app.client.get(`${ORDERS}?lang=vi&preset=draft`)).text()
  assert.match(draft, /data-row="mo-draft"/)
  assert.doesNotMatch(draft, /data-row="mo-confirmed"/)

  const grouped = await (await app.client.get(`${ORDERS}?lang=vi&group=state`)).text()
  assert.match(grouped, /data-ui="kt-group-toggle"/)
  assert.doesNotMatch(grouped, /data-ui="kt-row"/)
  const open = grouped.match(/data-ui="kt-group-toggle" href="([^"]+)" aria-expanded="false"/)
  assert.ok(open, 'a group must be expandable')
  assert.match(await (await app.client.get(open[1]!.replaceAll('&amp;', '&'))).text(), /data-ui="kt-row"/)
})

test('manufacturing lists HTTP: the bar applies and saves searches through the shared functions', async (t) => {
  const app = await boot(t)
  const returnTo = `${ORDERS}?lang=vi`

  const applied = await app.client.call<{ href: string }>('manufacturing_backend.applySearchFilter', {
    listKey: 'manufacturing.orders',
    returnTo,
    query: 'CRATE',
    facets: [{ id: 'preset:draft', type: 'filter', label: 'Draft' }],
    groupBy: ['state'],
    customFilters: [],
  })
  const href = new URL(applied.value.href, 'http://ket.local')
  assert.equal(href.pathname, ORDERS)
  assert.equal(href.searchParams.get('q'), 'CRATE')
  assert.deepEqual(href.searchParams.getAll('preset'), ['draft'])
  assert.deepEqual(href.searchParams.getAll('group'), ['state'])

  const favorite = await app.client.call<{ id: string }>('manufacturing_backend.saveSearchFavorite', {
    name: 'Lệnh còn nháp',
    isDefault: true,
    state: {
      listKey: 'manufacturing.orders',
      returnTo,
      facets: [{ id: 'preset:draft', type: 'filter', label: 'Draft' }],
      groupBy: [],
      customFilters: [],
    },
  })
  assert.match(await (await app.client.get(returnTo)).text(), /Lệnh còn nháp/)
  await app.client.call('manufacturing_backend.deleteSearchFavorite', {
    listKey: 'manufacturing.orders',
    id: favorite.value.id,
  })
  assert.doesNotMatch(await (await app.client.get(returnTo)).text(), /Lệnh còn nháp/)
})

test('manufacturing lists HTTP: every manufacturing list carries the bar', async (t) => {
  const app = await boot(t)
  for (const path of [ORDERS, '/admin/manufacturing/boms', '/admin/manufacturing/work-centers']) {
    const response = await app.client.get(`${path}?lang=vi`)
    const html = await response.text()
    assert.equal(response.status, 200, path)
    assert.match(html, /data-island="backend\.search-filter"/, path)
  }
  // The bills of materials narrow by product the same way.
  const boms = await (await app.client.get('/admin/manufacturing/boms?lang=vi&q=CRATE')).text()
  assert.match(boms, /data-row="crate-bom"/)
  assert.doesNotMatch(boms, /data-row="basket-bom"/)
})
