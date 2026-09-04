import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  agentTools,
  bootDeployment,
  compose,
  defineDeployment,
  defineFn,
  defineModule,
  json,
  withHeaders,
} from '@ketvietlab/ketjs'
import type { SessionContext } from '@ketvietlab/ketjs'

test('identity engine: an internal function has no generic HTTP or agent surface', async () => {
  const identity = defineModule({
    name: 'identity_engine',
    functions: {
      inspectCredential: defineFn({
        exposure: 'internal',
        agent: true,
        input: {},
        output: { ok: 'bool' },
        effects: [],
        handler: () => ({ ok: true }),
      }),
    },
    routes: {
      '/trusted': (ctx) => async (url, req) =>
        json(await ctx.call('identity_engine.inspectCredential', {}, url, req)),
    },
  })
  const manifest = compose([identity], { headless: true })
  assert.equal(manifest.functions['identity_engine.inspectCredential']?.exposure, 'internal')
  assert.equal(
    agentTools(manifest).some((tool) => tool.name === 'identity_engine__inspectCredential'),
    false,
  )

  const app = defineDeployment({
    name: 'identity_engine_http',
    modules: [identity],
    headless: true,
    serve: {},
  })
  const booted = await bootDeployment(app, { env: { KET_LOG: 'null', KET_SQLITE: ':memory:' }, port: 0 })
  try {
    const at = `http://127.0.0.1:${booted.port}`
    const hidden = await fetch(`${at}/_ket/fn/identity_engine.inspectCredential`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(hidden.status, 400)
    assert.equal(((await hidden.json()) as { code: string }).code, 'E_FUNCTION_INTERNAL')
    assert.deepEqual(await fetch(`${at}/trusted`).then((r) => r.json()), { ok: true })
  } finally {
    await booted.close()
  }
})

test('identity engine: live session resolution updates context and rejects a revoked identity', async () => {
  let live: SessionContext | null = {
    companies: ['c1', 'c2'],
    company: 'c1',
    branch: 'b1',
    branches: ['b1', 'b2'],
    securityVersion: 7,
  }
  const identity = defineModule({
    name: 'live_identity',
    routes: {
      '/session/start': {
        anonymous: true,
        handler: (ctx) => async (url, req) => {
          const sessions = await ctx.sessionsOf(url, req)
          const started = await sessions!.start({
            userId: 'u1',
            companies: ['c1', 'c2'],
            company: 'c1',
            branch: 'b1',
            branches: ['b1', 'b2'],
            securityVersion: 7,
          })
          return withHeaders(json({ ok: true }), { 'set-cookie': started.cookie })
        },
      },
      '/session/scope': (ctx) => async (url, req) => json(await ctx.scopeOf(url, req)),
    },
  })
  const app = defineDeployment({
    name: 'live_identity_http',
    modules: [identity],
    headless: true,
    serve: {
      sessions: { secret: 'test' },
      resolveSession: async () => live,
    },
  })
  const booted = await bootDeployment(app, { env: { KET_LOG: 'null', KET_SQLITE: ':memory:' }, port: 0 })
  try {
    const at = `http://127.0.0.1:${booted.port}`
    const started = await fetch(`${at}/session/start`)
    const cookie = started.headers.get('set-cookie')!.split(';')[0]!
    live = {
      companies: ['c2'],
      company: 'c2',
      branch: 'b2',
      branches: ['b2'],
      securityVersion: 7,
    }
    const switched = await fetch(`${at}/session/scope`, { headers: { cookie } })
    assert.equal(switched.status, 200)
    assert.deepEqual(await switched.json(), {
      companies: ['c2'],
      company: 'c2',
      branch: 'b2',
      branches: ['b2'],
    })

    live = null
    const revoked = await fetch(`${at}/session/scope`, {
      headers: { cookie, accept: 'application/json' },
    })
    assert.equal(revoked.status, 401)
  } finally {
    await booted.close()
  }
})

test('identity engine: a trusted request identity uses the normal actor, scope and permission pipeline', async () => {
  const identity = defineModule({
    name: 'request_identity',
    functions: {
      inspect: defineFn({
        input: {},
        output: { actor: 'text?', company: 'text?' },
        effects: [],
        handler: (ctx) => ({ actor: ctx.actor, company: ctx.scope.company }),
      }),
      denied: defineFn({ input: {}, output: { ok: 'bool' }, effects: [], handler: () => ({ ok: true }) }),
    },
    routes: {
      '/who': (ctx) => async (url, req) => json(await ctx.call('request_identity.inspect', {}, url, req)),
    },
  })
  const app = defineDeployment({
    name: 'trusted_request_identity',
    modules: [identity],
    headless: true,
    serve: {
      resolveIdentity: async ({ req }) =>
        req.headers['x-signed-identity'] === 'valid'
          ? { userId: 'zitadel:u1', companies: ['default'], company: 'default' }
          : null,
      permissions: async () => ['request_identity.inspect'],
    },
  })
  const booted = await bootDeployment(app, { env: { KET_LOG: 'null', KET_SQLITE: ':memory:' }, port: 0 })
  try {
    const at = `http://127.0.0.1:${booted.port}`
    assert.equal((await fetch(`${at}/who`, { headers: { accept: 'application/json' } })).status, 401)
    const signed = { 'x-signed-identity': 'valid', accept: 'application/json' }
    assert.deepEqual(await fetch(`${at}/who`, { headers: signed }).then((r) => r.json()), {
      actor: 'zitadel:u1',
      company: 'default',
    })
    const denied = await fetch(`${at}/_ket/fn/request_identity.denied`, {
      method: 'POST',
      headers: { ...signed, 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(denied.status, 400)
    assert.equal(((await denied.json()) as { code: string }).code, 'E_FN_NOT_PERMITTED')
  } finally {
    await booted.close()
  }
})

test('identity engine: provisioning must be internal', () => {
  assert.throws(
    () =>
      compose([
        defineModule({
          name: 'bad_provision',
          functions: {
            run: defineFn({ provision: true, effects: [], handler: () => null }),
          },
        }),
      ]),
    /E_PROVISION_EXPOSED/,
  )
})
