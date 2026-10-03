import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

const API = '/api/customer/v1'
const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

/**
 * A customer who forgot the password asks for a link by phone or email; one with an email gets it
 * from the company's own template, everyone hears the same, and the link works once.
 */
test('Customer password reset: mailed once to an account with an email, the same answer for everyone', async (t) => {
  const { app, fixture } = await bootWebsiteStudio()
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'reset-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  const home = (await fixture('website.getEntry', { id: 'page-site-a' })).entry as Row
  await fixture('website.publishEntry', { id: 'page-site-a', expectedRevisionId: home.revisionId })
  for (const [id, name, phone, email] of [
    ['cuc', 'Chị Cúc', '0708580468', 'cuc@example.com'],
    ['lan', 'Chị Lan', '0912345678', ''],
  ])
    await fixture('partner.savePartner', { id, kind: 'person', name, phone, email })
  await fixture('website.issueCustomerAccess', {
    siteId: 'site-a',
    partnerId: 'cuc',
    phone: '0708580468',
    email: 'cuc@example.com',
    password: 'cu-123456',
  })
  await fixture('website.issueCustomerAccess', {
    siteId: 'site-a',
    partnerId: 'lan',
    phone: '0912345678',
    password: 'lan-123456',
  })
  const staff = { scope: { company: 'studio-a', branches: null }, actor: 'studio-designer' }
  const outbox = async () =>
    ((await app.fixture.call<Row>('mail_transport.listOutbox', {}, staff)).value.deliveries as Row[]).filter(
      (d) => d.templateName === 'website.customer.password-reset',
    )

  const visitor = app.client.anonymous()
  const forgot = (body: Row) => visitor.request(`${API}/auth/password/forgot`, json(body))
  const away = { origin: 'https://khac.example' }
  assert.equal(
    (await visitor.request(`${API}/auth/password/forgot`, json({ email: 'cuc@example.com' }, away))).status,
    403,
  )
  assert.equal(
    (await visitor.request(`${API}/auth/password/reset`, json({ token: 'x', password: 'moi-123456' }, away)))
      .status,
    403,
  )
  // Without the company's template nothing can be sent, and the visitor is told the same.
  assert.equal((await forgot({ email: 'cuc@example.com' })).status, 202)
  assert.equal((await outbox()).length, 0)

  await app.fixture.call(
    'mail_transport.saveTemplate',
    {
      id: 'reset-template',
      name: 'website.customer.password-reset',
      fromAddress: 'shop@example.com',
      subjectTemplate: 'Đặt lại mật khẩu tại {{siteTitle}}',
      textTemplate: 'Chào {{displayName}}, mở {{resetUrl}} để chọn mật khẩu mới.',
      allowedKeys: ['siteTitle', 'displayName', 'resetUrl'],
      active: true,
    },
    staff,
  )
  for (const body of [{ email: 'khong-co@example.com' }, { phone: '0912345678' }, { phone: '0999999999' }]) {
    const response = await forgot(body)
    assert.equal(response.status, 202, JSON.stringify(body))
    assert.deepEqual(((await response.json()) as Row).data, { accepted: true })
  }
  assert.equal((await outbox()).length, 0, 'no account, or no email to mail it to')

  // By phone, the link goes to the account's email, on the site the visitor asked from.
  assert.equal((await forgot({ phone: '0708 580 468' })).status, 202)
  const [mail] = await outbox()
  assert.deepEqual(mail!.to, [{ address: 'cuc@example.com' }])
  assert.equal(mail!.subject, 'Đặt lại mật khẩu tại site-a')
  const link = new URL(/https?:\/\/\S+/.exec(String(mail!.text))![0])
  assert.equal(link.pathname, '/account/reset')
  assert.equal(link.host, new URL(app.baseUrl).host)
  const token = link.searchParams.get('token')!
  assert.ok(token.length >= 40)

  // The reset page is the site's own and never carries the token in its markup.
  const page = await (await visitor.get(`/account/reset?token=${token}`)).text()
  assert.match(page, /data-customer-view="reset"/)
  assert.ok(!page.includes(token))
  assert.match(page, /<meta name="robots" content="noindex">/)

  const reset = (body: Row) => visitor.request(`${API}/auth/password/reset`, json(body))
  const signIn = (password: string) =>
    app.client.anonymous().request(`${API}/auth/session/login`, json({ phone: '0708580468', password }))
  assert.equal((await reset({ token: 'not-a-token', password: 'moi-123456' })).status, 422)
  const short = await reset({ token, password: '123' })
  assert.equal(short.status, 422)
  assert.equal(
    ((await short.json()) as { error: Row }).error.messageKey,
    'website.customer.error.invalidPassword',
  )
  const device = app.client.anonymous()
  await device.request(`${API}/auth/session/login`, json({ phone: '0708580468', password: 'cu-123456' }))
  const signedIn = async () =>
    (
      (await (await device.request(`${API}/bootstrap`, { headers: {} })).json()) as {
        data: { customer: Row | null }
      }
    ).data.customer
  assert.ok(await signedIn())
  const done = await reset({ token, password: 'moi-123456' })
  assert.equal(done.status, 200, await done.clone().text())
  assert.equal(await signedIn(), null, 'a reset signs every device out')
  assert.notEqual((await signIn('cu-123456')).status, 200)
  assert.equal((await signIn('moi-123456')).status, 200)
  const again = await reset({ token, password: 'lai-123456' })
  assert.equal(again.status, 422, 'a link works once')
  assert.equal(
    ((await again.json()) as { error: Row }).error.messageKey,
    'website.customer.error.resetExpired',
  )

  // Spending one link voids every other the account was sent.
  await forgot({ email: 'cuc@example.com' })
  await forgot({ email: 'cuc@example.com' })
  const links = (await outbox()).map((d) =>
    new URL(/https?:\/\/\S+/.exec(String(d.text))![0]).searchParams.get('token'),
  )
  assert.equal(links.length, 3)
  assert.equal((await reset({ token: links[0], password: 'moi-654321' })).status, 200)
  assert.equal((await reset({ token: links[1], password: 'moi-777777' })).status, 422)

  // Half an hour later the link has lapsed.
  await forgot({ phone: '0708580468' })
  const late = new URL(/https?:\/\/\S+/.exec(String((await outbox())[0]!.text))![0]).searchParams.get('token')
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 31 * 60_000 })
  const lapsed = await reset({ token: late, password: 'tre-123456' })
  t.mock.timers.reset()
  assert.equal(
    ((await lapsed.json()) as { error: Row }).error.messageKey,
    'website.customer.error.resetExpired',
  )
  assert.equal((await reset({ token: late, password: 'tre-123456' })).status, 200, 'good until then')

  // A closed account gets no link.
  await fixture('website.disableCustomerAccess', { partnerId: 'cuc' })
  await forgot({ phone: '0708580468' })
  assert.equal((await outbox()).length, 4)
})

test('My account: the signed-in customer renames themselves and changes the password', async (t) => {
  const { app, fixture } = await bootWebsiteStudio()
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'account-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  const home = (await fixture('website.getEntry', { id: 'page-site-a' })).entry as Row
  await fixture('website.publishEntry', { id: 'page-site-a', expectedRevisionId: home.revisionId })
  await fixture('partner.savePartner', { id: 'cuc', kind: 'person', name: 'Chị Cúc', phone: '0708580468' })
  await fixture('website.issueCustomerAccess', {
    siteId: 'site-a',
    partnerId: 'cuc',
    phone: '0708580468',
    password: 'cu-123456',
  })

  const visitor = app.client.anonymous()
  for (const path of ['/account', '/account/forgot', '/account/reset']) {
    const response = await visitor.get(path)
    assert.equal(response.status, 200, path)
    assert.match(await response.text(), /data-customer-view=/)
  }
  const login = await visitor.request(
    `${API}/auth/session/login`,
    json({ phone: '0708580468', password: 'cu-123456' }),
  )
  const { csrfToken } = ((await login.json()) as { data: Row }).data
  const csrf = { 'x-csrf-token': String(csrfToken) }
  const rename = (headers: Record<string, string>) =>
    visitor.request(`${API}/me/profile`, { ...json({ displayName: 'Cúc Nguyễn' }, headers), method: 'PATCH' })
  assert.equal((await rename({})).status, 403, 'a cookie session needs its CSRF token')
  const renamed = await rename(csrf)
  assert.equal(renamed.status, 200)
  assert.equal(
    ((await renamed.json()) as { data: { customer: Row } }).data.customer.displayName,
    'Cúc Nguyễn',
  )

  const other = app.client.anonymous()
  await other.request(`${API}/auth/session/login`, json({ phone: '0708580468', password: 'cu-123456' }))
  const me = async (client: typeof visitor) =>
    (
      (await (await client.request(`${API}/bootstrap`, { headers: {} })).json()) as {
        data: { customer: Row | null }
      }
    ).data.customer
  assert.equal((await me(other))!.displayName, 'Cúc Nguyễn')
  assert.equal((await me(other))!.phone, '0708580468', 'the account page shows the number it signs in with')

  const change = (currentPassword: string, newPassword: string, headers = csrf) =>
    visitor.request(`${API}/auth/password`, json({ currentPassword, newPassword }, headers))
  const wrong = await change('sai-123456', 'moi-123456')
  assert.equal(wrong.status, 422)
  assert.equal(
    ((await wrong.json()) as { error: Row }).error.messageKey,
    'website.customer.error.invalidCredentials',
  )
  const changed = await change('cu-123456', 'moi-123456')
  assert.equal(changed.status, 200)
  // The other device is signed out; this one stays in on a fresh session.
  assert.equal(await me(other), null)
  assert.equal((await me(visitor))!.displayName, 'Cúc Nguyễn')
  const fresh = String(((await changed.json()) as { data: Row }).data.csrfToken)
  assert.notEqual(fresh, csrfToken)
  assert.equal((await rename({ 'x-csrf-token': fresh })).status, 200)
})
