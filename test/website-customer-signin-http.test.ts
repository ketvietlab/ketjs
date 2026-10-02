import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

const strip = async (response: Response) => (await response.text()).replace(/<!--.*?-->/g, '')

/**
 * A visitor signs in to the customer account a Website site owns: from the header where the site
 * chose to offer it, on a page of the site's own look, through the customer API that alone sets the
 * session cookie. Signed in, a reload can still sign out, because the bootstrap hands the token back.
 */
test('Studio customer sign-in: header choice, the sign-in page and a session that can end', async (t) => {
  const { app, fixture } = await bootWebsiteStudio()
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'signin-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  const publishHome = async () => {
    const entry = (await fixture('website.getEntry', { id: 'page-site-a' })).entry as Row
    await fixture('website.publishEntry', { id: 'page-site-a', expectedRevisionId: entry.revisionId })
  }
  await publishHome()
  const visitor = app.client.anonymous()

  // A site that never chose to offer accounts shows no way in, and loads no script for one.
  const plain = await strip(await visitor.get('/'))
  assert.doesNotMatch(plain, /data-customer-account/)
  assert.doesNotMatch(plain, /customer-account\.mjs/)

  const refused = (
    await app.fixture.call<Row>(
      'website.saveStudioStyle',
      { siteId: 'site-a', expectedRevisionId: 'initial', values: { account: 'maybe' } },
      { scope: { company: 'studio-a', branches: null } },
    )
  ).value
  assert.equal(refused?.ok, false)
  await fixture('website.saveStudioStyle', {
    siteId: 'site-a',
    expectedRevisionId: 'initial',
    values: { preset: 'cosmetics', account: 'shown' },
  })
  await publishHome()
  const home = await strip(await visitor.get('/'))
  assert.match(
    home,
    /<a class="wt-public-account" href="\/account\/login" data-customer-account(?:="")?>Đăng nhập<\/a>/,
  )
  assert.match(
    home,
    /<script type="module" src="\/_ket\/asset\/website_backend\/customer-account\.mjs"><\/script>/,
  )

  // The sign-in wears the home page's look, is not for crawlers, and only ever returns on site.
  const page = await visitor.get('/account/login?returnTo=%2Fsan-pham%3Fx%3D1')
  assert.equal(page.status, 200)
  const signin = await strip(page)
  assert.match(signin, /data-theme-preset="cosmetics"/)
  assert.match(signin, /<meta name="robots" content="noindex">/)
  assert.match(signin, /data-customer-signin(?:="")? data-return-to="\/san-pham\?x=1"/)
  // The script's words ride on the page, in its language; the welcome names the site.
  assert.match(signin, /data-messages="[^"]*Thông tin chưa đúng[^"]*"/)
  assert.match(signin, /Chào mừng bạn quay lại site-a\./)
  assert.match(
    signin,
    /<button class="wt-public-signin__reveal" type="button" aria-label="Hiện mật khẩu" aria-pressed="false">/,
  )
  assert.match(signin, /<input type="password" name="password"[^>]*autocomplete="current-password"/)
  assert.match(signin, /customer-account\.mjs/)
  assert.doesNotMatch(signin, /data-customer-account/, 'the sign-in needs no link to itself')
  for (const away of [
    'https://evil.test/',
    '//evil.test/',
    '/\\evil.test',
    '/account/login',
    'san-pham',
    '/a\u0001b',
  ]) {
    const html = await strip(await visitor.get(`/account/login?${new URLSearchParams({ returnTo: away })}`))
    assert.match(html, /data-return-to="\/"/, away)
  }
  // Without the script the browser posts the form here; the password is not read, the page comes back.
  const posted = await visitor.post('/account/login?returnTo=%2Fcham-soc', 'login=a&password=b', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(posted.status, 303)
  assert.equal(posted.headers.get('location'), '/account/login?returnTo=%2Fcham-soc')
  assert.equal((await visitor.get('/_ket/asset/website_backend/customer-account.mjs')).status, 200)

  await fixture('partner.savePartner', { id: 'cuc', kind: 'person', name: 'Chị Cúc' })
  await fixture('website.issueCustomerAccess', {
    siteId: 'site-a',
    partnerId: 'cuc',
    phone: '0708580468',
    password: 'lanh-local-1',
  })
  const api = (path: string, init: RequestInit = {}) =>
    visitor.request(`/api/customer/v1/${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
    })
  const anonymous = (await (await api('bootstrap')).json()) as { data: Row }
  assert.equal(anonymous.data.customer, null)
  assert.equal(anonymous.data.csrfToken, null)

  const wrong = await api('auth/session/login', {
    method: 'POST',
    body: JSON.stringify({ phone: '0708580468', password: 'not-it' }),
  })
  assert.equal(wrong.status, 401)
  const login = await api('auth/session/login', {
    method: 'POST',
    body: JSON.stringify({ phone: '0708 580 468', password: 'lanh-local-1' }),
  })
  assert.equal(login.status, 200)
  const signedIn = ((await login.json()) as { data: { csrfToken: string; customer: Row } }).data
  assert.equal(signedIn.customer.displayName, 'Chị Cúc')

  // A reload has only the cookie; the bootstrap gives back the token sign-out needs.
  const after = ((await (await api('bootstrap')).json()) as { data: Row }).data
  assert.equal((after.customer as Row).displayName, 'Chị Cúc')
  assert.equal(after.csrfToken, signedIn.csrfToken)
  assert.equal((await api('auth/logout', { method: 'POST' })).status, 403)
  assert.equal(
    (await api('auth/logout', { method: 'POST', headers: { 'x-csrf-token': String(after.csrfToken) } }))
      .status,
    200,
  )
  const out = ((await (await api('bootstrap')).json()) as { data: Row }).data
  assert.equal(out.customer, null)
})
