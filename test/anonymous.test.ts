import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bootDeployment,
  callFn,
  compose,
  defineDeployment,
  defineModule,
  json,
  text,
} from '@ketvietlab/ketjs'
import type { Ctx, RouteEntry, ServeContext, Route } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

/**
 * A request with no session is a stranger, not an unrestricted caller.
 *
 * `allow: null` means unrestricted and that is right for an in-process call — a
 * migration, a script, a test. It was also what an anonymous HTTP request got,
 * which meant anyone could create a user account and then log in as it. The rule
 * "restriction begins where identity does" was correct about internal calls and
 * catastrophically wrong about strangers.
 */

const boot = () => bootDeployment(ketsuite, { env: { KET_SQLITE: ':memory:', KET_SECRET: 'x' }, port: 0 })
const post = (port: number, fn: string, body: unknown, cookie?: string) =>
  fetch(`http://127.0.0.1:${port}/_ket/fn/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  }).then((r) => r.json() as Promise<{ code?: string; ok?: boolean }>)

test('anonymous: cannot create an account, which is the whole exploit', async () => {
  const b = await boot()
  const r = await post(b.port, 'user.createUser', {
    id: 'hack',
    login: 'hack',
    password: '12345678',
    name: 'H',
  })
  assert.equal(r.code, 'E_FN_NOT_PERMITTED')
  assert.equal((await b.adapter!.all('SELECT * FROM user_user', [])).length, 0, 'and nothing was written')
  await b.close()
})

test('anonymous: cannot hand itself a role either', async () => {
  const b = await boot()
  assert.equal(
    (await post(b.port, 'user.saveRole', { id: 'r', name: 'toàn quyền' })).code,
    'E_FN_NOT_PERMITTED',
  )
  assert.equal(
    (await post(b.port, 'user.grantFunction', { id: 'g', roleId: 'r', fnKey: 'user.createUser' })).code,
    'E_FN_NOT_PERMITTED',
  )
  await b.close()
})

test('anonymous: cannot read business data', async () => {
  const b = await boot()
  assert.equal((await post(b.port, 'partner.listPartners', {})).code, 'E_FN_NOT_PERMITTED')
  assert.equal((await post(b.port, 'product.listTemplates', {})).code, 'E_FN_NOT_PERMITTED')
  await b.close()
})

test('anonymous: cannot bypass the trusted login route to call authentication', async () => {
  const b = await boot()
  const r = await post(b.port, 'user.authenticate', { login: 'nobody', password: 'x' })
  assert.equal(r.code, 'E_FUNCTION_INTERNAL')
  await b.close()
})

test('anonymous: may read a published page, because a storefront is public', async () => {
  const b = await boot()
  assert.equal((await post(b.port, 'website.getPageByPath', { path: '/' })).code, undefined)
  await b.close()
})

test('routes: the backend is closed to a stranger, and says so rather than rendering', async () => {
  const b = await boot()
  for (const p of ['/admin']) {
    const r = await fetch(`http://127.0.0.1:${b.port}${p}`)
    assert.equal(r.status, 401, p)
    assert.ok(!(await r.text()).includes('data-ui="app-grid"'), `${p} rendered the screen anyway`)
  }
  await b.close()
})

test('routes: the storefront stays open, which is the point of the distinction', async () => {
  const b = await boot()
  try {
    const full = await fetch(`http://127.0.0.1:${b.port}/`)
    assert.equal(full.status, 200)
    const fullHtml = await full.text()
    assert.match(fullHtml, /data-ket-slot="website\.page"/)
    assert.match(fullHtml, /data-island="website\.search"/)

    const navigation = await fetch(`http://127.0.0.1:${b.port}/`, {
      headers: { 'x-ket-navigation': 'fragment-v1' },
    })
    assert.equal(navigation.status, 200)
    assert.equal(navigation.headers.get('content-type'), 'text/vnd.ket.fragments+html; charset=utf-8')
    const fragment = await navigation.text()
    assert.match(fragment, /^<ket-fragments /)
    assert.match(fragment, /<template data-ket-slot="website\.page">/)
    assert.doesNotMatch(fragment, /<!doctype|<html|<body|data-ket-section="menu"|website\.search/)
  } finally {
    await b.close()
  }
})

test('routes: signing in opens what was closed', async () => {
  const b = await boot()
  const o = { adapter: b.adapter!, manifest: b.manifest, scope: { company: 'acme' } }
  await callFn('partner.savePartner', { id: 'p1', kind: 'company', name: 'Acme' }, o)
  await callFn('company.saveCompany', { id: 'acme', partnerId: 'p1', currency: 'VND' }, o)
  await callFn(
    'user.createUser',
    {
      id: 'u1',
      login: 'admin',
      password: 'correct horse',
      name: 'A',
      defaultCompanyId: 'acme',
      superuser: true,
    },
    o,
  )
  await callFn('user.grantCompany', { id: 'm1', userId: 'u1', companyId: 'acme' }, o)

  const login = await fetch(`http://127.0.0.1:${b.port}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'correct horse' }),
  })
  const jar = login.headers.get('set-cookie')!.split(';')[0]!
  assert.equal((await fetch(`http://127.0.0.1:${b.port}/admin`, { headers: { cookie: jar } })).status, 200)
  assert.equal((await post(b.port, 'partner.listPartners', {}, jar)).code, undefined)
  await b.close()
})

// ── the declaration, at the level it is declared ─────────────────────────────

test('declaration: a function is closed unless it says otherwise', () => {
  const m = compose([
    defineModule({
      name: 'd',
      functions: {
        shut: { effects: [], handler: () => null },
        open: { anonymous: true, effects: [], handler: () => null },
      },
    }),
  ])
  assert.equal(m.functions['d.shut']!.anonymous, false)
  assert.equal(m.functions['d.open']!.anonymous, true)
})

test('declaration: so is a route, and the terse form is the closed one', () => {
  const handler =
    (_ctx: ServeContext): Route =>
    async () =>
      text('x')
  const m = compose([
    defineModule({
      name: 'r',
      routes: {
        '/shut': handler,
        '/open': { anonymous: true, handler } satisfies RouteEntry,
      },
    }),
  ])
  assert.equal(m.routes['/shut']!.anonymous, false, 'a default of open is a default nobody notices')
  assert.equal(m.routes['/open']!.anonymous, true)
})

test('declaration: an app with no sessions is unaffected, since there is no login to be outside of', async () => {
  const solo = defineModule({
    name: 'solo',
    models: { Thing: { scope: 'shared', fields: { id: 'id' } } },
    functions: { list: { effects: ['read:solo.Thing'], handler: (ctx: Ctx) => ctx.db.select('solo.Thing') } },
    routes: {
      '/things':
        (ctx: ServeContext): Route =>
        async (url, req) =>
          json(await ctx.call('solo.list', {}, url, req)),
    },
  })
  const app = defineDeployment({ name: 'nologin', modules: [solo], headless: true, serve: {} })
  const b = await bootDeployment(app, { env: { KET_SQLITE: ':memory:' }, port: 0 })
  assert.equal((await fetch(`http://127.0.0.1:${b.port}/things`)).status, 200)
  await b.close()
})

test('routes: anonymous policy also applies to dynamic paths', async () => {
  const route =
    (label: string) =>
    (_ctx: ServeContext): Route =>
    async (_url, _req, params) =>
      text(`${label}:${params.slug}`)
  const catalog = defineModule({
    name: 'catalog_routes',
    routes: {
      '/private/{slug}': route('private'),
      '/public/{slug}': { anonymous: true, handler: route('public') },
    },
  })
  const app = defineDeployment({
    name: 'route_access',
    modules: [catalog],
    headless: true,
    serve: {
      sessions: { secret: 'test-only', anonymous: { company: 'public' } },
    },
  })
  const b = await bootDeployment(app, { env: { KET_SQLITE: ':memory:' }, port: 0 })
  const at = `http://127.0.0.1:${b.port}`
  assert.equal((await fetch(`${at}/private/ao`)).status, 401)
  const open = await fetch(`${at}/public/%C3%A1o`)
  assert.equal(open.status, 200)
  assert.equal(await open.text(), 'public:áo')
  await b.close()
})
