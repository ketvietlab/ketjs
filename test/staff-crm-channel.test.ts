import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import { TERMINAL_STATES } from '../packages/ketsuite/src/modules/crm/types.ts'

type Envelope<T> = { data: T; error: { code: string } | null }

const boot = async (t: TestContext) => {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const fixture = <T = Row>(name: string, input: Record<string, unknown>, actor?: string) =>
    e2e.fixture.call<T>(name, input, { scope, actor }).then((result) => result.value)

  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'Kết Việt' })
  await fixture('partner.savePartner', {
    id: 'customer',
    kind: 'company',
    name: 'Khách hàng CRM',
    email: 'private@example.test',
    phone: '0900000000',
  })
  await fixture('company.saveCompany', {
    id: 'acme',
    code: 'ACME',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse battery',
    name: 'Administrator',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', {
    id: 'admin:acme',
    userId: 'admin',
    companyId: 'acme',
  })
  await fixture('user.createUser', {
    id: 'crm-user',
    login: 'crm-user',
    password: 'correct horse battery',
    name: 'CRM Operator',
    defaultCompanyId: 'acme',
    superuser: false,
  })
  await fixture('user.grantCompany', {
    id: 'crm-user:acme',
    userId: 'crm-user',
    companyId: 'acme',
  })
  await fixture('user.saveRole', { id: 'crm-reader', name: 'CRM reader' })
  for (const fnKey of ['crm.case.list', 'crm.case.get', 'activity.listTypes'])
    await fixture('user.grantFunction', {
      id: `crm-reader:${fnKey}`,
      roleId: 'crm-reader',
      fnKey,
    })
  await fixture('user.assignRole', {
    id: 'crm-user:crm-reader',
    userId: 'crm-user',
    roleId: 'crm-reader',
  })
  await fixture('crm.bootstrap.defaults', { idempotencyKey: 'staff-crm-defaults' }, 'admin')

  const lead = await fixture<Row>(
    'crm.case.save',
    {
      id: 'lead-a',
      kind: 'lead',
      name: 'Retail expansion lead',
      partnerId: 'customer',
      assigneeUserId: 'crm-user',
      priority: '2',
      description: 'Internal qualification notes',
      expectedRevenue: '1200',
      probability: '25',
      expectedClosing: '2026-09-30',
      idempotencyKey: 'staff-crm-lead-a',
    },
    'crm-user',
  )
  assert.equal(lead.ok, true)
  await fixture(
    'crm.activity.schedule',
    {
      id: 'activity-a',
      caseId: 'lead-a',
      assigneeUserId: 'crm-user',
      summary: 'Call the buyer',
      dueDate: '2026-08-27',
      idempotencyKey: 'staff-crm-activity-a',
    },
    'crm-user',
  )

  await fixture(
    'crm.case.save',
    {
      id: 'opportunity-open',
      kind: 'opportunity',
      name: 'Open opportunity',
      expectedRevenue: '2400',
      probability: '50',
      idempotencyKey: 'staff-crm-opportunity-open',
    },
    'crm-user',
  )
  const won = await fixture<Row>(
    'crm.case.save',
    {
      id: 'opportunity-won',
      kind: 'opportunity',
      name: 'Won opportunity',
      expectedRevenue: '3600',
      probability: '100',
      idempotencyKey: 'staff-crm-opportunity-won',
    },
    'crm-user',
  )
  await fixture(
    'crm.case.markWon',
    {
      id: 'opportunity-won',
      expectedVersion: won.version,
      idempotencyKey: 'staff-crm-mark-won',
    },
    'crm-user',
  )
  await fixture(
    'crm.case.save',
    {
      id: 'admin-only',
      kind: 'lead',
      name: 'Admin-only lead',
      assigneeUserId: 'admin',
      idempotencyKey: 'staff-crm-admin-only',
    },
    'admin',
  )
  return e2e
}

test('staff CRM channel requires a session and pages bounded pipeline summaries', async (t) => {
  const e2e = await boot(t)
  assert.equal((await e2e.client.get('/api/staff/v1/crm/leads')).status, 401)
  await e2e.client.login({ login: 'crm-user', password: 'correct horse battery' })

  const first = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      '/api/staff/v1/crm/leads?limit=2',
    )
  ).data
  assert.equal(first.items.length, 2)
  assert.ok(first.nextCursor)

  const second = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      `/api/staff/v1/crm/leads?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
    )
  ).data
  assert.equal(second.items.length, 1)
  assert.equal(second.nextCursor, null)
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 3)
})

test('staff CRM channel filters only the domain-supported type, outcome and search values', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'crm-user', password: 'correct horse battery' })

  const searched = (await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/crm/leads?query=Retail'))
    .data
  assert.deepEqual(
    searched.items.map((item) => item.id),
    ['lead-a'],
  )

  const opportunities = (
    await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/crm/leads?type=opportunity')
  ).data
  assert.deepEqual(opportunities.items.map((item) => item.id).sort(), ['opportunity-open', 'opportunity-won'])

  const won = (await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/crm/leads?outcome=won')).data
  assert.deepEqual(
    won.items.map((item) => item.id),
    ['opportunity-won'],
  )

  assert.equal((await e2e.client.get('/api/staff/v1/crm/leads?query=x')).status, 422)
  assert.equal((await e2e.client.get('/api/staff/v1/crm/leads?outcome=unknown')).status, 422)
  // A tenant hint in the query is inert, and that is the property worth holding:
  // the company comes from the session. Refusing the parameter would only have
  // proved the contract does not list it — not that answering ignored it.
  const hinted = (await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/crm/leads?company=other'))
    .data
  const plain = (await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/crm/leads')).data
  assert.deepEqual(
    hinted.items.map((item) => item.id),
    plain.items.map((item) => item.id),
  )
  assert.ok(plain.items.length > 0)
})

test('staff CRM channel returns one narrow read-only detail with the canonical next activity', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'crm-user', password: 'correct horse battery' })

  const response = await e2e.client.json<Envelope<Row>>('/api/staff/v1/crm/leads/lead-a')
  assert.equal(response.data.id, 'lead-a')
  assert.equal(response.data.type, 'lead')
  assert.equal(response.data.expectedRevenue, '1200')
  assert.equal(response.data.probability, '25')
  assert.equal(response.data.outcome, 'pending')
  assert.deepEqual(response.data.customer, { id: 'customer', name: 'Khách hàng CRM' })
  assert.deepEqual(response.data.assignee, { id: 'crm-user', name: 'CRM Operator' })
  assert.deepEqual(response.data.nextActivity, {
    id: 'activity-a',
    type: { id: 'crm-next-action', name: 'CRM next action' },
    summary: 'Call the buyer',
    dueDate: '2026-08-27',
  })
  assert.equal(response.data.readOnly, true)
  assert.equal('email' in response.data, false)
  assert.equal('phone' in response.data, false)
  assert.equal('timeline' in response.data, false)
  assert.equal('messages' in response.data, false)

  const missing = await e2e.client.get('/api/staff/v1/crm/leads/missing')
  assert.equal(missing.status, 404)
  assert.equal(((await missing.json()) as Envelope<null>).error?.code, 'crm_staff_channel.leadNotFound')
  assert.equal((await e2e.client.get('/api/staff/v1/crm/leads/admin-only')).status, 404)
})

test('staff CRM channel tolerates undeclared query parameters like its siblings', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'crm-user', password: 'correct horse battery' })
  // A native client that appends an analytics or cache-busting parameter must not
  // find CRM answering 422 where sales and purchasing answer 200.
  assert.equal((await e2e.client.get('/api/staff/v1/crm/leads?_cacheBust=1')).status, 200)
  // What the contract does declare is still enforced.
  assert.equal((await e2e.client.get('/api/staff/v1/crm/leads?type=nonsense')).status, 422)
  assert.equal((await e2e.client.get('/api/staff/v1/crm/leads?limit=999')).status, 422)
})

test('staff CRM channel publishes the outcome vocabulary its domain defines', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'crm-user', password: 'correct horse battery' })
  // The channel renames one state and owns none of the others, so every terminal
  // state the domain can reach has to be a filter the contract accepts. A state
  // added upstream must not quietly arrive here as "pending".
  for (const state of TERMINAL_STATES) {
    const outcome = state === 'open' ? 'pending' : state
    const response = await e2e.client.get(`/api/staff/v1/crm/leads?outcome=${outcome}`)
    assert.equal(response.status, 200, outcome)
  }
})
