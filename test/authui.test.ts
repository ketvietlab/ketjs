import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp, callFn } from 'ketjs'
import { ketsuite } from '../apps/ketsuite/app.ts'

/**
 * The screens that make the enforcement usable.
 *
 * #20 closed the hole; this is the part that stops the closed door being a bare
 * 401 with no handle on it. A browser gets a form and lands where it was going; a
 * fetch() gets a status, because a redirect to HTML is a useless answer to it.
 */
const setup = async () => {
  const b = await bootApp(ketsuite, { env: { KET_SQLITE: ':memory:', KET_SECRET: 'x' }, port: 0 })
  const o = { adapter: b.adapter!, manifest: b.manifest, scope: { company: 'acme' } }
  await callFn('partner.savePartner', { id: 'p1', kind: 'company', name: 'Acme JSC' }, o)
  await callFn('company.saveCompany', { id: 'acme', partnerId: 'p1', currency: 'VND' }, o)
  await callFn('user.createUser', { id: 'u1', login: 'admin', password: 'correct horse', name: 'Nguyễn Quản Trị', defaultCompanyId: 'acme', superuser: true }, o)
  await callFn('user.grantCompany', { id: 'm1', userId: 'u1', companyId: 'acme' }, o)
  const at = `http://127.0.0.1:${b.port}`
  return { b, at }
}
const HTML = { accept: 'text/html' }
const form = (at: string, fields: Record<string, string>, extra: Record<string, string> = {}) =>
  fetch(`${at}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...HTML, ...extra },
    body: new URLSearchParams(fields).toString(),
  })

test('login: a browser gets a form, not a 405', async () => {
  const { b, at } = await setup()
  const r = await fetch(`${at}/login`, { headers: HTML })
  assert.equal(r.status, 200)
  const html = await r.text()
  assert.match(html, /data-ui="login-form"/)
  assert.match(html, /name="password"/)
  await b.close()
})

test('login: something that is not a browser still gets JSON, not a page', async () => {
  const { b, at } = await setup()
  assert.equal((await fetch(`${at}/login`)).status, 405, 'GET with no Accept: text/html')
  const r = await fetch(`${at}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'correct horse' }),
  })
  assert.equal(r.status, 200)
  assert.equal((await r.json() as { ok: boolean }).ok, true)
  await b.close()
})

test('login: signing in lands where you were going', async () => {
  const { b, at } = await setup()
  const r = await form(at, { login: 'admin', password: 'correct horse', next: '/admin/pages' })
  assert.equal(r.status, 303)
  assert.equal(r.headers.get('location'), '/admin/pages')
  assert.ok(r.headers.get('set-cookie'))
  await b.close()
})

test('login: and only ever somewhere on this site', async () => {
  const { b, at } = await setup()
  for (const next of ['https://ke-tan-cong.com/x', '//ke-tan-cong.com/x', 'javascript:alert(1)']) {
    const r = await form(at, { login: 'admin', password: 'correct horse', next })
    assert.equal(r.headers.get('location'), '/admin', next)
  }
  await b.close()
})

test('login: a wrong password re-renders the form with the reason', async () => {
  const { b, at } = await setup()
  const r = await form(at, { login: 'admin', password: 'sai' })
  assert.equal(r.status, 401)
  assert.match(await r.text(), /data-ui="login-error"/)
  await b.close()
})

test('login: a cross-site POST is refused, because it would log you in as someone else', async () => {
  const { b, at } = await setup()
  // SameSite protects the cookie once it exists, not the request that creates it.
  const r = await form(at, { login: 'admin', password: 'correct horse' }, { origin: 'https://ke-tan-cong.com' })
  assert.equal(r.status, 403)
  assert.equal(r.headers.get('set-cookie'), null)
  await b.close()
})

test('login: already signed in, the form is skipped rather than shown twice', async () => {
  const { b, at } = await setup()
  const jar = (await form(at, { login: 'admin', password: 'correct horse' })).headers.get('set-cookie')!.split(';')[0]!
  const r = await fetch(`${at}/login`, { headers: { ...HTML, cookie: jar }, redirect: 'manual' })
  assert.equal(r.status, 303)
  await b.close()
})

test('backend: a browser is sent to sign in, carrying where it was going', async () => {
  const { b, at } = await setup()
  const r = await fetch(`${at}/admin/pages`, { headers: HTML, redirect: 'manual' })
  assert.equal(r.status, 303)
  assert.equal(r.headers.get('location'), '/login?next=%2Fadmin%2Fpages')
  await b.close()
})

test('backend: a fetch() gets a status, because a redirect to HTML answers nothing', async () => {
  const { b, at } = await setup()
  assert.equal((await fetch(`${at}/admin`, { redirect: 'manual' })).status, 401)
  await b.close()
})

test('backend: signed in, the topbar says who and offers the way out', async () => {
  const { b, at } = await setup()
  const jar = (await form(at, { login: 'admin', password: 'correct horse' })).headers.get('set-cookie')!.split(';')[0]!
  const html = await (await fetch(`${at}/admin`, { headers: { ...HTML, cookie: jar } })).text()
  const bar = html.slice(html.indexOf('data-ui="topbar"'), html.indexOf('data-ui="content"')).replace(/<!--[^>]*-->/g, '')
  assert.match(bar, /data-ui="viewer-name">Nguyễn Quản Trị/)
  assert.match(bar, /data-ui="signout"[^>]*action="\/logout"/)
  await b.close()
})

test('logout: a form post clears the cookie and returns to the sign-in page', async () => {
  const { b, at } = await setup()
  const jar = (await form(at, { login: 'admin', password: 'correct horse' })).headers.get('set-cookie')!.split(';')[0]!
  const out = await fetch(`${at}/logout`, { method: 'POST', headers: { ...HTML, cookie: jar }, redirect: 'manual' })
  assert.equal(out.status, 303)
  assert.equal(out.headers.get('location'), '/login')
  assert.match(out.headers.get('set-cookie') ?? '', /Max-Age=0/)
  assert.equal((await fetch(`${at}/admin`, { headers: { cookie: jar } })).status, 401, 'and the session is really gone')
  await b.close()
})

test('storefront: none of this touches the public site', async () => {
  const { b, at } = await setup()
  assert.equal((await fetch(`${at}/`, { headers: HTML })).status, 200)
  await b.close()
})

test('login: the page carries the stylesheets, like every other screen', async () => {
  // It did not. `head: undefined` shipped a sign-in page with no CSS at all — the
  // markup was right and the page looked broken, which is the kind of bug a type
  // checker cannot see and a screenshot can.
  const { b, at } = await setup()
  const html = await (await fetch(`${at}/login`, { headers: HTML })).text()
  const links = html.match(/<link[^>]*rel="stylesheet"[^>]*>/g) ?? []
  assert.ok(links.length > 0, 'no stylesheet on the sign-in page')
  assert.ok(links.some(l => l.includes('/_ket/asset/backend/')), 'and they come from the installed modules')
  await b.close()
})

test('catalogue: the new states are there for the design team to draw', async () => {
  const { CASES } = await import('ketsuite/backend')
  const ids = CASES.map(c => c.id)
  for (const id of ['login', 'login-failed', 'login-next', 'viewer-one', 'viewer-many', 'viewer-long']) {
    assert.ok(ids.includes(id), `missing catalogue case: ${id}`)
  }
})
