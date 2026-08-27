import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { defineDeployment, defineModule } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import channelApi from '../packages/ketsuite/src/modules/channel_api/index.ts'
import {
  csrfTokenFor,
  defineChannelRoute,
  registerChannelIdentity,
  routesOf,
} from '../packages/ketsuite/src/modules/channel_api/core.ts'
import type { ChannelIdentity } from '../packages/ketsuite/src/modules/channel_api/core.ts'

const SESSION_TOKEN = 'session-token-for-the-facade-test'

const asIdentity = (presentation: 'cookie' | 'bearer'): ChannelIdentity => ({
  account: {
    id: 'account-1',
    realmId: 'realm-1',
    partnerId: 'partner-1',
    email: 'khach@example.test',
    displayName: 'Khách',
    securityVersion: 1,
  },
  accountId: 'account-1',
  realmId: 'realm-1',
  siteId: 'site-1',
  token: SESSION_TOKEN,
  presentation,
})

/** What the probe routes see. A handler that runs when it should not is a failure. */
let presented: ChannelIdentity | null = null
let reached: string[] = []

registerChannelIdentity('customer', async () => presented)

const envelope = { type: 'object' }
const profileBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    displayName: { type: 'string', minLength: 2, maxLength: 30 },
    email: { type: 'string', format: 'email' },
    age: { type: 'integer', minimum: 0 },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['displayName', 'email'],
}

const probe = defineModule({
  name: 'channel_api',
  version: '1.0.0',
  reserves: ['/api/customer/v1/'],
  messages: channelApi.messages,
  routes: routesOf(
    defineChannelRoute({
      profile: 'customer',
      method: 'GET',
      path: 'probe/whoami',
      operationId: 'customer.probe.whoami',
      auth: 'customer',
      responses: { '200': envelope },
      handler: (_ctx, _url, _req, _params, request) => {
        reached.push('whoami')
        return { data: { accountId: request.identity!.accountId } }
      },
    }),
    defineChannelRoute({
      profile: 'customer',
      method: 'GET',
      path: 'probe/open',
      operationId: 'customer.probe.open',
      auth: 'optional-customer',
      responses: { '200': envelope },
      handler: (_ctx, _url, _req, _params, request) => ({
        data: { signedIn: request.identity !== null },
      }),
    }),
    defineChannelRoute({
      profile: 'customer',
      method: 'POST',
      path: 'probe/profile',
      operationId: 'customer.probe.profile',
      auth: 'customer',
      request: { body: profileBody },
      responses: { '200': envelope },
      handler: (_ctx, _url, _req, _params, request) => {
        reached.push('profile')
        return { data: request.body }
      },
    }),
    defineChannelRoute({
      profile: 'customer',
      method: 'POST',
      path: 'probe/inflight',
      operationId: 'customer.probe.inflight',
      responses: { '200': envelope },
      idempotent: true,
      handler: () => {
        throw Object.assign(new Error('already running'), { code: 'E_IDEMPOTENCY_IN_FLIGHT' })
      },
    }),
    defineChannelRoute({
      profile: 'customer',
      method: 'GET',
      path: 'probe/forbidden',
      operationId: 'customer.probe.forbidden',
      responses: { '403': envelope },
      handler: () => {
        throw Object.assign(new Error('function permission denied'), { code: 'E_FN_NOT_PERMITTED' })
      },
    }),
  ),
})

const boot = async (t: TestContext) => {
  presented = null
  reached = []
  const e2e = await createTestDeployment(
    defineDeployment({
      name: 'channel_probe',
      headless: true,
      modules: [probe],
      serve: {},
    }),
    { worker: false },
  )
  t.after(() => e2e.close())
  return e2e
}

type Envelope = {
  data: Record<string, unknown> | null
  error: {
    code: string
    messageKey: string
    message: string
    retryable: boolean
    fieldErrors: Record<string, { code: string; messageKey: string }>
  } | null
  meta: { requestId: string; nextCursor: string | null }
}

const read = async (response: Response): Promise<Envelope> => (await response.json()) as Envelope

test('channel facade: a declared auth is enforced before the handler runs', async (t) => {
  const e2e = await boot(t)
  const denied = await e2e.client.get('/api/customer/v1/probe/whoami')
  assert.equal(denied.status, 401)
  const body = await read(denied)
  assert.equal(body.error?.code, 'channel_api.unauthenticated')
  assert.equal(body.error?.message, 'Sign in to continue.')
  assert.deepEqual(reached, [])

  presented = asIdentity('bearer')
  const allowed = await e2e.client.get('/api/customer/v1/probe/whoami')
  assert.equal(allowed.status, 200)
  assert.deepEqual((await read(allowed)).data, { accountId: 'account-1' })
  assert.deepEqual(reached, ['whoami'])
})

test('channel facade: optional-customer resolves the caller without requiring one', async (t) => {
  const e2e = await boot(t)
  assert.deepEqual((await read(await e2e.client.get('/api/customer/v1/probe/open'))).data, {
    signedIn: false,
  })
  presented = asIdentity('bearer')
  assert.deepEqual((await read(await e2e.client.get('/api/customer/v1/probe/open'))).data, {
    signedIn: true,
  })
})

test('channel facade: a cookie caller must prove intent on every mutation', async (t) => {
  const e2e = await boot(t)
  const origin = new URL(e2e.baseUrl).origin
  const send = (headers: Record<string, string>) =>
    e2e.client.request('/api/customer/v1/probe/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ displayName: 'Khách', email: 'khach@example.test' }),
    })

  presented = asIdentity('cookie')
  const bare = await send({})
  assert.equal(bare.status, 403)
  assert.equal((await read(bare)).error?.code, 'channel_api.csrf')

  const foreign = await send({
    origin: 'https://evil.example',
    'x-csrf-token': csrfTokenFor(SESSION_TOKEN),
  })
  assert.equal(foreign.status, 403)
  assert.equal((await read(foreign)).error?.code, 'channel_api.originMismatch')

  const proved = await send({ origin, 'x-csrf-token': csrfTokenFor(SESSION_TOKEN) })
  assert.equal(proved.status, 200)
  assert.deepEqual(reached, ['profile'])

  // A Bearer credential is never attached by the browser, so it needs no proof.
  presented = asIdentity('bearer')
  assert.equal((await send({ origin: 'https://spa.example' })).status, 200)
})

test('channel facade: the published request schema is the one the server enforces', async (t) => {
  const e2e = await boot(t)
  presented = asIdentity('bearer')
  const post = (body: unknown) =>
    e2e.client.request('/api/customer/v1/probe/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  const missing = await post({ email: 'khach@example.test' })
  assert.equal(missing.status, 422)
  const missingBody = await read(missing)
  assert.equal(missingBody.error?.code, 'channel_api.invalidRequest')
  assert.equal(missingBody.error?.fieldErrors.displayName?.messageKey, 'channel_api.error.fieldRequired')

  const unknown = await post({ displayName: 'Khách', email: 'khach@example.test', superuser: true })
  assert.equal(unknown.status, 422)
  assert.equal(
    (await read(unknown)).error?.fieldErrors.superuser?.messageKey,
    'channel_api.error.fieldUnknown',
  )

  const malformed = await post({ displayName: 'K', email: 'not-an-email', age: 1.5, tags: [7] })
  assert.equal(malformed.status, 422)
  const fields = (await read(malformed)).error?.fieldErrors ?? {}
  assert.deepEqual(Object.keys(fields).sort(), ['age', 'displayName', 'email', 'tags.0'].sort())
  assert.equal(fields.email?.messageKey, 'channel_api.error.fieldInvalid')
  assert.deepEqual(reached, [])

  const accepted = await post({
    displayName: 'Khách',
    email: 'khach@example.test',
    age: 30,
    tags: ['vip'],
  })
  assert.equal(accepted.status, 200)
  assert.deepEqual((await read(accepted)).data, {
    displayName: 'Khách',
    email: 'khach@example.test',
    age: 30,
    tags: ['vip'],
  })
})

test('channel facade: an in-flight idempotent command is a retryable conflict, not a server fault', async (t) => {
  const e2e = await boot(t)
  const response = await e2e.client.request('/api/customer/v1/probe/inflight', {
    method: 'POST',
    headers: { 'idempotency-key': 'probe-1', 'x-request-id': 'req_probe_inflight' },
  })
  assert.equal(response.status, 409)
  const body = await read(response)
  assert.equal(body.error?.code, 'channel_api.idempotencyInFlight')
  assert.equal(body.error?.retryable, true)
  assert.equal(body.meta.requestId, 'req_probe_inflight')
  assert.equal(response.headers.get('x-request-id'), 'req_probe_inflight')
})

test('channel facade: a refused function permission is a stable forbidden response', async (t) => {
  const e2e = await boot(t)
  const response = await e2e.client.get('/api/customer/v1/probe/forbidden')
  assert.equal(response.status, 403)
  const body = await read(response)
  assert.equal(body.error?.code, 'channel_api.forbidden')
  assert.equal(body.error?.messageKey, 'channel_api.error.forbidden')
  assert.equal(body.error?.message, 'You do not have permission to perform this action.')
})

test('channel facade: a wrong method answers 405 and says which one is allowed', async (t) => {
  const e2e = await boot(t)
  const response = await e2e.client.get('/api/customer/v1/probe/inflight')
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'POST')
  assert.equal((await read(response)).error?.code, 'channel_api.methodNotAllowed')
})

test('channel api: every facade message key is translated in both locales', () => {
  const vi = channelApi.messages.vi ?? {}
  const en = channelApi.messages.en ?? {}
  assert.deepEqual(Object.keys(vi).sort(), Object.keys(en).sort())
  for (const key of [
    'error.methodNotAllowed',
    'error.internal',
    'error.unauthenticated',
    'error.credentialConflict',
    'error.forbidden',
    'error.idempotencyRequired',
    'error.idempotencyConflict',
    'error.idempotencyInFlight',
    'error.invalidRefreshToken',
    'error.originMismatch',
    'error.csrf',
    'error.invalidRequest',
    'error.fieldRequired',
    'error.fieldUnknown',
    'error.fieldInvalid',
    'unsupportedMediaType.error',
    'payloadTooLarge.error',
    'invalidBody.error',
  ])
    assert.ok(vi[key] && en[key], `missing translation for "${key}"`)
})
