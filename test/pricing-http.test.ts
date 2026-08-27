import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const post = { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' as const }
const hidden = (html: string, name: string): string => {
  const match = html.match(new RegExp(`name="${name}" value="([^"]*)"`))
  assert.ok(match, `missing ${name}`)
  return match[1]!
}

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

test('pricing HTTP keeps collection context, stable create identity and rejected rule values', async (t) => {
  const app = await boot(t)
  const createPath = '/admin/pricing/pricelists?lang=en&create=1'
  const create = await app.client.get(createPath)
  const createHtml = await create.text()
  assert.equal(create.status, 200)
  assert.match(createHtml, /data-ui="list-page"/)
  assert.match(createHtml, /data-ui="modal-layer" data-route-modal="true"/)
  const id = hidden(createHtml, 'id')

  const rejected = await app.client.post(
    createPath,
    new URLSearchParams({ action: 'create', id, name: '', sequence: '8' }),
    post,
  )
  const rejectedHtml = await rejected.text()
  assert.equal(rejected.status, 200)
  assert.equal(hidden(rejectedHtml, 'id'), id)
  assert.match(rejectedHtml, /data-ui="form-errors" role="alert"/)

  const saved = await app.client.post(
    createPath,
    new URLSearchParams({ action: 'create', id, name: 'Retail', sequence: '8' }),
    post,
  )
  assert.equal(saved.status, 303)
  assert.equal(saved.headers.get('location'), '/admin/pricing/pricelists?lang=en')

  const detailPath = `/admin/pricing/pricelists/${id}?lang=en`
  const detail = await app.client.get(detailPath)
  const detailHtml = await detail.text()
  assert.equal(detail.status, 200)
  assert.match(detailHtml, /data-ui="form-page" data-scope="pricelist-detail-page"/)
  const ruleId = hidden(detailHtml.match(/name="action" value="add-item"[\s\S]*/)?.[0] ?? detailHtml, 'id')

  const invalidRule = await app.client.post(
    detailPath,
    new URLSearchParams({
      action: 'add-item',
      id: ruleId,
      appliedOn: '3_global',
      minQuantity: '-1',
      base: 'list_price',
      computePrice: 'fixed',
    }),
    post,
  )
  const invalidHtml = await invalidRule.text()
  assert.equal(invalidRule.status, 200)
  assert.match(invalidHtml, new RegExp(`name="id" value="${ruleId}"`))
  assert.match(invalidHtml, /name="minQuantity"[^>]*value="-1"/)
  assert.equal(
    (await app.client.post(detailPath, new URLSearchParams({ action: 'unknown' }), post)).status,
    400,
  )
})
