import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

async function bootBoms(t: TestContext) {
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
  for (const [id, name, code] of [
    ['basket', 'Giỏ trái cây', 'BASKET'],
    ['apple', 'Táo', 'APPLE'],
  ]) {
    await fixture('product.saveTemplate', {
      id: `${id}-template`,
      name,
      type: 'goods',
      uomId: 'kg',
      listPrice: '0',
    })
    await fixture('product.saveVariant', {
      id,
      templateId: `${id}-template`,
      combinationKey: '',
      defaultCode: code,
    })
  }
  await fixture('manufacturing.saveBom', {
    id: 'existing-bom',
    code: 'BOM/0001',
    productId: 'basket',
    productQty: '10',
    productUomId: 'kg',
    lines: [],
    operations: [],
  })
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  return e2e
}

const bomForm = (code: string, productId = 'basket') =>
  new URLSearchParams({
    code,
    productId,
    productQty: '12.5',
    productUomId: 'kg',
    componentId: 'apple',
    componentQty: '2',
    componentUomId: 'kg',
    operationName: '',
    workCenterId: '',
    durationExpected: '30',
  })

test('manufacturing BOM HTTP: modal split preserves locale, values, CSRF and legacy POST', async (t) => {
  const e2e = await bootBoms(t)

  const list = await (await e2e.client.get('/admin/manufacturing/boms?lang=vi')).text()
  assert.match(list, /data-ui="list-page"/)
  assert.match(list, /href="\/admin\/manufacturing\/boms\?create=1&amp;lang=vi"/)
  assert.match(list, /BOM\/0001/)
  assert.match(list, /Giỏ trái cây/)
  assert.doesNotMatch(list, /data-ui="record-form"|data-ui="modal-layer"/)

  const modal = await (await e2e.client.get('/admin/manufacturing/boms?create=1&lang=vi')).text()
  assert.match(modal, /data-ui="list-page"/)
  assert.match(modal, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(modal, /action="\/admin\/manufacturing\/boms\/new\?lang=vi"/)
  assert.match(modal, /data-ui="modal-close" href="\/admin\/manufacturing\/boms\?lang=vi"/)
  for (const field of [
    'code',
    'productId',
    'productQty',
    'productUomId',
    'componentId',
    'componentQty',
    'componentUomId',
    'operationName',
    'workCenterId',
    'durationExpected',
  ])
    assert.match(modal, new RegExp(`name="${field}"`), field)

  const compatibility = await e2e.client.get('/admin/manufacturing/boms/new?lang=en', {
    redirect: 'manual',
  })
  assert.equal(compatibility.status, 303)
  assert.equal(compatibility.headers.get('location'), '/admin/manufacturing/boms?create=1&lang=en')

  const refused = await e2e.client.post('/admin/manufacturing/boms/new?lang=en', bomForm('BOM/CROSS'), {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://cross-site.example',
    },
    redirect: 'manual',
  })
  assert.equal(refused.status, 403)

  const invalid = await e2e.client.post(
    '/admin/manufacturing/boms/new?lang=vi',
    bomForm('BOM/INVALID', 'missing-product'),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(invalid.status, 200)
  const invalidHtml = await invalid.text()
  assert.match(invalidHtml, /data-ui="list-page"/)
  assert.match(invalidHtml, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(invalidHtml, /data-ui="form-errors" role="alert"/)
  assert.match(invalidHtml, /name="code"[^>]*value="BOM\/INVALID"/)
  assert.match(invalidHtml, /<option value="missing-product" selected="true">/)
  assert.match(invalidHtml, /name="productQty"[^>]*value="12.5"/)
  assert.match(invalidHtml, /name="componentQty"[^>]*value="2"/)

  const created = await e2e.client.post('/admin/manufacturing/boms/new?lang=en', bomForm('BOM/0002'), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(created.status, 303)
  assert.equal(created.headers.get('location'), '/admin/manufacturing/boms?lang=en')

  const legacyForm = bomForm('BOM/LEGACY')
  legacyForm.set('id', 'legacy-bom')
  const legacy = await e2e.client.post('/admin/manufacturing/boms?lang=vi', legacyForm, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(legacy.status, 303)
  assert.equal(legacy.headers.get('location'), '/admin/manufacturing/boms?lang=vi')

  const boms = await e2e.client.call<Row[]>('manufacturing.listBoms', {})
  assert.deepEqual(boms.value.map((row) => row.code).sort(), ['BOM/0001', 'BOM/0002', 'BOM/LEGACY'])
  assert.equal(
    (await e2e.client.call<Row>('manufacturing.getBom', { id: 'legacy-bom' })).value.code,
    'BOM/LEGACY',
  )
})
