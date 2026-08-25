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
  for (const fnKey of [
    'crm.case.list',
    'crm.case.get',
    'crm.overview',
    'crm.case.move',
    'crm.case.assign',
    'crm.case.markWon',
    'crm.case.markLost',
    'crm.case.save',
    'crm.activity.schedule',
    'crm.activity.complete',
    'activity.listTypes',
  ])
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
  await fixture(
    'crm.team.save',
    {
      values: {
        id: 'crm-team-sales',
        code: 'sales',
        name: 'Sales',
        leaderUserId: 'admin',
        assignmentMode: 'manual',
        expectedVersion: 1,
      },
      idempotencyKey: 'staff-crm-team-leader',
    },
    'admin',
  )

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

test('staff CRM overview aggregates the complete actor-visible pipeline', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'crm-user', password: 'correct horse battery' })

  assert.equal((await e2e.client.get('/api/staff/v1/crm/overview')).status, 422)
  const response = await e2e.client.json<Envelope<Row>>('/api/staff/v1/crm/overview?today=2026-08-28')
  assert.deepEqual(response.data, {
    leadCount: 1,
    opportunityCount: 2,
    openOpportunityCount: 1,
    overdueActivityCount: 1,
    expectedRevenue: '2400',
    asOf: '2026-08-28',
  })
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

const mutationHeaders = (csrfToken: string, key?: string) => ({
  'content-type': 'application/json',
  'x-csrf-token': csrfToken,
  ...(key ? { 'idempotency-key': key } : {}),
})

test('staff CRM commands enforce CSRF, idempotency, schema and optimistic concurrency', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'crm-user', password: 'correct horse battery' })
  const bootstrap = await e2e.client.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')
  const csrf = bootstrap.data.csrfToken
  const path = '/api/staff/v1/crm/leads/lead-a/transition'
  const body = { stageId: 'crm-stage-qualified', expectedVersion: 1 }

  assert.equal(
    (
      await e2e.client.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'crm-transition-1' },
        body: JSON.stringify(body),
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await e2e.client.request(path, {
        method: 'POST',
        headers: mutationHeaders(csrf),
        body: JSON.stringify(body),
      })
    ).status,
    400,
  )
  assert.equal(
    (
      await e2e.client.request(path, {
        method: 'POST',
        headers: mutationHeaders(csrf, 'crm-transition-invalid'),
        body: JSON.stringify({ ...body, companyId: 'other' }),
      })
    ).status,
    422,
  )

  const moved = await e2e.client.request(path, {
    method: 'POST',
    headers: mutationHeaders(csrf, 'crm-transition-1'),
    body: JSON.stringify(body),
  })
  assert.equal(moved.status, 200)
  assert.equal(moved.headers.get('etag'), '"2"')
  const movedBody = (await moved.json()) as Envelope<{ outcome: string; lead: Row }>
  assert.equal(movedBody.data.outcome, 'transitioned')
  assert.equal((movedBody.data.lead.stage as Row).id, 'crm-stage-qualified')
  assert.equal(movedBody.data.lead.version, 2)

  const replay = await e2e.client.request(path, {
    method: 'POST',
    headers: mutationHeaders(csrf, 'crm-transition-1'),
    body: JSON.stringify(body),
  })
  assert.equal(replay.status, 200)
  assert.equal(((await replay.json()) as Envelope<{ lead: Row }>).data.lead.version, 2)

  const changedReplay = await e2e.client.request(path, {
    method: 'POST',
    headers: mutationHeaders(csrf, 'crm-transition-1'),
    body: JSON.stringify({ stageId: 'crm-stage-new', expectedVersion: 2 }),
  })
  assert.equal(changedReplay.status, 409)
  assert.equal(
    ((await changedReplay.json()) as Envelope<null>).error?.code,
    'channel_api.idempotencyConflict',
  )

  const stale = await e2e.client.request(path, {
    method: 'POST',
    headers: mutationHeaders(csrf, 'crm-transition-stale'),
    body: JSON.stringify(body),
  })
  assert.equal(stale.status, 409)
  assert.equal(((await stale.json()) as Envelope<null>).error?.code, 'crm.error.stageConflict')
})

test('staff CRM assign and won commands return the refreshed safe projection', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'crm-user', password: 'correct horse battery' })
  const bootstrap = await e2e.client.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')
  const csrf = bootstrap.data.csrfToken

  const assigned = await e2e.client.request('/api/staff/v1/crm/leads/lead-a/assign', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'crm-assign-admin'),
    body: JSON.stringify({ assigneeUserId: 'admin', expectedVersion: 1 }),
  })
  assert.equal(assigned.status, 200)
  const assignedBody = (await assigned.json()) as Envelope<{ outcome: string; lead: Row }>
  assert.equal(assignedBody.data.outcome, 'assigned')
  assert.deepEqual(assignedBody.data.lead.assignee, { id: 'admin', name: 'Administrator' })
  assert.equal(assignedBody.data.lead.version, 2)
  assert.equal('email' in assignedBody.data.lead, false)
  assert.equal('timeline' in assignedBody.data.lead, false)

  const won = await e2e.client.request('/api/staff/v1/crm/leads/opportunity-open/won', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'crm-opportunity-won'),
    body: JSON.stringify({ expectedVersion: 1 }),
  })
  assert.equal(won.status, 200)
  const wonBody = (await won.json()) as Envelope<{ outcome: string; lead: Row }>
  assert.equal(wonBody.data.outcome, 'won')
  assert.equal(wonBody.data.lead.outcome, 'won')
  assert.equal(wonBody.data.lead.version, 2)

  const hidden = await e2e.client.request('/api/staff/v1/crm/leads/admin-only/transition', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'crm-hidden-transition'),
    body: JSON.stringify({ stageId: 'crm-stage-qualified', expectedVersion: 1 }),
  })
  assert.equal(hidden.status, 404)
})

test('staff CRM creates actor-visible leads and marks opportunities lost', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'crm-user', password: 'correct horse battery' })
  const bootstrap = await e2e.client.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')
  const csrf = bootstrap.data.csrfToken

  const created = await e2e.client.request('/api/staff/v1/crm/leads/create', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'crm-create-mobile-lead'),
    body: JSON.stringify({
      name: 'Lead created from staff channel',
      type: 'lead',
      partnerId: 'customer',
      expectedRevenue: '7500',
    }),
  })
  assert.equal(created.status, 200)
  const createdBody = (await created.json()) as Envelope<{ outcome: string; lead: Row }>
  assert.equal(createdBody.data.outcome, 'created')
  assert.equal(createdBody.data.lead.name, 'Lead created from staff channel')
  assert.equal(createdBody.data.lead.expectedRevenue, '7500')
  assert.equal(createdBody.data.lead.version, 1)
  assert.match(String(createdBody.data.lead.id), /^[0-9a-f-]{36}$/)

  const lost = await e2e.client.request('/api/staff/v1/crm/leads/opportunity-open/lost', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'crm-opportunity-lost'),
    body: JSON.stringify({ expectedVersion: 1, lostReason: 'Budget deferred' }),
  })
  assert.equal(lost.status, 200)
  const lostBody = (await lost.json()) as Envelope<{ outcome: string; lead: Row }>
  assert.equal(lostBody.data.outcome, 'lost')
  assert.equal(lostBody.data.lead.outcome, 'lost')
  assert.equal(lostBody.data.lead.version, 2)
})

test('staff CRM schedules and completes only activities belonging to the addressed lead', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'crm-user', password: 'correct horse battery' })
  const bootstrap = await e2e.client.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')
  const csrf = bootstrap.data.csrfToken

  const scheduled = await e2e.client.request('/api/staff/v1/crm/leads/lead-a/activities', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'crm-schedule-mobile-activity'),
    body: JSON.stringify({
      activityTypeId: 'crm-next-action',
      dueDate: '2026-08-26',
      expectedVersion: 1,
    }),
  })
  assert.equal(scheduled.status, 200)
  const scheduledBody = (await scheduled.json()) as Envelope<{ outcome: string; lead: Row }>
  assert.equal(scheduledBody.data.outcome, 'activity_scheduled')
  const nextActivity = scheduledBody.data.lead.nextActivity as Row
  assert.equal(nextActivity.summary, 'CRM next action')
  assert.equal(nextActivity.dueDate, '2026-08-26')

  const wrongLead = await e2e.client.request(
    `/api/staff/v1/crm/leads/opportunity-open/activities/${String(nextActivity.id)}/complete`,
    {
      method: 'POST',
      headers: mutationHeaders(csrf, 'crm-complete-wrong-lead'),
      body: JSON.stringify({ expectedVersion: 1, completedDate: '2026-08-25' }),
    },
  )
  assert.equal(wrongLead.status, 404)

  const completed = await e2e.client.request(
    `/api/staff/v1/crm/leads/lead-a/activities/${String(nextActivity.id)}/complete`,
    {
      method: 'POST',
      headers: mutationHeaders(csrf, 'crm-complete-mobile-activity'),
      body: JSON.stringify({ expectedVersion: 1, completedDate: '2026-08-25' }),
    },
  )
  assert.equal(completed.status, 200)
  const completedBody = (await completed.json()) as Envelope<{ outcome: string; lead: Row }>
  assert.equal(completedBody.data.outcome, 'activity_completed')
  assert.equal((completedBody.data.lead.nextActivity as Row).id, 'activity-a')

  const stale = await e2e.client.request('/api/staff/v1/crm/leads/lead-a/activities', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'crm-schedule-stale-version'),
    body: JSON.stringify({
      activityTypeId: 'crm-next-action',
      dueDate: '2026-08-28',
      expectedVersion: 99,
    }),
  })
  assert.equal(stale.status, 409)
  assert.equal(((await stale.json()) as Envelope<null>).error?.code, 'crm.error.stageConflict')
})

test('staff CRM commands that create a record replay under the same idempotency key', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'crm-user', password: 'correct horse battery' })
  const bootstrap = await e2e.client.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')
  const csrf = bootstrap.data.csrfToken

  // A retry is the whole reason the key exists. If the id were minted fresh per
  // attempt the retry would look like a different request and be refused as a
  // conflict — which tells a caller its create failed when it succeeded, and
  // invites a retry under a new key that finally writes the duplicate.
  const createLead = () =>
    e2e.client.request('/api/staff/v1/crm/leads/create', {
      method: 'POST',
      headers: mutationHeaders(csrf, 'crm-create-retry'),
      body: JSON.stringify({ name: 'Retried lead', type: 'lead', expectedRevenue: '100' }),
    })
  const created = await createLead()
  assert.equal(created.status, 200)
  const createdId = String(((await created.json()) as Envelope<{ lead: Row }>).data.lead.id)
  const replayed = await createLead()
  assert.equal(replayed.status, 200)
  assert.equal(String(((await replayed.json()) as Envelope<{ lead: Row }>).data.lead.id), createdId)
  const listed = (await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/crm/leads?limit=50')).data
  assert.equal(listed.items.filter((item) => String(item.name) === 'Retried lead').length, 1)

  const scheduleActivity = () =>
    e2e.client.request('/api/staff/v1/crm/leads/lead-a/activities', {
      method: 'POST',
      headers: mutationHeaders(csrf, 'crm-schedule-retry'),
      body: JSON.stringify({
        activityTypeId: 'crm-next-action',
        dueDate: '2026-08-27',
        expectedVersion: 1,
      }),
    })
  const scheduled = await scheduleActivity()
  assert.equal(scheduled.status, 200)
  const replayedSchedule = await scheduleActivity()
  assert.equal(replayedSchedule.status, 200)
})
