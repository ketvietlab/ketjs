import assert from 'node:assert/strict'
import type { IncomingMessage } from 'node:http'
import { test } from 'node:test'
import {
  bootDeployment,
  compose,
  createAdapterPool,
  createSessions,
  defineDeployment,
  defineModule,
  from,
  memorySessionStore,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import { createTenants } from '../packages/ketjs/src/server/tenants.ts'

const request = (cookie: string) => ({ headers: { cookie: cookie.split(';')[0] } }) as IncomingMessage

test('auth sessions: companyless identity is opt-in and context membership stays checked', async () => {
  const legacy = await createSessions({ secret: 'local-test-only' })
  await assert.rejects(legacy.start({ userId: 'u1', companies: [] }), { code: 'E_SESSION_NO_COMPANY' })
  const sessions = await createSessions({ secret: 'local-test-only', requireCompany: false })
  const first = await sessions.start({ userId: 'u1', companies: [] })
  assert.equal(first.record.company, null)
  assert.equal((await sessions.of(request(first.cookie)))?.userId, 'u1')
  assert.deepEqual(sessions.scopeOf(first.record), {
    company: null,
    companies: [],
    branch: null,
    branches: null,
  })
  const updated = await sessions.update(first.record, {
    company: null,
    companies: [],
    branch: null,
    branches: [],
    securityVersion: 1,
  })
  assert.equal(updated?.securityVersion, 1)
  await assert.rejects(sessions.start({ userId: 'u1', companies: [], company: 'outside' }), {
    code: 'E_WRITE_COMPANY_NOT_READABLE',
  })
  await assert.rejects(sessions.start({ userId: 'u1', companies: [], branch: 'b1' }), {
    code: 'E_BRANCH_WITHOUT_COMPANY',
  })
  await assert.rejects(
    async () =>
      sessions.update(updated!, {
        company: 'outside',
        companies: [],
        branch: null,
        branches: [],
        securityVersion: 1,
      }),
    { code: 'E_WRITE_COMPANY_NOT_READABLE' },
  )
})

test('auth sessions: switching back to the legacy policy rejects an unscoped cookie', async () => {
  const store = memorySessionStore()
  const optional = await createSessions({ store, secret: 'local-test-only', requireCompany: false })
  const { cookie } = await optional.start({ userId: 'u1', companies: [] })
  const required = await createSessions({ store, secret: 'local-test-only' })
  assert.equal(await required.of(request(cookie)), null)
})

test('auth sessions: an evicted tenant facade retains the explicit companyless policy', async () => {
  const stores = new Map<string, ReturnType<typeof memorySessionStore>>()
  const pool = createAdapterPool({
    max: 1,
    create: () => sqliteAdapter(),
  })
  const tenants = createTenants({
    spec: { resolve: () => null, open: () => sqliteAdapter(), list: async () => ['a', 'b'] },
    pool,
    manifest: compose([], { headless: true }),
    joints: () => ({}) as never,
    sessions: async (_adapter, tenant) => {
      if (!stores.has(tenant)) stores.set(tenant, memorySessionStore())
      return createSessions({
        store: stores.get(tenant)!,
        tenant,
        secret: 'stable-test-only',
        requireCompany: false,
      })
    },
  })
  try {
    const first = await tenants.with('a', async (tenant) => tenant.sessions!)
    const { cookie } = await first.start({ userId: 'u1', companies: [] })
    await tenants.with('b', async () => undefined)
    assert.equal(first.requireCompany, false)
    assert.equal((await first.of(request(cookie)))?.userId, 'u1')
    assert.equal((await first.start({ userId: 'u2', companies: [] })).record.company, null)
    assert.equal(first.scopeOf((await first.of(request(cookie)))!)?.company, null)
  } finally {
    await tenants.close()
  }
})

const domain = defineModule({
  name: 'scope_auth',
  models: { Secret: { scope: 'company', fields: { id: 'id', value: 'text' } } },
  functions: {
    who: {
      input: {},
      output: { actor: 'id?', company: 'id?' },
      effects: [],
      handler: (ctx) => ({ actor: ctx.actor, company: ctx.scope.company }),
    },
    read: {
      input: {},
      output: { id: 'id' },
      returns: 'many',
      effects: ['read:scope_auth.Secret'],
      handler: (ctx) => ctx.db.all(from(ctx.table('scope_auth.Secret'))),
    },
  },
})

test('auth sessions: optional gateway identity does not unlock company-scoped data', async () => {
  const deployment = defineDeployment({
    name: 'optional_identity',
    modules: [domain],
    headless: true,
    serve: {
      sessions: { requireCompany: false, secret: 'local-test-only' },
      resolveIdentity: async () => ({ userId: 'u1', company: null, companies: [] }),
      permissions: async () => ['scope_auth.who', 'scope_auth.read'],
    },
  })
  const app = await bootDeployment(deployment, { port: 0, env: { KET_SQLITE: ':memory:', KET_LOG: 'null' } })
  try {
    const invoke = (fn: string) =>
      fetch(`http://127.0.0.1:${app.port}/_ket/fn/${fn}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ket-company': 'forged' },
        body: '{}',
      })
    const accepted = await invoke('scope_auth.who')
    assert.equal(accepted.status, 200)
    const identity = (await accepted.json()) as { value: { actor: string; company: null } }
    assert.deepEqual(identity.value, { actor: 'u1', company: null })
    const refused = await invoke('scope_auth.read')
    assert.notEqual(refused.status, 200)
    assert.equal(((await refused.json()) as { code: string }).code, 'E_NO_COMPANY_IN_SCOPE')
  } finally {
    await app.close()
  }
})

test('auth sessions: gateway identities keep the company-required default', async () => {
  const app = await bootDeployment(
    defineDeployment({
      name: 'required_identity',
      modules: [domain],
      headless: true,
      serve: {
        resolveIdentity: async () => ({ userId: 'u1', company: null, companies: [] }),
        permissions: async () => ['scope_auth.who'],
      },
    }),
    { port: 0, env: { KET_SQLITE: ':memory:', KET_LOG: 'null' } },
  )
  try {
    const response = await fetch(`http://127.0.0.1:${app.port}/_ket/fn/scope_auth.who`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.notEqual(response.status, 200)
  } finally {
    await app.close()
  }
})

test('auth sessions: persisted and gateway contexts reject branches outside their readable set', async () => {
  const store = memorySessionStore()
  const sessions = await createSessions({ store, secret: 'local-test-only', requireCompany: false })
  const issued = await sessions.start({ userId: 'u1', companies: ['c1'], branches: ['b1'] })
  await store.updateContext(issued.record.id, 0, {
    company: 'c1',
    companies: ['c1'],
    branch: 'outside',
    branches: ['b1'],
    securityVersion: 0,
  })
  assert.equal(await sessions.of(request(issued.cookie)), null)
  assert.equal(await store.read(issued.record.id), null, 'invalid stored context is destroyed')

  const app = await bootDeployment(
    defineDeployment({
      name: 'branch_identity',
      modules: [domain],
      headless: true,
      serve: {
        sessions: { requireCompany: false, secret: 'local-test-only' },
        resolveIdentity: async () => ({
          userId: 'u1',
          company: 'c1',
          companies: ['c1'],
          branch: 'outside',
          branches: ['b1'],
        }),
        permissions: async () => ['scope_auth.who'],
      },
    }),
    { port: 0, env: { KET_SQLITE: ':memory:', KET_LOG: 'null' } },
  )
  try {
    const response = await fetch(`http://127.0.0.1:${app.port}/_ket/fn/scope_auth.who`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(response.status, 403)
  } finally {
    await app.close()
  }
})
