import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

type Envelope<T> = { data: T; error: { code: string; message: string } | null }

const boot = async (t: TestContext) => {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branch: 'hq', branches: ['hq'] }
  const fixture = (name: string, input: Record<string, unknown>) =>
    e2e.fixture.call<Row>(name, input, { scope })

  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'Kết Việt' })
  await fixture('company.saveCompany', {
    id: 'acme',
    code: 'ACME',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  await fixture('company.saveBranch', { id: 'hq', companyId: 'acme', code: 'HQ', name: 'Trụ sở' })
  await fixture('user.createUser', {
    id: 'operator',
    login: 'operator',
    password: 'correct horse battery',
    name: 'Người vận hành',
    defaultCompanyId: 'acme',
    defaultBranchId: 'hq',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'operator:acme', userId: 'operator', companyId: 'acme' })
  await fixture('user.grantBranch', { id: 'operator:hq', userId: 'operator', branchId: 'hq' })
  await fixture('hr.employee.create', {
    id: 'emp-1',
    code: 'E001',
    name: 'Người vận hành',
    userId: 'operator',
    homeBranchId: 'hq',
    timezone: 'Asia/Ho_Chi_Minh',
    startDate: '2026-01-01',
  })
  await e2e.client.login({ login: 'operator', password: 'correct horse battery' })
  // A cookie session has to prove intent on a mutation, and bootstrap is where a
  // staff client is handed the token to do it with.
  const bootstrap = await e2e.client.request('/api/staff/v1/bootstrap')
  const { data } = (await bootstrap.json()) as { data: { csrfToken: string } }
  return { e2e, csrfToken: data.csrfToken }
}

const staff = async <T>(
  booted: { e2e: Awaited<ReturnType<typeof createTestDeployment>>; csrfToken: string },
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Envelope<T> }> => {
  const post = init.method === 'POST'
  const response = await booted.e2e.client.request(`/api/staff/v1/${path}`, {
    ...init,
    headers: post
      ? { 'content-type': 'application/json', 'x-csrf-token': booted.csrfToken, ...(init.headers ?? {}) }
      : init.headers,
    ...(post && !init.body ? { body: '{}' } : {}),
  })
  return { status: response.status, body: (await response.json()) as Envelope<T> }
}

test('staff attendance: an operator clocks their own shift in and out', async (t) => {
  const booted = await boot(t)

  const before = await staff<{ onClock: boolean }>(booted, 'attendance/status')
  assert.equal(before.status, 200)
  assert.equal(before.body.data.onClock, false)

  const started = await staff<{ kind: string; sessionId: string }>(booted, 'attendance/check-in', {
    method: 'POST',
  })
  assert.equal(started.status, 201, JSON.stringify(started.body.error))
  assert.equal(started.body.data.kind, 'in')

  const during = await staff<{ onClock: boolean; sessionId: string }>(booted, 'attendance/status')
  assert.equal(during.body.data.onClock, true)
  assert.equal(during.body.data.sessionId, started.body.data.sessionId)

  const ended = await staff<{ kind: string }>(booted, 'attendance/check-out', { method: 'POST' })
  assert.equal(ended.status, 201)
  assert.equal(ended.body.data.kind, 'out')

  const after = await staff<{ onClock: boolean }>(booted, 'attendance/status')
  assert.equal(after.body.data.onClock, false)

  const records = await staff<Array<{ id: string; state: string }>>(booted, 'attendance/records')
  assert.equal(records.status, 200)
  assert.equal(records.body.data.length, 1)
})

test('staff attendance: a repeated check-in is refused rather than clocking out', async (t) => {
  const booted = await boot(t)
  assert.equal((await staff(booted, 'attendance/check-in', { method: 'POST' })).status, 201)

  // The case that matters over a network: the response was lost and the client
  // tries again. Toggling would have ended the shift the operator just started.
  const again = await staff(booted, 'attendance/check-in', { method: 'POST' })
  assert.equal(again.status, 409)
  assert.equal(again.body.error?.code, 'attendance.error.alreadyIn')

  const still = await staff<{ onClock: boolean }>(booted, 'attendance/status')
  assert.equal(still.body.data.onClock, true, 'the shift survived the retry')
})

test('staff attendance: checking out when off the clock is refused', async (t) => {
  const booted = await boot(t)
  const early = await staff(booted, 'attendance/check-out', { method: 'POST' })
  assert.equal(early.status, 409)
  assert.equal(early.body.error?.code, 'attendance.error.alreadyOut')
})

test('staff attendance: no session, no attendance', async (t) => {
  const booted = await boot(t)
  const stranger = booted.e2e.client.anonymous()
  for (const path of ['attendance/status', 'attendance/records']) {
    assert.equal((await stranger.request(`/api/staff/v1/${path}`)).status, 401, path)
  }
})
