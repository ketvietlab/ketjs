import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const artifacts = join(moduleDir, 'artifacts', 'product-variant-detail')
const uploadFixture = join(moduleDir, 'fixtures', 'product-primary.png')
const variantPath = '/admin/product/templates/tpl-review/variants/variant-review'

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

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  for (const locale of ['vi', 'en'] as const) {
    for (const tab of ['general', 'media'] as const) {
      test(`renders variant ${tab} in ${locale} correctly on ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.goto(`${variantPath}?tab=${tab}&lang=${locale}`)
        await expect(page.locator('[data-ui="main"]')).toBeVisible()
        await expect(page.locator('form[action="/login"]')).toHaveCount(0)
        await expect(page.locator('[data-ui="tab"][data-active="true"]')).toBeVisible()
        await expect(page.locator('[data-ui="chatter-loading"], [data-ui="activity-loading"]')).toHaveCount(0)

        const metrics = await page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          // A relation field's native <select> is a 1px, opacity-0 value carrier
          // that only exists so the form submits and validates; the control the
          // reader actually sees and clicks is its trigger button.
          visibleControls: [
            ...document.querySelectorAll<HTMLElement>(
              '[data-ui="record-body"] input:not([type="hidden"]):not([type="file"]), [data-ui="record-body"] select:not([data-ui="relation-native"]), [data-ui="record-body"] [data-ui="relation-trigger"]',
            ),
          ]
            .filter((control) => control.getBoundingClientRect().height > 0)
            .map((control) => control.getBoundingClientRect().height),
        }))
        expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
        // A field is 32px on a touch screen and 28px with a cursor: a fingertip
        // needs the target, a pointer does not.
        const fieldHeight = viewport.name === 'desktop' ? 28 : 32
        expect(metrics.visibleControls.every((height) => height === fieldHeight)).toBe(true)
        if (tab === 'media') {
          await expect(page.locator('[data-ui="media-item"]')).toHaveCount(2)
          await expect
            .poll(() =>
              page
                .locator('[data-ui="media-item"] img')
                .evaluateAll((images) =>
                  images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
                ),
            )
            .toBe(true)
        }
        await page.screenshot({
          path: join(artifacts, `variant-${tab}-${locale}-${viewport.name}.png`),
          fullPage: true,
        })
      })
    }
  }
}

test('updates variant fields and manages variant media', async ({ page }) => {
  await page.goto(`${variantPath}?tab=general&lang=vi`)
  await expect(page.locator('[data-ket-slot="product.record-header"] [data-ui="record-heading"]')).toHaveText(
    'JACKET-REVIEW',
  )
  await expect(page.locator('[data-ui="chatter-error"]')).toHaveCount(0)

  await page.locator('input[name="defaultCode"]').fill('JACKET-REVIEW-UPDATED')
  await page.locator('input[name="barcode"]').fill('8938500000099')
  await page.locator('input[name="weight"]').fill('0.72')
  await page.locator('input[name="volume"]').fill('0.005')
  await page.locator('input[name="standardPrice"]').fill('850000')
  await page.locator('input[name="uomBarcode"]').fill('8938500000099-UOM')
  await page.getByRole('button', { name: 'Lưu' }).click()
  await expect(page.locator('input[name="defaultCode"]')).toHaveValue('JACKET-REVIEW-UPDATED')
  await page.reload()
  await expect(page.locator('input[name="barcode"]')).toHaveValue('8938500000099')
  await expect(page.locator('input[name="standardPrice"]')).toHaveValue('850000')
  await expect(page.locator('input[name="uomBarcode"]')).toHaveValue('8938500000099-UOM')

  await page.goto(`${variantPath}?tab=media&lang=vi`)
  await expect(page.locator('[data-ui="media-item"]')).toHaveCount(2)
  await page.getByRole('button', { name: 'Đặt làm ảnh chính' }).click()
  await expect(page.locator('[data-ui="media-item"][data-primary="true"] img')).toHaveAttribute(
    'alt',
    'Biến thể áo khoác màu cam',
  )
  await page.locator('[data-ui="media-file-input"]').setInputFiles(uploadFixture)
  await page.locator('[data-ui="media-upload"]').evaluate((form: HTMLFormElement) => form.requestSubmit())
  await expect(page.locator('[data-ui="media-item"]')).toHaveCount(3)
  await page.getByRole('button', { name: 'Xóa ảnh' }).last().click()
  await expect(page.locator('[data-ui="media-item"]')).toHaveCount(2)
})
