import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

type Envelope<T> = { data: T; error: { code: string } | null }

const boot = async (t: TestContext) => {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    e2e.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'Kết Việt' })
  await fixture('company.saveCompany', {
    id: 'acme',
    code: 'ACME',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  await fixture('user.createUser', {
    id: 'report-user',
    login: 'report-user',
    password: 'correct horse battery',
    name: 'Report User',
    defaultCompanyId: 'acme',
    superuser: false,
  })
  await fixture('user.grantCompany', {
    id: 'report-user:acme',
    userId: 'report-user',
    companyId: 'acme',
  })
  await fixture('user.saveRole', { id: 'report-reader', name: 'Report reader' })
  for (const fnKey of [
    'company.getCompany',
    'sale.listOrders',
    'account.listMoves',
    'account.listOpenItems',
    'stock.listPickingViews',
    'partner.listPartners',
  ])
    await fixture('user.grantFunction', {
      id: `report-reader:${fnKey}`,
      roleId: 'report-reader',
      fnKey,
    })
  await fixture('user.assignRole', {
    id: 'report-user:report-reader',
    userId: 'report-user',
    roleId: 'report-reader',
  })
  return e2e
}

test('staff business report returns a complete zero-safe cross-domain snapshot', async (t) => {
  const e2e = await boot(t)
  assert.equal((await e2e.client.get('/api/staff/v1/reports/business-overview')).status, 401)
  await e2e.client.login({ login: 'report-user', password: 'correct horse battery' })

  const response = await e2e.client.get('/api/staff/v1/reports/business-overview?period=this_week')
  assert.equal(response.status, 200)
  const body = (await response.json()) as Envelope<Row>
  assert.deepEqual(body.data.company, { name: 'Kết Việt', currency: 'VND' })
  assert.equal((body.data.period as Row).key, 'this_week')
  assert.equal((body.data.period as Row).timezone, 'UTC')
  assert.equal((body.data.trend as Row[]).length, 7)
  assert.deepEqual(body.data.operations, { pendingOutboundPickings: 0, activeDeliveries: 0 })
  assert.deepEqual(
    (body.data.pipeline as Row[]).map((entry) => entry.state),
    ['draft', 'sent', 'confirmed', 'cancelled'],
  )
  assert.deepEqual(body.data.topCustomers, [])
  assert.deepEqual(body.data.recentOrders, [])

  assert.equal(
    (await e2e.client.get('/api/staff/v1/reports/business-overview?period=unsupported')).status,
    422,
  )
})
