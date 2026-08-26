import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

async function bootManufacturing(t: TestContext) {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input, { scope })

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
  await fixture('product.saveTemplate', {
    id: 'basket-template',
    name: 'Giỏ trái cây',
    type: 'goods',
    uomId: 'kg',
    listPrice: '0',
  })
  await fixture('product.saveVariant', {
    id: 'basket',
    templateId: 'basket-template',
    combinationKey: '',
    defaultCode: 'BASKET',
  })
  for (const [id, name, usage] of [
    ['stock', 'Stock', 'internal'],
    ['production', 'Production', 'production'],
    ['finished', 'Finished goods', 'internal'],
  ])
    await fixture('stock.saveLocation', { id, name, usage })
  await fixture('manufacturing.saveBom', {
    id: 'basket-bom',
    code: 'BASKET-01',
    productId: 'basket',
    productQty: '1',
    productUomId: 'kg',
    lines: [],
    operations: [],
  })
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  return e2e
}

const productionForm = (name: string, bomId = 'basket-bom') =>
  new URLSearchParams({
    name,
    bomId,
    productQty: '12.5',
    productUomId: 'kg',
    sourceLocationId: 'stock',
    productionLocationId: 'production',
    destinationLocationId: 'finished',
    scheduledStart: '2026-08-28T08:30',
  })

test('manufacturing orders HTTP: split list/create preserves validation, locale, CSRF and legacy POST', async (t) => {
  const e2e = await bootManufacturing(t)

  const list = await (await e2e.client.get('/admin/manufacturing?lang=vi')).text()
  assert.match(list, /data-ui="list-page"/)
  assert.match(list, /href="\/admin\/manufacturing\/new\?lang=vi"/)
  assert.doesNotMatch(list, /data-ui="record-form"|manufacturing-order-create-form/)

  const create = await (await e2e.client.get('/admin/manufacturing/new?lang=vi')).text()
  assert.match(
    create,
    /data-ui="form-page" data-scope="manufacturing-order-create-form-page" data-has-aside="false"/,
  )
  assert.match(create, /id="manufacturing-order-create-form"/)
  assert.match(create, /action="\/admin\/manufacturing\/new\?lang=vi"/)
  assert.match(create, /href="\/admin\/manufacturing\?lang=vi"/)
  for (const field of [
    'name',
    'bomId',
    'productQty',
    'productUomId',
    'sourceLocationId',
    'productionLocationId',
    'destinationLocationId',
    'scheduledStart',
  ])
    assert.match(create, new RegExp(`name="${field}"`), field)
  assert.doesNotMatch(create, /form-page-aside|mail\.chatter|activity\.record/)

  const invalid = await e2e.client.post(
    '/admin/manufacturing/new?lang=vi',
    productionForm('MO/INVALID', 'missing-bom'),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(invalid.status, 200)
  const invalidHtml = await invalid.text()
  assert.match(invalidHtml, /bomId: Bản ghi không tồn tại\./)
  assert.match(invalidHtml, /name="name"[^>]*value="MO\/INVALID"/)
  assert.match(invalidHtml, /<option value="missing-bom" selected="true">/)
  assert.match(invalidHtml, /name="productQty"[^>]*value="12.5"/)
  assert.match(invalidHtml, /name="scheduledStart"[^>]*value="2026-08-28T08:30"/)

  const refused = await e2e.client.post('/admin/manufacturing/new?lang=en', productionForm('MO/CROSS-SITE'), {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://cross-site.example',
    },
    redirect: 'manual',
  })
  assert.equal(refused.status, 403)

  const created = await e2e.client.post('/admin/manufacturing/new?lang=en', productionForm('MO/0001'), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(created.status, 303)
  assert.equal(created.headers.get('location'), '/admin/manufacturing?lang=en')

  const createdRows = await e2e.client.call<Row[]>('manufacturing.listProductions', {})
  const createdId = String(createdRows.value.find((row) => row.name === 'MO/0001')?.id)
  const detail = await (await e2e.client.get(`/admin/manufacturing/orders/${createdId}?lang=en`)).text()
  assert.match(detail, new RegExp(`action="/admin/manufacturing/orders/${createdId}\\?lang=en"`))
  const confirmed = await e2e.client.post(
    `/admin/manufacturing/orders/${createdId}?lang=en`,
    new URLSearchParams({ action: 'confirm' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(confirmed.status, 303)
  assert.equal(confirmed.headers.get('location'), `/admin/manufacturing/orders/${createdId}?lang=en`)

  const englishList = await (await e2e.client.get('/admin/manufacturing?lang=en')).text()
  assert.match(englishList, /MO\/0001/)
  assert.match(englishList, /Giỏ trái cây/)
  assert.match(englishList, /data-row-href="\/admin\/manufacturing\/orders\/[^"]+\?lang=en"/)

  const legacyForm = productionForm('MO/LEGACY')
  legacyForm.set('id', 'legacy-order')
  const legacyCreated = await e2e.client.post('/admin/manufacturing?lang=vi', legacyForm, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(legacyCreated.status, 303)
  assert.equal(legacyCreated.headers.get('location'), '/admin/manufacturing?lang=vi')

  const productions = await e2e.client.call<Row[]>('manufacturing.listProductions', {})
  assert.deepEqual(productions.value.map((row) => row.name).sort(), ['MO/0001', 'MO/LEGACY'])
  assert.equal(
    (await e2e.client.call<Row>('manufacturing.getProduction', { id: 'legacy-order' })).value.name,
    'MO/LEGACY',
  )
})
