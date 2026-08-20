import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const artifacts = join(moduleDir, 'artifacts', 'product-create')

const login = async (page: Page) => {
  await page.goto('/login?lang=vi')
  await page.locator('input[name="login"]').fill('admin')
  await page.locator('input[name="password"]').fill('product-demo')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/admin(?:\?|$)/)
}

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => mkdir(artifacts, { recursive: true }))
test.beforeEach(async ({ page }) => login(page))

test('rejects invalid stock settings before creating a product', async ({ page }) => {
  const invalidName = 'Sản phẩm không hợp lệ E2E'
  await page.goto('/admin/products/new?lang=vi')
  await expect(page.getByRole('heading', { name: 'Tạo sản phẩm' }).first()).toBeVisible()

  await page.locator('input[name="name"]').fill(invalidName)
  await page.getByLabel('Theo dõi tồn kho').uncheck()
  await page.getByLabel('Truy xuất').selectOption('lot')
  await page.getByRole('button', { name: 'Tạo mới' }).click()

  await expect(page).toHaveURL(/\/admin\/products\/new\?[^#]*invalid=1/)
  await expect(page.getByRole('alert')).toContainText('Dữ liệu chưa hợp lệ')
  await page.goto(`/admin/products?lang=vi&q=${encodeURIComponent(invalidName)}`)
  await expect(page.locator('[data-ui="row"]')).toHaveCount(0)
})

test('creates a valid product and opens its detail screen', async ({ page }) => {
  await page.goto('/admin/products/new?lang=vi')
  await page.locator('input[name="name"]').fill('Sản phẩm hợp lệ E2E')
  await page.getByLabel('Giá bán').fill('245000')
  await page.getByLabel('Truy xuất').selectOption('none')
  await page.getByRole('button', { name: 'Tạo mới' }).click()

  await expect(page).toHaveURL(/\/admin\/products\/[^/?]+\?(?:[^#]*&)?lang=vi(?:&|$)/)
  await expect(page.locator('input[name="name"]')).toHaveValue('Sản phẩm hợp lệ E2E')
  await expect(page.getByLabel('Giá bán')).toHaveValue('245000')
})

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  for (const locale of ['vi', 'en'] as const) {
    test(`renders the ${locale} form correctly on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`/admin/products/new?lang=${locale}`)
      await expect(page.locator('[data-ui="main"]')).toBeVisible()
      await expect(page.locator('form[action="/login"]')).toHaveCount(0)

      const metrics = await page.evaluate(() => {
        const input = document.querySelector<HTMLElement>('input[name="name"]')?.getBoundingClientRect()
        const label = document
          .querySelector<HTMLElement>('input[name="name"]')
          ?.closest('[data-ui="form-field"]')
          ?.querySelector<HTMLElement>('[data-ui="form-label"]')
          ?.getBoundingClientRect()
        const submit = document
          .querySelector<HTMLElement>('[data-ui="record-form"] button[type="submit"]')
          ?.getBoundingClientRect()
        return {
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          input: input ? { y: input.y, height: input.height } : null,
          label: label ? { y: label.y, height: label.height } : null,
          submitHeight: submit?.height ?? null,
        }
      })

      expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
      expect(metrics.input?.height).toBe(28)
      expect(metrics.submitHeight).toBe(viewport.name === 'desktop' ? 28 : 44)
      if (viewport.name === 'desktop') {
        const inputCenter = metrics.input!.y + metrics.input!.height / 2
        const labelCenter = metrics.label!.y + metrics.label!.height / 2
        expect(Math.abs(inputCenter - labelCenter)).toBeLessThanOrEqual(1)
      }
      await page.screenshot({
        path: join(artifacts, `create-${locale}-${viewport.name}.png`),
        fullPage: true,
      })
    })
  }
}
