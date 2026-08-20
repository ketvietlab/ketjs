import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const artifacts = join(moduleDir, 'artifacts', 'product-attributes')

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

test('validates and creates an attribute, then adds a value', async ({ page }) => {
  await page.goto('/admin/product-attributes?lang=vi')
  await expect(page.getByRole('heading', { name: 'Thuộc tính sản phẩm' })).toBeVisible()
  await expect(page.locator('[data-ui="content-card"]', { hasText: 'Màu sắc' })).toContainText(
    'Xanh nghiệp vụ',
  )

  const createForm = page.locator('#product-attribute-create')
  await createForm.getByRole('button', { name: 'Tạo mới' }).click()
  await expect(page).toHaveURL(/\/admin\/product-attributes\?lang=vi$/)
  expect(
    await createForm
      .locator('input[name="name"]')
      .evaluate((input) => (input as HTMLInputElement).checkValidity()),
  ).toBe(false)

  const validForm = page.locator('#product-attribute-create')
  await validForm.locator('input[name="name"]').fill('Chất liệu E2E')
  await validForm.locator('select[name="displayType"]').selectOption('pills')
  await validForm.getByRole('button', { name: 'Tạo mới' }).click()
  await expect(page.locator('[data-ui="content-card"]', { hasText: 'Chất liệu E2E' })).toBeVisible()

  await page
    .locator('[data-ui="content-card"]', { hasText: 'Chất liệu E2E' })
    .getByRole('button', { name: 'Thêm' })
    .click()
  await expect(page).toHaveURL(/\/admin\/product-attributes\?lang=vi$/)

  const card = page.locator('[data-ui="content-card"]', { hasText: 'Chất liệu E2E' })
  await card.locator('input[name="name"]').fill('Cotton kỹ thuật')
  await card.getByRole('button', { name: 'Thêm' }).click()
  await expect(page.locator('[data-ui="content-card"]', { hasText: 'Chất liệu E2E' })).toContainText(
    'Cotton kỹ thuật',
  )
})

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  for (const locale of ['vi', 'en'] as const) {
    test(`renders the ${locale} attribute screen correctly on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`/admin/product-attributes?lang=${locale}`)
      await expect(page.locator('[data-ui="main"]')).toBeVisible()
      await expect(page.locator('form[action="/login"]')).toHaveCount(0)

      const metrics = await page.evaluate(() => {
        const field = document.querySelector<HTMLElement>('#product-attribute-create [data-ui="form-field"]')
        const input = field?.querySelector<HTMLElement>('input')?.getBoundingClientRect()
        const label = field?.querySelector<HTMLElement>('[data-ui="form-label"]')?.getBoundingClientRect()
        const submit = document
          .querySelector<HTMLElement>('#product-attribute-create button[type="submit"]')
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
        path: join(artifacts, `attributes-${locale}-${viewport.name}.png`),
        fullPage: true,
      })
    })
  }
}
