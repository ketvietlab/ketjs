import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bootDeployment,
  defineDeployment,
  defineModule,
  memorySessionStore,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import { createSessions } from '@ketvietlab/ketjs'
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
  const sessions = await createSessions({ secret: SECRET, store })
  const started = await sessions.start({ userId: 'u1', companies: ['c1'], company: 'c1' })
  const cookie = started.cookie.split(';')[0]!
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
  const granted = await post(booted.port, 't1', 'core.grant', cookie, {
    id: 'g1',
    userId: 'u1',
    fn: 'core.open',
  })
  assert.equal(granted.status, 200)

  const allowed = await post(booted.port, 't1', 'core.open', cookie)
  assert.equal(allowed.status, 200)

  const refused = await post(booted.port, 't2', 'core.open', cookie)
  assert.equal(refused.status, 400)
  assert.equal(((await refused.json()) as { code: string }).code, 'E_FN_NOT_PERMITTED')

  // And it really was the request's own url/req that arrived, not an invented one.
  assert.deepEqual(seen.at(-1), { tenant: 't2', path: '/_ket/fn/core.open' })
  assert.ok(seen.every((entry) => entry.tenant === 't1' || entry.tenant === 't2'))
})

test('permissions: granting in one tenant does not leak into the other', async (t) => {
  const { booted, cookie } = await boot()
  t.after(() => booted.close())

  await post(booted.port, 't2', 'core.grant', cookie, { id: 'g2', userId: 'u1', fn: 'core.open' })
  assert.equal((await post(booted.port, 't2', 'core.open', cookie)).status, 200)

  const other = await post(booted.port, 't1', 'core.open', cookie)
  assert.equal(other.status, 400)
  assert.equal(((await other.json()) as { code: string }).code, 'E_FN_NOT_PERMITTED')
})
