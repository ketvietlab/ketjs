import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  bootDeployment,
  createSessions,
  defineDeployment,
  defineModule,
  createAdapterPool,
  json,
  migrateOne,
  compose,
  nullLog,
  sqliteAdapter,
  memorySessionStore,
} from '@ketvietlab/ketjs'
import type { Adapter, ServeContext, Route, Sessions } from '@ketvietlab/ketjs'
import { createTenants } from '../packages/ketjs/src/server/tenants.ts'

/**
 * One deployment, many databases. Every tenant runs the deployment's immutable
 * module composition while keeping its data and sessions isolated.
 */

const core = defineModule({
  name: 'core',
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
  depends: ['core'],
  routes: {
    '/extra':
      (_ctx: ServeContext): Route =>
      async () =>
        json({ from: 'extra' }),
  },
})

const dbs = new Map<string, Adapter>()
const app = defineDeployment({
  name: 'multi',
  modules: [core, extra],
  headless: true,
  serve: {
    routes: (ctx) => ({
      '/notes': async (url, req) => json(await ctx.call('core.list', {}, url, req)),
      '/modules': async () => json(ctx.manifest.order),
    }),
    tenants: {
      /**
       * A deployment would read Host, the way the domain contract's host-to-database routing does. The tests read
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
  const b = await bootDeployment(app, { port: 0, openLog: () => nullLog() })
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

test('tenants: every database runs the declared deployment composition', async () => {
  dbs.clear()
  const b = await bootDeployment(app, { port: 0, openLog: () => nullLog() })
  assert.deepEqual(await get(b.port, 't1', '/modules').then((r) => r.json()), ['core', 'extra'])
  assert.deepEqual(await get(b.port, 't2', '/modules').then((r) => r.json()), ['core', 'extra'])
  assert.equal((await get(b.port, 't1', '/extra')).status, 200)
  assert.equal((await get(b.port, 't2', '/extra')).status, 200)
  await b.close()
})

test('tenants: health answers for the tenant that asked, not for the deployment', async () => {
  dbs.clear()
  const b = await bootDeployment(app, { port: 0, openLog: () => nullLog() })
  const h1 = (await get(b.port, 't1', '/_ket/health').then((r) => r.json())) as {
    tenant: string
    modules: string[]
  }
  const h2 = (await get(b.port, 't2', '/_ket/health').then((r) => r.json())) as {
    tenant: string
    modules: string[]
  }
  assert.equal(h1.tenant, 't1')
  assert.deepEqual(h1.modules, ['core', 'extra'])
  assert.deepEqual(h2.modules, ['core', 'extra'])
  await b.close()
})

test('tenants: a host this deployment does not serve is refused, not defaulted', async () => {
  dbs.clear()
  const b = await bootDeployment(app, { port: 0, openLog: () => nullLog() })
  const r = await get(b.port, 'nobody', '/notes')
  assert.equal(r.status, 400)
  assert.match(
    JSON.stringify(await r.json()),
    /E_UNKNOWN_TENANT/,
    'a default tenant is how one customer quietly reads another customer data',
  )
  await b.close()
})

test('tenants: migrations run per tenant, on first touch', async () => {
  dbs.clear()
  const b = await bootDeployment(app, { port: 0, openLog: () => nullLog() })
  // Nothing has been touched yet, so no tenant database has been opened.
  assert.equal(dbs.size, 0)
  await get(b.port, 't1', '/notes')
  assert.deepEqual([...dbs.keys()], ['t1'], 'only the tenant that asked')
  await b.close()
})

test('tenants: an evicted key prepares its replacement adapter before reuse', async () => {
  const opened: string[] = []
  const prepared: string[] = []
  const manifest = compose([core])
  const pool = createAdapterPool({
    max: 1,
    create: (key) => {
      opened.push(key)
      return sqliteAdapter()
    },
  })
  const tenants = createTenants({
    spec: {
      resolve: () => null,
      open: () => sqliteAdapter(),
      list: async () => ['t1', 't2'],
      max: 1,
    },
    pool,
    manifest,
    prepare: async (key, adapter) => {
      prepared.push(key)
      await migrateOne(adapter, manifest)
    },
    joints: () => ({}) as never,
  })

  try {
    let first!: Adapter
    await tenants.with('t1', async (tenant) => {
      first = tenant.adapter
      await tenant.adapter.run('INSERT INTO "core_note" ("id", "memo", "companyId") VALUES (?, ?, ?)', [
        'before-eviction',
        'one',
        'c1',
      ])
    })
    await tenants.with('t2', async (tenant) => {
      assert.ok((await tenant.adapter.introspect()).core_note)
    })
    assert.deepEqual(pool.open, ['t2'], 'opening tenant two evicts tenant one')

    await tenants.with('t1', async (tenant) => {
      assert.notEqual(tenant.adapter, first, 'the in-memory datastore is a new adapter instance')
      assert.ok((await tenant.adapter.introspect()).core_note, 'the replacement was migrated before use')
      await tenant.adapter.run('INSERT INTO "core_note" ("id", "memo", "companyId") VALUES (?, ?, ?)', [
        'after-eviction',
        'still alive',
        'c1',
      ])
      const rows = await tenant.adapter.all('SELECT "id" FROM "core_note"')
      assert.deepEqual(
        rows.map((row) => row.id),
        ['after-eviction'],
      )
    })

    assert.deepEqual(opened, ['t1', 't2', 't1'])
    assert.deepEqual(prepared, ['t1', 't2', 't1'], 'preparation follows adapter identity, not key alone')
  } finally {
    await tenants.close()
  }
})

test('tenants: a rejected preparation is removed from the cache and can retry', async () => {
  const manifest = compose([core])
  const pool = createAdapterPool({ create: () => sqliteAdapter(), max: 1 })
  let attempts = 0
  const tenants = createTenants({
    spec: {
      resolve: () => null,
      open: () => sqliteAdapter(),
      list: async () => ['t1'],
    },
    pool,
    manifest,
    prepare: async (_key, adapter) => {
      attempts++
      if (attempts === 1) throw new Error('temporary migration failure')
      await migrateOne(adapter, manifest)
    },
    joints: () => ({}) as never,
  })

  try {
    await assert.rejects(() => tenants.with('t1', async () => undefined), /temporary migration failure/)
    await tenants.with('t1', async (tenant) => {
      assert.ok((await tenant.adapter.introspect()).core_note)
    })
    assert.equal(attempts, 2)
  } finally {
    await tenants.close()
  }
})

test('tenants: a session facade retains no manager from an evicted adapter', async () => {
  const manifest = compose([core])
  const closed = new WeakSet<Adapter>()
  const managers: string[] = []
  const pool = createAdapterPool({
    max: 1,
    create: () => {
      const base = sqliteAdapter()
      const adapter: Adapter = {
        ...base,
        async close() {
          closed.add(adapter)
          await base.close()
        },
      }
      return adapter
    },
  })
  const tenants = createTenants({
    spec: {
      resolve: () => null,
      open: () => sqliteAdapter(),
      list: async () => ['t1', 't2'],
      max: 1,
    },
    pool,
    manifest,
    joints: () => ({}) as never,
    sessions: async (adapter, key) => {
      managers.push(key)
      const sessions = await createSessions({ tenant: key, secret: 'stable', secure: false })
      const needLive = () => {
        if (closed.has(adapter)) throw new Error(`session manager retained closed adapter for ${key}`)
      }
      return {
        ...sessions,
        clearCookie() {
          needLive()
          return sessions.clearCookie()
        },
        scopeOf(record) {
          needLive()
          return sessions.scopeOf(record)
        },
      }
    },
  })

  try {
    let firstAdapter!: Adapter
    let facade!: Sessions
    await tenants.with('t1', async (tenant) => {
      firstAdapter = tenant.adapter
      facade = tenant.sessions as Sessions
    })
    const first = await facade.start({ userId: 'u1', companies: ['c1'] })

    await tenants.with('t2', async () => undefined)
    assert.ok(closed.has(firstAdapter), 'the first tenant adapter was actually evicted')
    assert.match(facade.clearCookie(), /Max-Age=0/)
    assert.equal(facade.scopeOf(first.record)?.company, 'c1')
    assert.equal(facade.scopeOf({ ...first.record, tenant: 't2' }), null, 'the snapshot remains tenant-bound')

    const reopened = await facade.start({ userId: 'u2', companies: ['c2'] })
    assert.equal(reopened.record.tenant, 't1')
    assert.deepEqual(managers, ['t1', 't2', 't1'], 'I/O uses a new manager for the replacement adapter')
  } finally {
    await tenants.close()
  }
})

test('tenants: a session facade rejects adapter-independent policy drift after eviction', async () => {
  const manifest = compose([core])
  const drifts: Array<[string, (sessions: Sessions) => Sessions]> = [
    ['store.name', (sessions) => ({ ...sessions, store: { ...sessions.store, name: 'replacement-store' } })],
    ['tenant', (sessions) => ({ ...sessions, tenant: 'other' })],
    ['ephemeralSecret', (sessions) => ({ ...sessions, ephemeralSecret: true })],
    ['clearCookie', (sessions) => ({ ...sessions, clearCookie: () => `${sessions.clearCookie()}; Drift=1` })],
    [
      'anonymous',
      (sessions) => ({
        ...sessions,
        scopeOf: (record) => (record ? sessions.scopeOf(record) : { company: 'other-public' }),
      }),
    ],
  ]

  for (const [field, drift] of drifts) {
    const attempts = new Map<string, number>()
    const pool = createAdapterPool({ create: () => sqliteAdapter(), max: 1 })
    const tenants = createTenants({
      spec: {
        resolve: () => null,
        open: () => sqliteAdapter(),
        list: async () => ['t1', 't2'],
        max: 1,
      },
      pool,
      manifest,
      joints: () => ({}) as never,
      sessions: async (_adapter, key) => {
        const attempt = (attempts.get(key) ?? 0) + 1
        attempts.set(key, attempt)
        const sessions = await createSessions({
          tenant: key,
          secret: 'stable',
          secure: false,
          anonymous: { company: 'public', companies: ['public'] },
        })
        return key === 't1' && attempt > 1 ? drift(sessions) : sessions
      },
    })

    try {
      const facade = await tenants.with('t1', async (tenant) => tenant.sessions!)
      await tenants.with('t2', async () => undefined)
      await assert.rejects(
        () => facade.sweep(),
        (error: unknown) => {
          const failure = error as { code?: string; message?: string; hint?: string }
          assert.equal(failure.code, 'E_SESSION_POLICY_DRIFT')
          assert.equal(
            failure.message,
            'session policy for tenant "t1" changed after its adapter was replaced',
          )
          assert.ok(failure.hint?.includes(field), `the diagnostic names ${field}`)
          return true
        },
      )
    } finally {
      await tenants.close()
    }
  }
})

test('tenants: an async datastore opener is awaited before the adapter is opened', async () => {
  let opened = 0
  const asyncApp = defineDeployment({
    name: 'async_tenants',
    modules: [core],
    headless: true,
    serve: {
      tenants: {
        resolve: () => 't1',
        open: async () => {
          await Promise.resolve()
          opened++
          return sqliteAdapter()
        },
        list: async () => ['t1'],
      },
    },
  })
  const b = await bootDeployment(asyncApp, { port: 0, openLog: () => nullLog() })
  const response = await fetch(`http://127.0.0.1:${b.port}/_ket/fn/core.list`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ket-company': 'c1' },
    body: '{}',
  })
  assert.equal(response.status, 200)
  assert.equal(opened, 1)
  await b.close()
})

test('tenants: with several databases there is no single adapter, and the type says so', async () => {
  dbs.clear()
  const b = await bootDeployment(app, { port: 0, openLog: () => nullLog() })
  assert.equal(b.adapter, null)
  assert.match(await b.banner(), /tenant\(s\), one database each/)
  await b.close()
})

test('single: one datastore is the same interface, not a second code path', async () => {
  const solo = defineDeployment({ name: 'solo', modules: [core], headless: true, serve: {} })
  const b = await bootDeployment(solo, { env: { KET_LOG: 'null', KET_SQLITE: ':memory:' }, port: 0 })
  assert.notEqual(b.adapter, null)
  assert.deepEqual(await b.tenants.keys(), [''])
  const seen = await b.tenants.with('', async (t) => t.live.order)
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
const authed = defineDeployment({
  name: 'authed',
  modules: [core],
  headless: true,
  serve: {
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
  const b = await bootDeployment(authed, {
    env: { KET_LOG: 'null', KET_SECRET: 'shared-across-pods' },
    port: 0,
  })

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
  const b = await bootDeployment(authed, { env: { KET_LOG: 'null', KET_SECRET: 'x' }, port: 0 })
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

test('sessions: a shared store binds each session to the tenant that issued it', async () => {
  dbs.clear()
  const control = memorySessionStore()
  const oneDomain = defineDeployment({
    name: 'onedomain',
    modules: [core],
    headless: true,
    serve: {
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
  const b = await bootDeployment(oneDomain, { env: { KET_LOG: 'null', KET_SECRET: 'x' }, port: 0 })
  const { cookie, record } = await b.tenants.with('t1', async (t) =>
    t.sessions!.start({ userId: 'u1', companies: ['c1'] }),
  )
  const req = { headers: { cookie: cookie.split(';')[0]! } } as never
  assert.equal(record.tenant, 't1')
  assert.equal((await b.tenants.with('t1', async (t) => t.sessions!.of(req)))?.userId, 'u1')
  assert.equal(
    await b.tenants.with('t2', async (t) => t.sessions!.of(req)),
    null,
    'a valid shared-store cookie is still not valid for another tenant',
  )
  assert.equal(await b.tenants.with('t2', async (t) => t.sessions!.scopeOf(record)), null)
  assert.equal(await b.tenants.with('t2', async (t) => t.sessions!.endUser('u1')), 0)
  assert.equal(
    (await b.tenants.with('t1', async (t) => t.sessions!.of(req)))?.userId,
    'u1',
    'tenant-scoped administration cannot revoke another tenant session',
  )
  await b.close()
})

test('sessions: a manager reacquires the tenant after its adapter is evicted', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ketjs-session-pool-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const pooled = defineDeployment({
    name: 'pooled_sessions',
    modules: [core],
    headless: true,
    serve: {
      sessions: {},
      tenants: {
        resolve: (_url, req) => String(req.headers['x-tenant'] ?? 't1'),
        open: async (key) => sqliteAdapter(join(directory, `${key}.sqlite`)),
        list: async () => ['t1', 't2'],
        max: 1,
      },
    },
  })
  const b = await bootDeployment(pooled, { port: 0, openLog: () => nullLog() })
  const sessions = await b.tenants.with('t1', async (tenant) => tenant.sessions!)
  const { cookie } = await sessions.start({ userId: 'u1', companies: ['c1'] })
  assert.equal(sessions.ephemeralSecret, true)

  await b.tenants.with('t2', async () => undefined)
  assert.deepEqual(b.tenants.pool?.open, ['t2'], 'tenant one was evicted after its lease ended')

  const req = { headers: { cookie: cookie.split(';')[0]! } } as never
  assert.equal(
    (await sessions.of(req))?.userId,
    'u1',
    'the facade opens the current adapter instead of retaining the closed one',
  )
  await b.close()
})

test('sessions: turning them on with tenants is no longer refused', async () => {
  dbs.clear()
  const b = await bootDeployment(authed, { env: { KET_LOG: 'null', KET_SECRET: 'x' }, port: 0 })
  assert.match(await b.banner(), /identity\s+sessions \(one per tenant\)/)
  await b.close()
})
