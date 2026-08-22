import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const artifacts = join(moduleDir, 'artifacts', 'product-detail')
const uploadFixture = join(moduleDir, 'fixtures', 'product-primary.png')

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

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  for (const locale of ['vi', 'en'] as const) {
    for (const tab of ['general', 'variants', 'media'] as const) {
      test(`renders ${tab} in ${locale} correctly on ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.goto(`/admin/product/templates/tpl-review?tab=${tab}&lang=${locale}`)
        await expect(page.locator('[data-ui="main"]')).toBeVisible()
        await expect(page.locator('form[action="/login"]')).toHaveCount(0)
        await expect(page.locator(`[data-ui="tab"][data-active="true"]`)).toBeVisible()
        await expect(page.locator('[data-ui="chatter-loading"], [data-ui="activity-loading"]')).toHaveCount(0)

        const metrics = await page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          // A relation field's native <select> is a 1px, opacity-0 value carrier
          // that only exists so the form submits and validates; the control the
          // reader actually sees and clicks is its trigger button.
          visibleControls: [
            ...document.querySelectorAll<HTMLElement>(
              '[data-ui="record-body"] input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]), [data-ui="record-body"] select:not([data-ui="relation-native"]), [data-ui="record-body"] [data-ui="relation-trigger"]',
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
        await page.screenshot({
          path: join(artifacts, `detail-${tab}-${locale}-${viewport.name}.png`),
          fullPage: true,
        })
      })
    }
  }
}

test('saves atomically and manages variants and template media', async ({ page }) => {
  await page.goto('/admin/product/templates/tpl-review?tab=general&lang=vi')
  await expect(page.getByRole('heading', { name: 'Áo khoác vận hành KETSUITE' })).toBeVisible()
  await expect(page.locator('[data-ui="chatter-error"]')).toHaveCount(0)

  await page.locator('input[name="name"]').fill('Tên không được lưu dở dang')
  await page.getByLabel('Theo dõi tồn kho').uncheck()
  await page.getByLabel('Truy xuất').selectOption('serial')
  await page.getByRole('button', { name: 'Lưu' }).click()
  await expect(page.locator('[data-ui="notice"][role="alert"]')).toContainText('Dữ liệu chưa hợp lệ')
  await page.reload()
  await expect(page.locator('input[name="name"]')).toHaveValue('Áo khoác vận hành KETSUITE')

  await page.getByLabel('Giá bán').fill('1399000')
  await page.getByLabel('Theo dõi tồn kho').check()
  await page.getByLabel('Truy xuất').selectOption('lot')
  await page.getByRole('button', { name: 'Lưu' }).click()
  await expect(page.getByLabel('Giá bán')).toHaveValue('1399000')

  await page.goto('/admin/product/templates/tpl-review?tab=variants&lang=vi')
  const attributeForm = page.locator('form[data-ui="record-form"]:has(select[name="attributeId"])')
  await attributeForm.locator('select[name="attributeId"]').selectOption('color')
  await attributeForm.locator('input[name="valueIds"]').fill('color-blue,color-orange')
  await attributeForm.getByRole('button', { name: 'Thêm' }).click()
  await page.getByRole('button', { name: 'Sinh biến thể' }).click()
  await expect(page.locator('[data-ui="row"]')).not.toHaveCount(0)
  await expect(page.getByRole('link', { name: /JACKET-REVIEW/ })).toBeVisible()

  await page.goto('/admin/product/templates/tpl-review?tab=media&lang=vi')
  await expect(page.locator('[data-ui="media-item"]')).toHaveCount(2)
  await expect
    .poll(() =>
      page
        .locator('[data-ui="media-item"] img')
        .evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth > 0)),
    )
    .toBe(true)
  await page.getByRole('button', { name: 'Đặt làm ảnh chính' }).click()
  await expect(page.locator('[data-ui="media-item"][data-primary="true"] img')).toHaveAttribute(
    'alt',
    'Áo khoác vận hành màu cam',
  )
  await page.locator('[data-ui="media-file-input"]').setInputFiles(uploadFixture)
  await page.getByRole('button', { name: 'Thêm ảnh' }).click()
  await expect(page.locator('[data-ui="media-item"]')).toHaveCount(3)
  await page.getByRole('button', { name: 'Xóa ảnh' }).last().click()
  await expect(page.locator('[data-ui="media-item"]')).toHaveCount(2)
})
