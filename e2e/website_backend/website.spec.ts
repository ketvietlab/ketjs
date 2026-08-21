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
  await expect(page).toHaveURL(/\/admin(?:\?|$)/)
}

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => mkdir(artifacts, { recursive: true }))
test.beforeEach(async ({ page }) => login(page))

test('creates, revises and publishes content through the backend', async ({ page }) => {
  await expect(page.getByRole('link', { name: 'Website', exact: true }).first()).toBeVisible()
  await page.goto('/admin/content/new?site=hospitality-site&lang=vi')
  await expect(page.getByRole('heading', { name: 'Nội dung mới', level: 1 })).toBeVisible()
  await page.locator('input[name="title"]').fill('Câu chuyện của Mây')
  await page.locator('input[name="slug"]').fill('cau-chuyen')
  await page.locator('input[name="path"]').fill('/cau-chuyen')
  await page.locator('select[name="type"]').selectOption('website.page')
  await page.locator('textarea[name="fields"]').fill('{}')
  await page
    .locator('textarea[name="layout"]')
    .fill(
      JSON.stringify([
        { type: 'website.rich_text', settings: { heading: 'Mây', body: 'Một câu chuyện mới.' } },
      ]),
    )
  await page.getByRole('button', { name: 'Lưu bản nháp' }).click()
  await expect(page).toHaveURL(/\/admin\/content\/[^/?]+\?lang=vi/)
  await expect(page.getByText('Bản nháp', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Xuất bản ngay' }).click()
  await expect(page.getByText('Đã xuất bản', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Revision' }).click()
  await expect(page.getByRole('heading', { name: 'Lịch sử phiên bản' })).toBeVisible()
  await expect(page.locator('[data-ui="row"]')).toHaveCount(1)
})

test('creates a schema-backed form and keeps the English backend translated', async ({ page }) => {
  await page.goto('/admin/forms/new?site=hospitality-site&lang=vi')
  await page.locator('input[name="name"]').fill('Đăng ký nhận tin')
  await page.locator('input[name="successMessage"]').fill('Đăng ký thành công')
  await page
    .locator('textarea[name="schema"]')
    .fill(JSON.stringify({ fields: [{ name: 'email', type: 'email', required: true }] }))
  await page.getByRole('button', { name: 'Lưu' }).click()
  await expect(page).toHaveURL(/\/admin\/forms\?site=hospitality-site&lang=vi/)
  await expect(page.getByText('Đăng ký nhận tin')).toBeVisible()

  await page.goto('/admin/sites?lang=en')
  await expect(page.getByRole('heading', { name: 'Sites' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Create site' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('website_backend.')
})

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

test('customer authentication is a separate, headless-ready browser session', async ({ page }) => {
  const origin = 'http://127.0.0.1:4173'
  const email = 'customer.e2e@example.test'
  const registered = await page.request.post('/api/website/v1/customer/auth/register', {
    headers: { Origin: origin },
    data: {
      displayName: 'Lan Anh',
      email,
      password: 'customer-password-old',
    },
  })
  expect(registered.status()).toBe(201)
  const registration = (await registered.json()) as {
    customer: { displayName: string; email: string }
    csrfToken: string
  }
  expect(registration.customer).toEqual({
    id: expect.any(String),
    displayName: 'Lan Anh',
    email,
  })
  expect(registration.csrfToken).toHaveLength(64)

  const session = await page.request.get('/api/website/v1/customer/session')
  expect(session.status()).toBe(200)
  expect((await session.json()).authenticated).toBe(true)

  const noCsrf = await page.request.patch('/api/website/v1/customer/profile', {
    headers: { Origin: origin },
    data: { displayName: 'Lan Anh Updated' },
  })
  expect(noCsrf.status()).toBe(403)
  const profile = await page.request.patch('/api/website/v1/customer/profile', {
    headers: { Origin: origin, 'X-CSRF-Token': registration.csrfToken },
    data: { displayName: 'Lan Anh Updated' },
  })
  expect(profile.status()).toBe(200)
  expect((await profile.json()).customer.displayName).toBe('Lan Anh Updated')

  const crossOrigin = await page.request.post('/api/website/v1/customer/auth/logout', {
    headers: { Origin: 'https://evil.example', 'X-CSRF-Token': registration.csrfToken },
  })
  expect(crossOrigin.status()).toBe(403)
  const changed = await page.request.post('/api/website/v1/customer/password/change', {
    headers: { Origin: origin, 'X-CSRF-Token': registration.csrfToken },
    data: {
      currentPassword: 'customer-password-old',
      newPassword: 'customer-password-new',
    },
  })
  expect(changed.status()).toBe(200)
  const rotated = (await changed.json()) as { csrfToken: string }
  expect(rotated.csrfToken).not.toBe(registration.csrfToken)

  const loggedOut = await page.request.post('/api/website/v1/customer/auth/logout', {
    headers: { Origin: origin, 'X-CSRF-Token': rotated.csrfToken },
  })
  expect(loggedOut.status()).toBe(204)
  expect((await (await page.request.get('/api/website/v1/customer/session')).json()).authenticated).toBe(
    false,
  )
  const oldPassword = await page.request.post('/api/website/v1/customer/auth/login', {
    headers: { Origin: origin },
    data: { email, password: 'customer-password-old' },
  })
  expect(oldPassword.status()).toBe(401)
  const newPassword = await page.request.post('/api/website/v1/customer/auth/login', {
    headers: { Origin: origin },
    data: { email, password: 'customer-password-new' },
  })
  expect(newPassword.status()).toBe(200)

  // The customer cookie coexists with, but never replaces, the backend admin session.
  await page.goto('/admin/sites?lang=en')
  await expect(page.getByRole('heading', { name: 'Sites' })).toBeVisible()
})

test('captures every website backend screen and the KTL storefront', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const screens = [
    ['sites', '/admin/sites?lang=vi'],
    ['site-new', '/admin/sites/new?lang=vi'],
    ['site-edit', '/admin/sites/hospitality-site?lang=vi'],
    ['content', '/admin/content?site=hospitality-site&lang=vi'],
    ['content-new', '/admin/content/new?site=hospitality-site&lang=vi'],
    ['content-edit', '/admin/content/home-hospitality?lang=vi'],
    ['revisions', '/admin/content/home-hospitality/revisions?lang=vi'],
    ['preview', '/admin/content/home-hospitality/preview?lang=vi'],
    ['taxonomies', '/admin/taxonomies?site=hospitality-site&lang=vi'],
    ['media', '/admin/media?site=hospitality-site&lang=vi'],
    ['menus', '/admin/menus?site=hospitality-site&lang=vi'],
    ['forms', '/admin/forms?site=hospitality-site&lang=vi'],
    ['form-new', '/admin/forms/new?site=hospitality-site&lang=vi'],
    ['submissions', '/admin/forms/contact-form/submissions?lang=vi'],
  ] as const

  for (const [name, path] of screens) {
    await page.goto(path)
    await expect(page.locator('[data-ui="main"]')).toBeVisible()
    await expect(page.locator('form[action="/login"]')).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('website_backend.')
    const width = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }))
    expect(width.document).toBeLessThanOrEqual(width.viewport)
    await page.screenshot({ path: join(artifacts, `${name}-desktop.png`), fullPage: true })
  }

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Một khoảng nghỉ thật sự' })).toBeVisible()
  await expect(page.locator('body')).toHaveClass(/hospitality-site/)
  await page.screenshot({ path: join(artifacts, 'storefront-hospitality-desktop.png'), fullPage: true })

  await page.goto('http://localhost:4173/')
  await expect(page.getByRole('heading', { name: 'Useful things. Better made.' })).toBeVisible()
  await expect(page.locator('body')).toHaveClass(/retail-site/)
  await page.screenshot({ path: join(artifacts, 'storefront-retail-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/admin/content?site=hospitality-site&lang=vi')
  const mobileWidth = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }))
  expect(mobileWidth.document).toBeLessThanOrEqual(mobileWidth.viewport)
  await page.screenshot({ path: join(artifacts, 'content-mobile.png'), fullPage: true })
})
