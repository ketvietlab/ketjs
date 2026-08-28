import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bootDeployment,
  defineDeployment,
  defineModule,
  json,
  memorySessionStore,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'

const SECRET = 'permissions-request-test'

/**
 * One grant table per tenant, so "what may this user call" has a different answer
 * in each database — which is the only way to notice a resolver that read the
 * wrong one.
 */
const core = defineModule({
  name: 'core',
  models: { Grant: { scope: 'shared', fields: { id: 'id', userId: 'text', fn: 'text' } } },
  functions: {
    open: {
      input: {},
      output: { ok: 'bool' },
      effects: [],
      handler: async () => ({ ok: true }),
    },
    grant: {
      input: { id: 'id', userId: 'text', fn: 'text' },
      output: { ok: 'bool' },
      effects: ['write:core.Grant'],
      handler: async (ctx, args) => {
        await ctx.db.insert('core.Grant', args)
        return { ok: true }
      },
    },
    permitted: {
      input: { userId: 'text' },
      output: { functions: 'json' },
      effects: ['read:core.Grant'],
      // core.grant is the bootstrap door, always open; core.open is the one the
      // grant table decides, and so the one that shows which database was read.
      handler: async (ctx, args) => ({
        functions: [
          'core.grant',
          ...(await ctx.db.select('core.Grant', { userId: args.userId })).map((row) => String(row.fn)),
        ],
      }),
    },
  },
})

const boot = async () => {
  const dbs = new Map<string, Adapter>()
  const seen: Array<{ tenant: string; path: string }> = []
  const store = memorySessionStore()
  const app = defineDeployment({
    name: 'permission_request',
    modules: [core],
    headless: true,
    serve: {
      sessions: { secret: SECRET, store },
      tenants: {
        resolve: (_url, req) => {
          const key = String(req.headers['x-tenant'] ?? '')
          return key === 't1' || key === 't2' ? key : null
        },
        open: (key) => {
          let held = dbs.get(key)
          if (!held) {
            held = sqliteAdapter()
            dbs.set(key, held)
          }
          return held
        },
        list: async () => ['t1', 't2'],
      },
      permissions: async (ctx, userId, url, req) => {
        seen.push({ tenant: String(req.headers['x-tenant'] ?? ''), path: url.pathname })
        const result = (await ctx.callUnchecked('core.permitted', { userId }, url, req)) as {
          functions: string[]
        }
        return result.functions
      },
    },
  })
  const booted = await bootDeployment(app, { port: 0, log: () => {} })
  const cookie = Object.fromEntries(
    await Promise.all(
      ['t1', 't2'].map(async (tenant) => [
        tenant,
        await booted.tenants.with(tenant, async (resolved) => {
          const started = await resolved.sessions!.start({
            userId: 'u1',
            companies: ['c1'],
            company: 'c1',
          })
          return started.cookie.split(';')[0]!
        }),
      ]),
    ),
  ) as Record<'t1' | 't2', string>
  return { booted, dbs, seen, cookie }
}

const post = (port: number, tenant: string, fn: string, cookie: string, body: unknown = {}) =>
  fetch(`http://127.0.0.1:${port}/_ket/fn/${fn}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tenant': tenant,
      'x-ket-company': 'c1',
      cookie,
    },
    body: JSON.stringify(body),
  })

test('permissions: the resolver answers from the tenant the request named', async (t) => {
  const { booted, seen, cookie } = await boot()
  t.after(() => booted.close())

  // Only t1 grants core.open. Nothing distinguishes the two requests except the
  // header that chooses the database.
  const granted = await post(booted.port, 't1', 'core.grant', cookie.t1, {
    id: 'g1',
    userId: 'u1',
    fn: 'core.open',
  })
  assert.equal(granted.status, 200)

  const allowed = await post(booted.port, 't1', 'core.open', cookie.t1)
  assert.equal(allowed.status, 200)

  const refused = await post(booted.port, 't2', 'core.open', cookie.t2)
  assert.equal(refused.status, 400)
  assert.equal(((await refused.json()) as { code: string }).code, 'E_FN_NOT_PERMITTED')

  // And it really was the request's own url/req that arrived, not an invented one.
  assert.deepEqual(seen.at(-1), { tenant: 't2', path: '/_ket/fn/core.open' })
  assert.ok(seen.every((entry) => entry.tenant === 't1' || entry.tenant === 't2'))
})

test('permissions: granting in one tenant does not leak into the other', async (t) => {
  const { booted, cookie } = await boot()
  t.after(() => booted.close())

  await post(booted.port, 't2', 'core.grant', cookie.t2, { id: 'g2', userId: 'u1', fn: 'core.open' })
  assert.equal((await post(booted.port, 't2', 'core.open', cookie.t2)).status, 200)

  const other = await post(booted.port, 't1', 'core.open', cookie.t1)
  assert.equal(other.status, 400)
  assert.equal(((await other.json()) as { code: string }).code, 'E_FN_NOT_PERMITTED')
})

test('permissions: a custom audience receives only its deployment-scoped function grants', async (t) => {
  const channel = defineModule({
    name: 'channel',
    depends: ['core'],
    routes: {
      '/api/pos/v1/probe': (ctx) => async (url, req) => json(await ctx.call('core.open', {}, url, req)),
    },
  })
  const app = defineDeployment({
    name: 'custom_audience_permissions',
    modules: [core, channel],
    headless: true,
    serve: {
      resolveAudience: async (_url, req) =>
        req.headers.authorization === 'Bearer pos-token' ? 'pos' : 'anonymous',
      resolveIdentity: async ({ req }) =>
        req.headers.authorization === 'Bearer pos-token'
          ? {
              userId: 'cashier',
              companies: ['c1'],
              company: 'c1',
              securityVersion: 1,
            }
          : null,
      permissions: async (_ctx, _userId, url, req) =>
        req.headers['x-null-grant'] === '1'
          ? null
          : url.pathname.startsWith('/api/pos/v1/')
            ? ['core.open']
            : [],
    },
  })
  const booted = await bootDeployment(app, { env: { KET_SQLITE: ':memory:' }, port: 0, log: () => {} })
  t.after(() => booted.close())
  const headers = { authorization: 'Bearer pos-token', 'content-type': 'application/json' }
  const allowed = await fetch(`http://127.0.0.1:${booted.port}/api/pos/v1/probe`, { headers })
  assert.equal(allowed.status, 200)
  const nullGrant = await fetch(`http://127.0.0.1:${booted.port}/api/pos/v1/probe`, {
    headers: { ...headers, 'x-null-grant': '1' },
  })
  assert.equal(nullGrant.status, 400)
  assert.equal(((await nullGrant.json()) as { code: string }).code, 'E_FN_NOT_PERMITTED')
  const bypass = await fetch(`http://127.0.0.1:${booted.port}/_ket/fn/core.open`, {
    method: 'POST',
    headers,
    body: '{}',
  })
  assert.equal(bypass.status, 400)
  assert.equal(((await bypass.json()) as { code: string }).code, 'E_FN_NOT_PERMITTED')
})
