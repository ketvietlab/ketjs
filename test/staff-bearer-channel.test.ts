import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { defineDeployment, defineModule } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import channelApi from '../packages/ketsuite/src/modules/channel_api/index.ts'
import {
  bearerOf,
  channelCredentialFailure,
  defineChannelRoute,
  registerChannelIdentityPresentation,
  routesOf,
} from '../packages/ketsuite/src/modules/channel_api/core.ts'
import type { StaffIdentity } from '../packages/ketsuite/src/modules/channel_api/core.ts'

const ACCESS_TOKEN = `staff_${'a'.repeat(48)}`
const REVOKED_TOKEN = `staff_${'r'.repeat(48)}`
let bearerResolutions = 0

const identity: StaffIdentity = {
  userId: 'operator-1',
  companyId: 'company-1',
  branchId: 'branch-1',
  companies: ['company-1'],
  branches: ['branch-1'],
  securityVersion: 1,
  sessionId: 'staff-session-1',
  presentation: 'bearer',
}

registerChannelIdentityPresentation('staff', {
  owner: 'test.staff-bearer',
  presentation: 'bearer',
  presented: (req) => String(req.headers.authorization ?? '').trim() !== '',
  resolve: async (_ctx, _url, req) => {
    bearerResolutions += 1
    const token = bearerOf(req)
    if (token === REVOKED_TOKEN) throw channelCredentialFailure('revoked')
    return token === ACCESS_TOKEN ? identity : null
  },
})

const envelope = { type: 'object' }
const probe = defineModule({
  name: 'channel_api',
  version: '1.0.0',
  reserves: ['/api/staff/v1/'],
  messages: channelApi.messages,
  routes: routesOf(
    defineChannelRoute({
      profile: 'staff',
      method: 'GET',
      path: 'probe/whoami',
      operationId: 'staff.probe.whoami',
      auth: 'required',
      responses: { '200': envelope },
      handler: (_ctx, _url, _req, _params, request) => ({
        data: {
          userId: request.identity!.userId,
          presentation: request.identity!.presentation,
        },
      }),
    }),
    defineChannelRoute({
      profile: 'staff',
      method: 'POST',
      path: 'probe/mutation',
      operationId: 'staff.probe.mutation',
      auth: 'required',
      responses: { '200': envelope },
      handler: () => ({ data: { accepted: true } }),
    }),
  ),
})

const boot = async (t: TestContext) => {
  bearerResolutions = 0
  const e2e = await createTestDeployment(
    defineDeployment({ name: 'staff_bearer_probe', headless: true, modules: [probe], serve: {} }),
    { worker: false },
  )
  t.after(() => e2e.close())
  return e2e
}

type Envelope = {
  data: Record<string, unknown> | null
  error: { code: string; message: string } | null
}

const request = (
  e2e: Awaited<ReturnType<typeof boot>>,
  path: string,
  token: string,
  init: RequestInit = {},
) =>
  e2e.client.request(`/api/staff/v1/probe/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  })

test('staff Bearer: a deployment resolver feeds the shared staff authorization pipeline', async (t) => {
  const e2e = await boot(t)
  const response = await request(e2e, 'whoami', ACCESS_TOKEN)
  assert.equal(response.status, 200)
  assert.deepEqual(((await response.json()) as Envelope).data, {
    userId: 'operator-1',
    presentation: 'bearer',
  })
})

test('staff Bearer: mutations do not require browser CSRF proof', async (t) => {
  const e2e = await boot(t)
  const response = await request(e2e, 'mutation', ACCESS_TOKEN, {
    method: 'POST',
    headers: { origin: 'https://native-client.invalid' },
  })
  assert.equal(response.status, 200)
  assert.deepEqual(((await response.json()) as Envelope).data, { accepted: true })
})

test('staff Bearer: malformed and revoked credentials share a redacted response', async (t) => {
  const e2e = await boot(t)
  for (const token of ['short', REVOKED_TOKEN]) {
    const response = await request(e2e, 'whoami', token)
    assert.equal(response.status, 401)
    const text = await response.text()
    assert.equal((JSON.parse(text) as Envelope).error?.code, 'channel_api.unauthenticated')
    assert.equal(text.includes(token), false)
  }
})

test('staff Bearer: cookie and authorization credentials fail closed before resolution', async (t) => {
  const e2e = await boot(t)
  const response = await request(e2e, 'whoami', ACCESS_TOKEN, {
    headers: { cookie: 'ket_session=browser-session' },
  })
  assert.equal(response.status, 401)
  assert.equal(((await response.json()) as Envelope).error?.code, 'channel_api.credentialConflict')
  assert.equal(bearerResolutions, 0)
})

test('staff Bearer: one presentation cannot be replaced by import order', () => {
  assert.doesNotThrow(() =>
    registerChannelIdentityPresentation('staff', {
      owner: 'test.staff-bearer',
      presentation: 'bearer',
      presented: () => true,
      resolve: async () => identity,
    }),
  )
  assert.throws(
    () =>
      registerChannelIdentityPresentation('staff', {
        owner: 'test.competing-staff-bearer',
        presentation: 'bearer',
        presented: () => true,
        resolve: async () => identity,
      }),
    /is owned by/,
  )
})
