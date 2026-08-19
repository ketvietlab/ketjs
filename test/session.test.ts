import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bootApp,
  callFn,
  createSessions,
  dbSessionStore,
  memorySessionStore,
  migrateOne,
  parseCookies,
  sqliteAdapter,
  SESSION_COOKIE,
} from 'ketjs'
import type { SessionStore } from 'ketjs'
import { ketsuite } from '../apps/ketsuite/app.ts'

/**
 * Sessions replace the header shim that every earlier PR had to apologise for.
 *
 * The store is an interface for one reason: sessions in memory behind three pods
 * means a login lands on one and the next request is anonymous on another — a bug
 * that only shows up once you scale, which is the worst moment to find it.
 */

type Make = (now?: () => number) => Promise<{ store: SessionStore; close: () => Promise<void> }>
const stores: Array<[string, Make]> = [
  ['memory', async (now) => ({ store: memorySessionStore(now ? { now } : {}), close: async () => {} })],
  [
    'database',
    async (now) => {
      const adapter = sqliteAdapter()
      await adapter.open()
      return { store: dbSessionStore(adapter, now ? { now } : {}), close: () => adapter.close() }
    },
  ],
]

for (const [name, make] of stores) {
  test(`session (${name}): a started session reads back, and a destroyed one does not`, async () => {
    const { store, close } = await make()
    const s = await createSessions({ store, secret: 'k' })
    const { record } = await s.start({ userId: 'u1', companies: ['c1', 'c2'], company: 'c2' })
    assert.deepEqual((await store.read(record.id))!.companies, ['c1', 'c2'])
    await store.destroy(record.id)
    assert.equal(await store.read(record.id), null)
    await close()
  })

  test(`session (${name}): an expired session is gone on read, not merely stale`, async () => {
    let clock = 1_000_000
    const { store, close } = await make(() => clock)
    const s = await createSessions({ store, secret: 'k', idleTtlMs: 1000, now: () => clock })
    const { record } = await s.start({ userId: 'u1', companies: ['c1'] })
    clock += 999
    assert.notEqual(await store.read(record.id), null)
    clock += 2
    assert.equal(await store.read(record.id), null, 'reading it back would outlive its own expiry')
    await close()
  })

  test(`session (${name}): logging out everywhere ends every session of that user`, async () => {
    const { store, close } = await make()
    const s = await createSessions({ store, secret: 'k' })
    const a = await s.start({ userId: 'u1', companies: ['c1'] })
    const b = await s.start({ userId: 'u1', companies: ['c1'] })
    const other = await s.start({ userId: 'u2', companies: ['c1'] })
    assert.equal(await s.endUser('u1'), 2)
    assert.equal(await store.read(a.record.id), null)
    assert.equal(await store.read(b.record.id), null)
    assert.notEqual(await store.read(other.record.id), null, 'and nobody else is logged out')
    await close()
  })

  test(`session (${name}): sweeping removes what has expired and nothing else`, async () => {
    let clock = 1_000_000
    const { store, close } = await make(() => clock)
    const s = await createSessions({ store, secret: 'k', idleTtlMs: 1000, now: () => clock })
    await s.start({ userId: 'u1', companies: ['c1'] })
    clock += 5000
    const live = await s.start({ userId: 'u2', companies: ['c1'] })
    assert.equal(await s.sweep(), 1)
    assert.notEqual(await store.read(live.record.id), null)
    await close()
  })
}

// ── the cookie ───────────────────────────────────────────────────────────────

const req = (cookie?: string) => ({ headers: cookie ? { cookie } : {} }) as never

test('cookie: a forged id is rejected without touching the store', async () => {
  const store = memorySessionStore()
  let reads = 0
  const counting: SessionStore = {
    ...store,
    read: (id) => {
      reads++
      return store.read(id)
    },
  }
  const s = await createSessions({ store: counting, secret: 'k' })
  assert.equal(await s.of(req('ket_session=made-up.aaaa')), null)
  assert.equal(reads, 0, 'the signature is what makes a forged id cheap to reject')
})

test('cookie: a signature from another secret does not travel', async () => {
  const store = memorySessionStore()
  const podA = await createSessions({ store, secret: 'A' })
  const podB = await createSessions({ store, secret: 'B' })
  const { cookie } = await podA.start({ userId: 'u1', companies: ['c1'] })
  const jar = cookie.split(';')[0]!
  assert.notEqual(await podA.of(req(jar)), null)
  assert.equal(
    await podB.of(req(jar)),
    null,
    'which is why KET_SECRET has to be the same on every pod, and why the banner says so',
  )
})

test('cookie: HttpOnly and SameSite are on, and the id is not the raw record id', async () => {
  const s = await createSessions({ store: memorySessionStore(), secret: 'k', secure: false })
  const { record, cookie } = await s.start({ userId: 'u1', companies: ['c1'] })
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Lax/)
  assert.ok(!cookie.includes('Secure'), 'not over plain http on localhost')
  const value = parseCookies(cookie.split(';')[0])[SESSION_COOKIE]!
  assert.ok(value.startsWith(record.id + '.'), 'id, then signature')
})

test('cookie: a session refreshes while in use but never past its absolute limit', async () => {
  let clock = 1_000_000
  const s = await createSessions({
    store: memorySessionStore({ now: () => clock }),
    secret: 'k',
    idleTtlMs: 1000,
    absoluteTtlMs: 2500,
    now: () => clock,
  })
  const { record, cookie } = await s.start({ userId: 'u1', companies: ['c1'] })
  const jar = cookie.split(';')[0]!
  clock += 900
  assert.equal((await s.of(req(jar)))!.expiresAt, clock + 1000, 'refreshed by use')
  clock += 900
  assert.equal((await s.of(req(jar)))!.expiresAt, record.createdAt + 2500, 'capped, not extended forever')
  clock += 800
  assert.equal(await s.of(req(jar)), null, 'a session that renews forever is a session that never ends')
})

// ── the scope it produces ────────────────────────────────────────────────────

test('session: the scope is exactly the shape D32 defined', async () => {
  const s = await createSessions({ store: memorySessionStore(), secret: 'k' })
  const { record } = await s.start({ userId: 'u1', companies: ['c1', 'c2'], company: 'c2' })
  assert.deepEqual(s.scopeOf(record), { company: 'c2', companies: ['c1', 'c2'], branches: null })
})

test('session: writing to a company the user is not a member of is refused at login', async () => {
  const s = await createSessions({ store: memorySessionStore(), secret: 'k' })
  await assert.rejects(
    () => s.start({ userId: 'u1', companies: ['c1'], company: 'c9' }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_WRITE_COMPANY_NOT_READABLE')
      return true
    },
  )
})

test('session: a user with no company cannot start one at all', async () => {
  const s = await createSessions({ store: memorySessionStore(), secret: 'k' })
  await assert.rejects(
    () => s.start({ userId: 'u1', companies: [] }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_SESSION_NO_COMPANY')
      return true
    },
  )
})

test('session: with no session, anonymous decides — a public storefront still needs a company', async () => {
  const withAnon = await createSessions({
    store: memorySessionStore(),
    secret: 'k',
    anonymous: { company: 'public' },
  })
  assert.deepEqual(withAnon.scopeOf(null), { company: 'public' })
  const without = await createSessions({ store: memorySessionStore(), secret: 'k' })
  assert.equal(without.scopeOf(null), null)
})

test('session: an ephemeral secret is reported, because it is a deployment bug waiting', async () => {
  assert.equal((await createSessions({ store: memorySessionStore() })).ephemeralSecret, true)
  assert.equal((await createSessions({ store: memorySessionStore(), secret: 'k' })).ephemeralSecret, false)
})

// ── end to end ───────────────────────────────────────────────────────────────

test('login: the whole flow, and the header shim is gone rather than kept as a fallback', async () => {
  const b = await bootApp(ketsuite, { env: { KET_SQLITE: ':memory:', KET_SECRET: 'shared' }, port: 0 })
  const at = `http://127.0.0.1:${b.port}`
  const o = { adapter: b.adapter!, manifest: b.manifest, scope: { company: 'acme' } }
  await callFn('partner.savePartner', { id: 'p1', kind: 'company', name: 'Acme' }, o)
  await callFn('company.saveCompany', { id: 'acme', partnerId: 'p1', currency: 'VND' }, o)
  await callFn(
    'user.createUser',
    { id: 'u1', login: 'admin', password: 'correct horse', name: 'Admin', defaultCompanyId: 'acme' },
    o,
  )
  await callFn('user.grantCompany', { id: 'm1', userId: 'u1', companyId: 'acme' }, o)

  const login = (password: string) =>
    fetch(`${at}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'admin', password }),
    })

  assert.equal((await fetch(`${at}/whoami`)).status, 401)
  assert.equal((await login('wrong')).status, 401)

  const ok = await login('correct horse')
  assert.equal(ok.status, 200)
  const jar = (ok.headers.get('set-cookie') ?? '').split(';')[0]!
  assert.ok(jar.startsWith(`${SESSION_COOKIE}=`))

  const me = (await fetch(`${at}/whoami`, { headers: { cookie: jar } }).then((r) => r.json())) as {
    userId: string
    companies: string[]
  }
  assert.equal(me.userId, 'u1')
  assert.deepEqual(me.companies, ['acme'])

  assert.equal((await fetch(`${at}/whoami`, { headers: { cookie: 'ket_session=forged.aaaa' } })).status, 401)
  // The header used to be identity. With sessions on it is not a fallback, it is
  // nothing — a system where a header stands in for a login has no login.
  assert.equal((await fetch(`${at}/whoami`, { headers: { 'x-ket-company': 'acme' } })).status, 401)

  await fetch(`${at}/logout`, { method: 'POST', headers: { cookie: jar } })
  assert.equal((await fetch(`${at}/whoami`, { headers: { cookie: jar } })).status, 401)
  await b.close()
})

test('login: a session survives a restart when the store and the secret are shared', async () => {
  // What "several pods" means, tested with two boots against one database rather
  // than two processes: same store, same secret, different runtime.
  const adapter = sqliteAdapter()
  await adapter.open()
  const store = dbSessionStore(adapter)
  const podA = await createSessions({ store, secret: 'shared' })
  const { cookie } = await podA.start({ userId: 'u1', companies: ['c1'] })
  const jar = cookie.split(';')[0]!

  const podB = await createSessions({ store, secret: 'shared' })
  const seen = await podB.of(req(jar))
  assert.equal(seen?.userId, 'u1', 'a login on one pod is a login on the next')
  await adapter.close()
})

test('store: the database store creates its own table, like every other store here', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, {
    ket: '1',
    order: [],
    modules: {},
    models: {},
    joints: {},
    fills: [],
    functions: {},
    views: {},
    regions: { required: [], provided: {} },
    islands: {},
    sections: {},
    relations: {},
    tokens: {},
    assets: {},
    styles: [],
    routes: {},
    patches: [],
  } as never)
  await dbSessionStore(adapter).init()
  assert.ok('ket_session' in (await adapter.introspect()))
  await adapter.close()
})
