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
