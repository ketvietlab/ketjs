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
  await expect(page).toHaveURL(/\/admin(?:\/|\?|$)/)
}

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => mkdir(artifacts, { recursive: true }))
test.beforeEach(async ({ page }) => login(page))

// Creation now opens the product.template record-modal (record=product.template:new)
// instead of a full page; the modal's `create` command carries only the compact
// fields (type, name, uom, category, price, description) — stock tracking and tax
// are separate commands on the General tab of the record it creates.
test('creates a product from the record-modal and opens it on General', async ({ page }) => {
  await page.goto('/admin/product/templates?lang=vi')
  await page.getByRole('link', { name: 'Tạo sản phẩm' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('[data-ui="modal-title"]')).toHaveText('Tạo sản phẩm')
  await expect(dialog.locator('input[name="name"]')).toHaveAttribute('required', 'true')
  await expect(dialog.locator('input[name="type"]')).toHaveCount(2)
  await expect(dialog.locator('select[name="type"]')).toHaveCount(0)

  await dialog.locator('input[name="name"]').fill('Sản phẩm hợp lệ E2E')
  await dialog.locator('input[name="listPrice"]').fill('245000')
  await dialog.getByRole('button', { name: 'Tạo mới' }).click()

  await expect(page).toHaveURL(/record=product\.template%3A(?!new)[^&]+&tab=general/)
  await expect(dialog.locator('[data-ui="modal-title"]')).toHaveText('Sản phẩm hợp lệ E2E')
  await expect(dialog.locator('input[name="name"]')).toHaveValue('Sản phẩm hợp lệ E2E')
  await expect(dialog.locator('input[name="listPrice"]')).toHaveValue('245000')
  // Stock tracking is not part of creation: it only appears once the record exists.
  await expect(dialog.locator('input[name="isStorable"]')).toBeVisible()
})

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  for (const locale of ['vi', 'en'] as const) {
    test(`renders the ${locale} create form correctly on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`/admin/product/templates?lang=${locale}`)
      await page
        .getByRole('link', { name: locale === 'vi' ? 'Tạo sản phẩm' : 'Create product' })
        .click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(page.locator('form[action="/login"]')).toHaveCount(0)

      const metrics = await page.evaluate(() => {
        const input = document.querySelector<HTMLElement>('input[name="name"]')?.getBoundingClientRect()
        const label = document
          .querySelector<HTMLElement>('input[name="name"]')
          ?.closest('[data-ui="field"]')
          ?.querySelector<HTMLElement>('[data-ui="field-label"]')
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
      // A field is 32px on a touch screen and 28px with a cursor: a fingertip
      // needs the target, a pointer does not.
      expect(metrics.input?.height).toBe(34)
      expect(metrics.submitHeight).toBe(34)
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
