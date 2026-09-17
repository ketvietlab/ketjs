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
  await expect(page).toHaveURL(/\/admin(?:\/|\?|$)/)
}

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => mkdir(artifacts, { recursive: true }))
test.beforeEach(async ({ page }) => login(page))

// General and Variants now live in the product.template record-modal; only Media
// still renders on the old page (see product_backend/modal/product-modal-view.tsx
// and routes.ts). The old page's own tab bar still links to `?tab=general` /
// `?tab=variants` on that same path — those requests redirect into the modal.
test('the old detail page redirects General and Variants into the record-modal', async ({ page }) => {
  await page.goto('/admin/product/templates/tpl-review?tab=general&lang=vi')
  await expect(page).toHaveURL(/lang=vi&record=product\.template%3Atpl-review&tab=general/)
  await expect(page.getByRole('dialog')).toBeVisible()

  await page.goto('/admin/product/templates/tpl-review?tab=variants&lang=vi')
  await expect(page).toHaveURL(/lang=vi&record=product\.template%3Atpl-review&tab=variants/)
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('opens the record-modal, edits General and saves', async ({ page }) => {
  await page.goto('/admin/product/templates?record=product.template:tpl-review&tab=general&lang=vi')
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('[data-ui="modal-title"]')).toHaveText('Áo khoác vận hành KETSUITE')
  await expect(dialog.getByLabel('Có thể bán')).toBeChecked()
  await expect(dialog.getByLabel('Có thể mua')).toBeChecked()
  await expect(dialog.getByLabel('Theo dõi tồn kho')).toBeChecked()
  // A template with variants keeps its own identity fields off General.
  await expect(dialog.locator('input[name="defaultCode"]')).toHaveCount(0)

  await dialog.getByLabel('Giá bán').fill('1349000')
  await dialog.getByLabel('Mô tả').fill('Mô tả được lưu từ record-modal.')
  await dialog.getByLabel('Xuất xứ').fill('Việt Nam · Cập nhật')
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click()

  await expect(dialog.getByLabel('Giá bán')).toHaveValue('1349000')
  await expect(dialog.getByLabel('Mô tả')).toHaveValue('Mô tả được lưu từ record-modal.')
  await expect(dialog.getByLabel('Xuất xứ')).toHaveValue('Việt Nam · Cập nhật')
  // The two flags stayed on: General's save must not silently reset them.
  await expect(dialog.getByLabel('Có thể bán')).toBeChecked()
  await expect(dialog.getByLabel('Có thể mua')).toBeChecked()
})

test('refuses an invalid stock/tracking combination without touching the name', async ({ page }) => {
  await page.goto('/admin/product/templates?record=product.template:tpl-review&tab=general&lang=vi')
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Theo dõi tồn kho').uncheck()
  await dialog.getByLabel('Truy xuất').selectOption('serial')
  await dialog.getByRole('button', { name: 'Lưu theo dõi tồn kho' }).click()
  await expect(dialog.locator('select[name="tracking"]')).toHaveAttribute('aria-invalid', 'true')
  await expect(dialog.locator('#product-template-tracking-error')).toContainText(
    'sản phẩm không lưu kho phải dùng tracking none',
  )

  await page.reload()
  await expect(dialog.getByLabel('Theo dõi tồn kho')).toBeChecked()
})

test('archives and restores from the record header', async ({ page }) => {
  await page.goto('/admin/product/templates?record=product.template:tpl-review&tab=general&lang=vi')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Đang hoạt động')).toBeVisible()
  await dialog.getByRole('button', { name: 'Lưu trữ' }).click()
  await expect(dialog.getByRole('button', { name: 'Khôi phục' })).toBeVisible()

  await dialog.getByRole('button', { name: 'Khôi phục' }).click()
  await expect(dialog.getByRole('button', { name: 'Lưu trữ' })).toBeVisible()
})

test('builds attributes and variants in one editor and saves them together', async ({ page }) => {
  await page.goto('/admin/product/templates?lang=vi')
  await page.getByRole('link', { name: 'Tạo sản phẩm' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('input[name="name"]').fill('Sản phẩm biến thể E2E')
  await dialog.getByRole('button', { name: 'Tạo mới' }).click()
  await expect(dialog.locator('[data-ui="modal-title"]')).toHaveText('Sản phẩm biến thể E2E')

  await dialog.locator('[data-ui="tab"]', { hasText: 'Thuộc tính & biến thể' }).click()
  const editor = dialog.locator('[data-ui="variant-editor"]')
  await expect(editor.getByText('Chưa có thuộc tính')).toBeVisible()
  await editor.getByLabel('Thêm thuộc tính…').selectOption('color')
  await editor.getByLabel('+ giá trị').selectOption('color-blue')
  await editor.getByLabel('+ giá trị').selectOption('color-orange')

  // A price extra on one value reprices only the variants that carry it.
  await editor.getByRole('button', { name: 'Cam cảnh báo' }).click()
  await editor.getByLabel('Giá cộng thêm').fill('50000')
  await editor.getByRole('button', { name: 'Xong' }).click()

  await editor.getByRole('button', { name: 'Tạo các tổ hợp còn thiếu' }).click()
  const rows = editor.locator('[data-ui="variant-editor-row"]')
  await expect(rows).toHaveCount(2)

  // Two rows on the same combination block Save until one of them changes.
  await editor.getByRole('button', { name: 'Thêm biến thể' }).click()
  await rows.nth(2).getByLabel('Màu sắc').selectOption('color-blue')
  await expect(rows.nth(2)).toContainText('Trùng với #1')
  const save = editor.getByRole('button', { name: 'Lưu thuộc tính & biến thể' })
  await expect(save).toBeDisabled()
  await rows.nth(2).getByRole('button', { name: 'Bỏ' }).click()

  await rows.first().getByRole('button', { name: 'Sửa' }).click()
  await rows.first().getByLabel('Mã nội bộ (SKU)').fill('BIENTHE-E2E-01')
  await save.click()
  await expect(editor.getByText('Đã lưu: tạo 2, lưu trữ 0.')).toBeVisible()

  await page.reload()
  const reloaded = page.getByRole('dialog').locator('[data-ui="variant-editor"]')
  await expect(reloaded.locator('[data-ui="variant-editor-row"]')).toHaveCount(2)
  await expect(reloaded.getByText('BIENTHE-E2E-01')).toBeVisible()
  await expect(reloaded.getByRole('button', { name: /Cam cảnh báo\s*\+50\.000/ })).toBeVisible()
})

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  for (const locale of ['vi', 'en'] as const) {
    test(`renders media in ${locale} correctly on ${viewport.name}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`/admin/product/templates/tpl-review?tab=media&lang=${locale}`)
      await expect(page.locator('[data-ui="app-main"]')).toBeVisible()
      await expect(page.locator('form[action="/login"]')).toHaveCount(0)
      await expect(page.locator('[data-ui="tab"][data-active="true"]')).toBeVisible()

      const galleryPanel = page.locator('[data-scope="product-media"] [data-product-media-panel="gallery"]')
      const variantPanel = page.locator('[data-scope="product-media"] [data-product-media-panel="variants"]')
      await expect(galleryPanel).toContainText(locale === 'vi' ? 'Hình ảnh sản phẩm' : 'Product images')
      await expect(variantPanel).toContainText(
        locale === 'vi' ? 'Hình ảnh theo biến thể' : 'Images by variant',
      )
      await expect(page.locator('[data-ui="media-item"]')).toHaveCount(2)
      await expect(page.locator('[data-product-media-table="variants"] [data-ui="row"]')).toHaveCount(25)
      const mediaPagination = page.locator('[data-product-media-pagination="true"]')
      await expect(mediaPagination).toContainText(
        locale === 'vi' ? '1 – 25 / 26 biến thể' : '1 – 25 / 26 variants',
      )
      await expect
        .poll(() =>
          page
            .locator('[data-scope="product-media"] img')
            .evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth > 0)),
        )
        .toBe(true)

      const metrics = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }))
      expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
      await page.screenshot({
        path: join(artifacts, `detail-media-${locale}-${viewport.name}.png`),
        fullPage: true,
      })
    })
  }
}

test('paginates every variant image row in pages of 25', async ({ page }) => {
  await page.goto('/admin/product/templates/tpl-review?tab=media&lang=vi')
  await expect(page.locator('[data-product-media-table="variants"] [data-ui="row"]')).toHaveCount(25)

  await page
    .locator('[data-product-media-pagination="true"]')
    .getByRole('link', { name: 'Trang sau' })
    .click()

  await expect(page).toHaveURL(/tab=media&variantPage=2&lang=vi/)
  await expect(page.locator('[data-product-media-table="variants"] [data-ui="row"]')).toHaveCount(1)
  await expect(page.locator('[data-product-media-pagination="true"]')).toContainText('26 – 26 / 26 biến thể')
  await expect(page.getByRole('link', { name: 'Trang trước' })).toHaveAttribute('href', /variantPage=1/)
})

test('sets a primary image and uploads/removes one', async ({ page }) => {
  await page.goto('/admin/product/templates/tpl-review?tab=media&lang=vi')
  await expect(page.locator('[data-ui="media-item"]')).toHaveCount(2)

  await page.getByRole('button', { name: 'Đặt làm ảnh chính' }).dispatchEvent('click')
  await expect(page.locator('[data-ui="media-item"][data-primary="true"] img')).toHaveAttribute(
    'alt',
    'Áo khoác vận hành màu cam',
  )

  await page.locator('[data-ui="media-file-input"]').setInputFiles(uploadFixture)
  await page.locator('[data-ui="media-upload"]').evaluate((form: HTMLFormElement) => form.requestSubmit())
  await expect(page.locator('[data-ui="media-item"]')).toHaveCount(3)
  await page.locator('[data-ui="media-item"] button[aria-label="Xóa ảnh"]').last().click()
  await expect(page.locator('[data-ui="media-item"]')).toHaveCount(2)
})
