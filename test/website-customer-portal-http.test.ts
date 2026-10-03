import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

const API = '/api/customer/v1'
const register = (
  client: { request: (path: string, init: RequestInit) => Promise<Response> },
  email: string,
) =>
  client.request(`${API}/auth/session/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'Minh Anh', email, password: 'mat-khau-123' }),
  })

test('customer portal: sign-up follows the site switch and history uses only owned customer routes', async (t) => {
  const { app, fixture } = await bootWebsiteStudio()
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'portal-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  await fixture('website.saveStudioStyle', {
    siteId: 'site-a',
    expectedRevisionId: 'initial',
    values: { account: 'shown' },
  })
  const home = (await fixture('website.getEntry', { id: 'page-site-a' })).entry as Row
  await fixture('website.publishEntry', { id: 'page-site-a', expectedRevisionId: home.revisionId })
  const visitor = app.client.anonymous()

  await fixture('website.setCustomerSelfSignup', { siteId: 'site-a', open: false })
  assert.equal((await visitor.get('/account/register')).status, 404)
  assert.doesNotMatch(await (await visitor.get('/account/login')).text(), /href="\/account\/register"/)
  const closed = await register(visitor, 'closed@example.test')
  assert.equal(closed.status, 422)
  assert.equal(
    ((await closed.json()) as { error: Row }).error.messageKey,
    'website.customer.error.signupClosed',
  )

  await fixture('website.setCustomerSelfSignup', { siteId: 'site-a', open: true })
  const page = await visitor.get('/account/register')
  assert.equal(page.status, 200)
  const markup = (await page.text()).replace(/<!--.*?-->/g, '')
  assert.match(markup, /<meta name="robots" content="noindex">/)
  assert.match(markup, /data-customer-view="register"/)
  assert.match(markup, /data-customer-form="register"/)
  assert.match(markup, /Tạo tài khoản bằng tên, email và mật khẩu của bạn\./)
  assert.match(markup, /Địa chỉ email/)
  assert.match(markup, /<button class="wt-button" type="submit">Tạo tài khoản<\/button>/)
  assert.match(markup, /name="email"[^>]*autocomplete="email"/)
  assert.match(await (await visitor.get('/account/login')).text(), /href="\/account\/register"/)

  const created = await register(visitor, 'minh@example.test')
  assert.equal(created.status, 201)
  assert.match(String(created.headers.get('set-cookie')), /HttpOnly/)
  const bootstrap = ((await (await visitor.get(`${API}/bootstrap`)).json()) as { data: Row }).data
  assert.equal((bootstrap.customer as Row).displayName, 'Minh Anh')
  const capabilities = bootstrap.capabilities as Array<{ key: string; actions: string[] }>
  for (const key of ['website_retail.orders', 'website_hospitality.bookings'])
    assert.ok(
      capabilities.some((entry) => entry.key === key && entry.actions.includes('read')),
      key,
    )

  const account = await visitor.get('/account')
  assert.equal(account.status, 200)
  const accountMarkup = await account.text()
  assert.match(accountMarkup, /data-customer-history="retail"/)
  assert.match(accountMarkup, /data-customer-history="hospitality"/)
  for (const path of ['retail/orders', 'hospitality/my-bookings']) {
    const history = await visitor.get(`${API}/${path}`)
    assert.equal(history.status, 200, path)
    assert.deepEqual(((await history.json()) as { data: unknown }).data, [])
  }

  const duplicate = await register(app.client.anonymous(), 'minh@example.test')
  assert.equal(duplicate.status, 422)
  assert.equal(
    ((await duplicate.json()) as { error: Row }).error.messageKey,
    'website.customer.error.emailInUse',
  )
  await fixture('website.setCustomerSelfSignup', { siteId: 'site-a', open: false })
  assert.equal((await visitor.get('/account/register')).status, 404)
})
