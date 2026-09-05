import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { ClientCompatibilityPolicy, Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

type Envelope<T> = {
  data: T
  error: { code: string; message: string } | null
  meta: { requestId: string }
}

const boot = async (t: TestContext, clientCompatibility?: ClientCompatibilityPolicy) => {
  const deployment = clientCompatibility
    ? { ...ketsuite, serve: { ...ketsuite.serve!, clientCompatibility } }
    : ketsuite
  const e2e = await createTestDeployment(deployment, { worker: false })
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
  // A second company the operator is deliberately not a member of.
  await fixture('partner.savePartner', { id: 'other-party', kind: 'company', name: 'Khác' })
  await fixture('company.saveCompany', {
    id: 'other',
    code: 'OTHER',
    partnerId: 'other-party',
    currency: 'VND',
  })
  await fixture('user.createUser', {
    id: 'operator',
    login: 'operator',
    password: 'correct horse battery',
    name: 'Người vận hành',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'operator:acme', userId: 'operator', companyId: 'acme' })
  return e2e
}

const staff = async <T>(
  e2e: Awaited<ReturnType<typeof boot>>,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Envelope<T> }> => {
  const response = await e2e.client.request(`/api/staff/v1/${path}`, init)
  return { status: response.status, body: (await response.json()) as Envelope<T> }
}

test('staff channel: a route declaring auth refuses a caller with no session', async (t) => {
  const e2e = await boot(t)
  const stranger = e2e.client.anonymous()
  const response = await stranger.request('/api/staff/v1/bootstrap')
  assert.equal(response.status, 401)
  assert.equal(((await response.json()) as Envelope<null>).error?.code, 'channel_api.unauthenticated')
})

test('staff channel: the company comes from the session, never from the request', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'operator', password: 'correct horse battery' })

  const bootstrap = await staff<{
    user: { id: string }
    scope: { companyId: string; companies: string[] }
    deployment: string
    minimumAppVersion: { ios: string; android: string }
    recommendedAppVersion: { ios: string; android: string }
    maintenance: { enabled: boolean; message: string | null }
  }>(e2e, 'bootstrap')
  assert.equal(bootstrap.status, 200)
  assert.equal(bootstrap.body.data.user.id, 'operator')
  assert.equal(bootstrap.body.data.scope.companyId, 'acme')
  assert.equal(bootstrap.body.data.deployment, 'ketsuite')
  assert.deepEqual(bootstrap.body.data.minimumAppVersion, { ios: '0.0.0', android: '0.0.0' })
  assert.deepEqual(bootstrap.body.data.recommendedAppVersion, { ios: '0.0.0', android: '0.0.0' })
  assert.deepEqual(bootstrap.body.data.maintenance, { enabled: false, message: null })

  // Every way a caller might try to name a different company. The session is
  // what answers, so all of them come back the same.
  const nudges: Array<Record<string, string>> = [
    { 'x-ket-company': 'other' },
    { 'x-channel-realm': 'other' },
    { 'x-ket-companies': 'other' },
  ]
  for (const headers of nudges) {
    const nudged = await staff<{ scope: { companyId: string } }>(e2e, 'bootstrap', { headers })
    assert.equal(nudged.status, 200, JSON.stringify(headers))
    assert.equal(nudged.body.data.scope.companyId, 'acme', `honoured ${JSON.stringify(headers)}`)
  }
})

test('staff channel: the profile answers from the operator its session names', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'operator', password: 'correct horse battery' })
  const me = await staff<{ user: { id: string; login: string } }>(e2e, 'me')
  assert.equal(me.status, 200)
  assert.deepEqual(me.body.data.user.id, 'operator')
  assert.deepEqual(me.body.data.user.login, 'operator')
})

test('staff channel: maintenance hides disabled copy and falls back for unsupported locales', async (t) => {
  const disabled = await boot(t, {
    minimumVersions: { ios: '1.0.0', android: '1.0.0' },
    maintenance: { enabled: false, messages: { vi: 'Đang bảo trì.' } },
  })
  await disabled.client.login({ login: 'operator', password: 'correct horse battery' })
  const disabledBootstrap = await staff<{ maintenance: { enabled: boolean; message: string | null } }>(
    disabled,
    'bootstrap',
  )
  assert.deepEqual(disabledBootstrap.body.data.maintenance, { enabled: false, message: null })

  const enabled = await boot(t, {
    minimumVersions: { ios: '1.0.0', android: '1.0.0' },
    maintenance: { enabled: true, messages: { vi: 'Đang bảo trì.' } },
  })
  await enabled.client.login({ login: 'operator', password: 'correct horse battery' })
  const enabledBootstrap = await staff<{ maintenance: { enabled: boolean; message: string | null } }>(
    enabled,
    'bootstrap',
    { headers: { 'accept-language': 'en-US' } },
  )
  assert.deepEqual(enabledBootstrap.body.data.maintenance, {
    enabled: true,
    message: 'Đang bảo trì.',
  })
})

test('staff channel: a customer credential is not a staff credential', async (t) => {
  const e2e = await boot(t)
  // A customer bearer token is a perfectly good credential on the other profile
  // and means nothing here, because the two resolvers share nothing.
  const response = await e2e.client.anonymous().request('/api/staff/v1/me', {
    headers: { authorization: 'Bearer ' + 'x'.repeat(48) },
  })
  assert.equal(response.status, 401)
})
