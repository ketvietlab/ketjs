import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const artifacts = join(moduleDir, 'artifacts')

const login = async (page: Page, lang: 'vi' | 'en' = 'vi') => {
  await page.goto(`/login?lang=${lang}`)
  await page.locator('input[name="login"]').fill('admin')
  await page.locator('input[name="password"]').fill('website-demo')
  await page.locator('button[type="submit"]').click()
  // Landing on /admin means landing wherever /admin sends you: it 303s to the
  // first screen the deployment contributes, so the suite cannot assert which
  // one without breaking every time a module is added. Every other e2e login
  // helper in this repository already matches a subpath; this one did not, and
  // went red when hospitality began sorting first.
  await expect(page).toHaveURL(/\/admin(?:\/|\?|$)/)
}

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => mkdir(artifacts, { recursive: true }))
test.beforeEach(async ({ page }) => login(page))

test('hardens the public form boundary and unknown hosts', async ({ page }) => {
  const submit = () =>
    page.request.post('/website/forms/contact-form/submit', {
      headers: {
        Origin: 'http://127.0.0.1:4173',
        'Idempotency-Key': 'website-e2e-contact-1',
      },
      data: {
        payload: { name: 'Lan Anh', email: 'lan.anh@example.test' },
        consent: true,
        source: '/',
      },
    })
  const first = await submit()
  expect(first.status()).toBe(200)
  const firstBody = (await first.json()) as { ok: boolean; id: string }
  expect(firstBody.ok).toBe(true)
  const replay = await submit()
  expect(replay.status()).toBe(200)
  expect((await replay.json()).id).toBe(firstBody.id)

  const crossOrigin = await page.request.post('/website/forms/contact-form/submit', {
    headers: { Origin: 'https://evil.example' },
    data: { payload: { name: 'Bot', email: 'bot@example.test' } },
  })
  expect(crossOrigin.status()).toBe(403)

  const checkIn = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)
  const checkOut = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10)
  const booking = await page.request.post('/website/hospitality/hospitality-site/booking', {
    headers: {
      Origin: 'http://127.0.0.1:4173',
      'Idempotency-Key': 'website-e2e-booking-1',
    },
    data: {
      guestName: 'Lan Anh',
      email: 'lan.anh@example.test',
      checkIn,
      checkOut,
      adults: 2,
    },
  })
  expect(booking.status()).toBe(200)
  expect((await booking.json()).ok).toBe(true)

  const unknownHost = await page.request.get('/', { headers: { Host: 'unknown.example.test' } })
  expect(unknownHost.status()).toBe(404)
})

test('customer Channel API supports isolated browser and bearer sessions', async ({ page }) => {
  const origin = 'http://127.0.0.1:4173'
  const email = 'customer.e2e@example.test'
  const unsupportedBody = await page.request.post('/api/customer/v1/auth/token', {
    headers: { 'Content-Type': 'text/plain' },
    data: 'not-json',
  })
  expect(unsupportedBody.status()).toBe(415)
  expect((await unsupportedBody.json()).error.code).toBe('channel_api.unsupportedMediaType')
  const registered = await page.request.post('/api/customer/v1/auth/session/register', {
    headers: { Origin: origin },
    data: {
      displayName: 'Lan Anh',
      email,
      password: 'customer-password-old',
    },
  })
  expect(registered.status()).toBe(201)
  const registration = (await registered.json()) as {
    data: { customer: { displayName: string; email: string }; csrfToken: string }
    error: null
    meta: { requestId: string }
  }
  expect(registration.data.customer).toEqual({
    id: expect.any(String),
    displayName: 'Lan Anh',
    email,
  })
  expect(registration.data.csrfToken).toHaveLength(64)
  expect(registration.meta.requestId).toMatch(/^req_/)

  const session = await page.request.get('/api/customer/v1/me')
  expect(session.status()).toBe(200)
  expect((await session.json()).data.customer.email).toBe(email)

  const crossOrigin = await page.request.post('/api/customer/v1/auth/logout', {
    headers: { Origin: 'https://evil.example', 'X-CSRF-Token': registration.data.csrfToken },
  })
  expect(crossOrigin.status()).toBe(403)
  const loggedOut = await page.request.post('/api/customer/v1/auth/logout', {
    headers: { Origin: origin, 'X-CSRF-Token': registration.data.csrfToken },
  })
  expect(loggedOut.status()).toBe(200)
  expect((await page.request.get('/api/customer/v1/me')).status()).toBe(401)

  const browserLogin = await page.request.post('/api/customer/v1/auth/session/login', {
    headers: { Origin: origin },
    data: { email, password: 'customer-password-old' },
  })
  expect(browserLogin.status()).toBe(200)

  // The cookie rides along on any mutation the browser is talked into making, so
  // the facade asks every one of them for the token only this origin can read.
  const forgedBooking = await page.request.post('/api/customer/v1/hospitality/bookings', {
    headers: { Origin: origin, 'Idempotency-Key': 'customer-e2e-forged-1' },
    data: { propertyId: 'anything' },
  })
  expect(forgedBooking.status()).toBe(403)
  expect((await forgedBooking.json()).error.code).toBe('channel_api.csrf')

  const offContract = await page.request.post('/api/customer/v1/auth/session/register', {
    headers: { Origin: origin },
    data: { displayName: 'Ai Đó', email: 'other.e2e@example.test', superuser: true },
  })
  expect(offContract.status()).toBe(422)
  const contractError = (await offContract.json()).error as {
    code: string
    fieldErrors: Record<string, { messageKey: string }>
  }
  expect(contractError.code).toBe('channel_api.invalidRequest')
  expect(contractError.fieldErrors.password.messageKey).toBe('channel_api.error.fieldRequired')
  expect(contractError.fieldErrors.superuser.messageKey).toBe('channel_api.error.fieldUnknown')

  const tokenLogin = await page.request.post('/api/customer/v1/auth/token', {
    headers: { 'X-Channel-Realm': 'site:default:hospitality-site' },
    data: { email, password: 'customer-password-old' },
  })
  expect(tokenLogin.status()).toBe(200)
  const token = (await tokenLogin.json()).data as { accessToken: string; refreshToken: string }
  const bearerMe = await page.request.get('/api/customer/v1/me', {
    headers: { Authorization: `Bearer ${token.accessToken}` },
  })
  expect(bearerMe.status()).toBe(200)
  expect((await bearerMe.json()).data.customer.email).toBe(email)
  const genericTransport = await page.request.post('/_ket/fn/website.resolveSite', {
    headers: { Authorization: `Bearer ${token.accessToken}` },
    data: { host: '127.0.0.1' },
  })
  // 403, not 400: statusForError maps E_FN_NOT_PERMITTED deliberately, because a
  // client and a monitor both need to tell a missing grant from a malformed body.
  // The property under test is unchanged — a customer bearer token cannot reach
  // the generic function transport.
  expect(genericTransport.status()).toBe(403)
  expect((await genericTransport.json()).code).toBe('E_FN_NOT_PERMITTED')

  const refreshed = await page.request.post('/api/customer/v1/auth/token/refresh', {
    headers: { 'Idempotency-Key': 'customer-e2e-refresh-1' },
    data: { refreshToken: token.refreshToken },
  })
  expect(refreshed.status()).toBe(200)
  const refreshData = (await refreshed.json()).data as { accessToken: string; refreshToken: string }
  expect(refreshData.accessToken).not.toBe(token.accessToken)
  const replayed = await page.request.post('/api/customer/v1/auth/token/refresh', {
    headers: { 'Idempotency-Key': 'customer-e2e-refresh-1' },
    data: { refreshToken: token.refreshToken },
  })
  expect(replayed.status()).toBe(200)
  expect((await replayed.json()).data).toEqual(refreshData)

  const bootstrap = await page.request.get('/api/customer/v1/bootstrap')
  expect(bootstrap.status()).toBe(200)
  expect((await bootstrap.json()).data.capabilityRevision).toHaveLength(64)
  const properties = await page.request.get('/api/customer/v1/hospitality/properties')
  expect(properties.status()).toBe(200)
  expect((await properties.json()).data).toEqual([])

  // The customer cookie coexists with, but never replaces, the backend admin session.
  await page.goto('/website?lang=en')
  await expect(page.locator('#website-studio')).toBeAttached()
  await expect(page.locator('form[action="/login"]')).toHaveCount(0)
})

test('captures the KTL storefronts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Một khoảng nghỉ thật sự' })).toBeVisible()
  await expect(page.locator('body')).toHaveClass(/hospitality-site/)
  await page.screenshot({ path: join(artifacts, 'storefront-hospitality-desktop.png'), fullPage: true })

  await page.goto('http://localhost:4173/')
  await expect(page.getByRole('heading', { name: 'Useful things. Better made.' })).toBeVisible()
  await expect(page.locator('body')).toHaveClass(/retail-site/)
  await page.screenshot({ path: join(artifacts, 'storefront-retail-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const mobileWidth = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }))
  expect(mobileWidth.document).toBeLessThanOrEqual(mobileWidth.viewport)
  await page.screenshot({ path: join(artifacts, 'storefront-hospitality-mobile.png'), fullPage: true })
})
