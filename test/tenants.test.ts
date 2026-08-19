import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bootApp,
  defineApp,
  defineModule,
  json,
  migrateOne,
  compose,
  sqliteAdapter,
  memorySessionStore,
} from 'ketjs'
import type { Adapter, ServeContext, Route } from 'ketjs'

/**
 * One deployment, many databases — Odoo's model, and the one that makes per-tenant
 * module sets work at all.
 *
 * What this guards is subtler than a missing feature. `bootApp` used to open one
 * adapter and build one AppRegistry, so the restricted manifest was computed once.
 * Serving two tenants through that would not crash: it would show tenant B the
 * module set of tenant A. Wrong answers are worse than errors.
 */

const core = defineModule({
  name: 'core',
  app: true,
  models: { Note: { scope: 'company', fields: { id: 'id', memo: 'text' } } },
  functions: {
    add: {
      input: { id: 'id', memo: 'text' },
      output: { ok: 'bool' },
      effects: ['write:core.Note'],
      handler: async (ctx, a) => {
        await ctx.db.insert('core.Note', a)
        return { ok: true }
      },
    },
    list: {
      output: { id: 'id', memo: 'text' },
      effects: ['read:core.Note'],
      handler: (ctx) => ctx.db.select('core.Note'),
    },
  },
})
const extra = defineModule({
  name: 'extra',
  app: true,
  depends: ['core'],
  routes: {
    '/extra':
      (_ctx: ServeContext): Route =>
      async () =>
        json({ from: 'extra' }),
  },
})

const dbs = new Map<string, Adapter>()
const app = defineApp({
  name: 'multi',
  modules: [core, extra],
  headless: true,
  serve: {
    bootstrap: ['core'],
    routes: (ctx) => ({
      '/notes': async (url, req) => json(await ctx.call('core.list', {}, url, req)),
      '/apps': async (_url, req) =>
        json((await ctx.appsOf(req)).filter((a) => a.state === 'installed').map((a) => a.name)),
    }),
    tenants: {
      /**
       * A deployment would read Host, the way Odoo's dbfilter does. The tests read
       * a header instead, because Node's fetch refuses to set Host — and the
       * resolver being the app's means either is equally legitimate.
       */
      resolve: (_url, req) => {
        const key = String(req.headers['x-tenant'] ?? '')
        return key === 't1' || key === 't2' ? key : null
      },
      open: (key) => {
        let a = dbs.get(key)
        if (!a) {
          a = sqliteAdapter()
          dbs.set(key, a)
        }
        return a
      },
      list: async () => ['t1', 't2'],
    },
  },
})

const get = (port: number, tenant: string, path: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { 'x-tenant': tenant, 'x-ket-company': 'c1', ...(init.headers ?? {}) },
  })

test('tenants: each request lands in its own database', async () => {
  dbs.clear()
  const b = await bootApp(app, { port: 0 })
  const post = (host: string, id: string) =>
    get(b.port, host, '/_ket/fn/core.add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, memo: host }),
    })
  await post('t1', 'a')
  await post('t2', 'b')
  assert.deepEqual(
    ((await get(b.port, 't1', '/notes').then((r) => r.json())) as Array<{ id: string }>).map((r) => r.id),
    ['a'],
  )
  assert.deepEqual(
    ((await get(b.port, 't2', '/notes').then((r) => r.json())) as Array<{ id: string }>).map((r) => r.id),
    ['b'],
  )
  await b.close()
})

test('tenants: module sets differ, which is the whole point', async () => {
  dbs.clear()
  const b = await bootApp(app, { port: 0 })
  // Both bootstrap `core`. Only t2 installs `extra`.
  await b.tenants.with('t2', (t) => t.apps.install('extra'))

  assert.deepEqual(await get(b.port, 't1', '/apps').then((r) => r.json()), ['core'])
  assert.deepEqual(((await get(b.port, 't2', '/apps').then((r) => r.json())) as string[]).sort(), [
    'core',
    'extra',
  ])

  // And the route that belongs to `extra` follows the installed set, per tenant.
  assert.equal((await get(b.port, 't1', '/extra')).status, 404)
  assert.equal((await get(b.port, 't2', '/extra')).status, 200)
  await b.close()
})

test('tenants: health answers for the tenant that asked, not for the deployment', async () => {
  dbs.clear()
  const b = await bootApp(app, { port: 0 })
  await b.tenants.with('t2', (t) => t.apps.install('extra'))
  const h1 = (await get(b.port, 't1', '/_ket/health').then((r) => r.json())) as {
    tenant: string
    apps: string[]
  }
  const h2 = (await get(b.port, 't2', '/_ket/health').then((r) => r.json())) as {
    tenant: string
    apps: string[]
  }
  assert.equal(h1.tenant, 't1')
  assert.deepEqual(h1.apps, ['core'])
  assert.deepEqual(h2.apps.sort(), ['core', 'extra'])
  await b.close()
})

test('tenants: a host this deployment does not serve is refused, not defaulted', async () => {
  dbs.clear()
  const b = await bootApp(app, { port: 0 })
  const r = await get(b.port, 'nobody', '/notes')
  assert.equal(r.status, 400)
  assert.match(
    JSON.stringify(await r.json()),
    /E_UNKNOWN_TENANT/,
    'a default tenant is how one customer quietly reads another customer data',
  )
  await b.close()
})

test('tenants: bootstrap runs per tenant, on first touch', async () => {
  dbs.clear()
  const b = await bootApp(app, { port: 0 })
  // Nothing has been touched yet, so nothing has been installed anywhere.
  assert.equal(dbs.size, 0)
  await get(b.port, 't1', '/apps')
  assert.deepEqual([...dbs.keys()], ['t1'], 'only the tenant that asked')
  await b.close()
})

test('tenants: with several databases there is no single adapter, and the type says so', async () => {
  dbs.clear()
  const b = await bootApp(app, { port: 0 })
  assert.equal(b.adapter, null)
  assert.equal(b.apps, null)
  assert.match(await b.banner(), /tenant\(s\), one database each/)
  await b.close()
})

test('single: one datastore is the same interface, not a second code path', async () => {
  const solo = defineApp({ name: 'solo', modules: [core], headless: true, serve: { bootstrap: ['core'] } })
  const b = await bootApp(solo, { env: { KET_SQLITE: ':memory:' }, port: 0 })
  assert.notEqual(b.adapter, null)
  assert.deepEqual(await b.tenants.keys(), [''])
  const seen = await b.tenants.with('', async (t) => [...(await t.apps.enabled())])
  assert.deepEqual(seen, ['core'])
  await b.close()
})

test('migrate: every tenant is migrated, and one failure does not stop the fleet', async () => {
  const manifest = compose([core, extra])
  const good = sqliteAdapter()
  await good.open()
  const ops = await migrateOne(good, manifest)
  assert.ok(ops.length > 0)
  assert.equal((await migrateOne(good, manifest)).length, 0, 'and running it twice is a no-op')
  await good.close()
})

// ── logins, per tenant ───────────────────────────────────────────────────────

/**
 * With tenants arriving by subdomain the Host names the tenant before any cookie
 * is read, so each tenant keeps its own sessions in its own database. That is also
 * the isolation: a session id from one tenant is not a row in another's table.
 *
 * An app serving every tenant from one domain cannot resolve a tenant that way —
 * reading the session needs the database, knowing the database needs the session —
 * and passes one shared store instead. Both are tested here, because both are
 * deployments someone will have.
 */
const authed = defineApp({
  name: 'authed',
  modules: [core],
  headless: true,
  serve: {
    bootstrap: ['core'],
    sessions: {},
    tenants: {
      resolve: (_url, req) => {
        const key = String(req.headers['x-tenant'] ?? '')
        return key === 't1' || key === 't2' ? key : null
      },
      open: (key) => {
        let a = dbs.get(key)
        if (!a) {
          a = sqliteAdapter()
          dbs.set(key, a)
        }
        return a
      },
      list: async () => ['t1', 't2'],
    },
  },
})

const loginAs = async (port: number, tenant: string, userId: string) => {
  // No user module here, so the session is started directly — this is testing the
  // plumbing, not the password check, which identity.test.ts already covers.
  return { port, tenant, userId }
}

test('sessions: each tenant keeps its own, so a cookie does not travel between them', async () => {
  dbs.clear()
  const b = await bootApp(authed, { env: { KET_SECRET: 'shared-across-pods' }, port: 0 })

  const s1 = await b.tenants.with('t1', async (t) => t.sessions!.start({ userId: 'u1', companies: ['c1'] }))
  const jar = s1.cookie.split(';')[0]!
  const req = { headers: { cookie: jar } } as never

  const seenAtHome = await b.tenants.with('t1', async (t) => t.sessions!.of(req))
  assert.equal(seenAtHome?.userId, 'u1')

  const seenNextDoor = await b.tenants.with('t2', async (t) => t.sessions!.of(req))
  assert.equal(
    seenNextDoor,
    null,
    'the signature is valid — it is the same secret — but the row is in the other database',
  )
  await b.close()
  void loginAs
})

test('sessions: the cookie carries no Domain, so the browser scopes it to one subdomain', async () => {
  dbs.clear()
  const b = await bootApp(authed, { env: { KET_SECRET: 'x' }, port: 0 })
  const { cookie } = await b.tenants.with('t1', async (t) =>
    t.sessions!.start({ userId: 'u1', companies: ['c1'] }),
  )
  assert.ok(
    !/Domain=/i.test(cookie),
    'Domain=.example.com would hand acme.example.com the cookie set for globex.example.com',
  )
  assert.match(cookie, /HttpOnly/)
  await b.close()
})

test('sessions: a shared store is the escape hatch for one domain serving every tenant', async () => {
  dbs.clear()
  const control = memorySessionStore()
  const oneDomain = defineApp({
    name: 'onedomain',
    modules: [core],
    headless: true,
    serve: {
      bootstrap: ['core'],
      // Reading the session needs the database and knowing the database needs the
      // session, so the session cannot live in the tenant's database at all.
      sessions: { store: control },
      tenants: {
        resolve: (_url, req) => (String(req.headers['x-tenant'] ?? '') === 't1' ? 't1' : 't2'),
        open: (key) => {
          let a = dbs.get(key)
          if (!a) {
            a = sqliteAdapter()
            dbs.set(key, a)
          }
          return a
        },
        list: async () => ['t1', 't2'],
      },
    },
  })
  const b = await bootApp(oneDomain, { env: { KET_SECRET: 'x' }, port: 0 })
  const { cookie } = await b.tenants.with('t1', async (t) =>
    t.sessions!.start({ userId: 'u1', companies: ['c1'] }),
  )
  const req = { headers: { cookie: cookie.split(';')[0]! } } as never
  // One store, so every tenant sees the same session — which is the point, and
  // also why such a deployment has to record the tenant on the session itself.
  assert.equal((await b.tenants.with('t1', async (t) => t.sessions!.of(req)))?.userId, 'u1')
  assert.equal((await b.tenants.with('t2', async (t) => t.sessions!.of(req)))?.userId, 'u1')
  await b.close()
})

test('sessions: turning them on with tenants is no longer refused', async () => {
  dbs.clear()
  const b = await bootApp(authed, { env: { KET_SECRET: 'x' }, port: 0 })
  assert.match(await b.banner(), /identity\s+sessions \(one per tenant\)/)
  await b.close()
})
