import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const artifacts = join(moduleDir, 'artifacts', 'transfer-detail')
const transferPath = '/admin/stock/transfers/transfer-review'

const login = async (page: Page) => {
  await page.goto('/login?lang=vi')
  await page.locator('input[name="login"]').fill('admin')
  await page.locator('input[name="password"]').fill('stock-demo')
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
    test(`renders transfer detail in ${locale} correctly on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`${transferPath}?lang=${locale}`)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('WH/OUT/REVIEW')
      await expect(page.locator('select[name="productId"]')).toHaveValue('stock-variant')
      await expect(page.locator('[data-ui="chatter-loading"], [data-ui="activity-loading"]')).toHaveCount(0)

      const metrics = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        visibleControls: [
          ...document.querySelectorAll<HTMLElement>(
            '[data-ui="record-body"] input:not([type="hidden"]), [data-ui="record-body"] select',
          ),
        ]
          .filter((control) => control.getBoundingClientRect().height > 0)
          .map((control) => control.getBoundingClientRect().height),
      }))
      expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
      // A field is 32px on a touch screen and 28px with a cursor: a fingertip
      // needs the target, a pointer does not.
      const fieldHeight = 34
      expect(metrics.visibleControls.every((height) => height === fieldHeight)).toBe(true)
      await page.screenshot({
        path: join(artifacts, `transfer-detail-${locale}-${viewport.name}.png`),
        fullPage: true,
      })
    })
  }
}

test('adds, reserves, processes, and validates transfer lines', async ({ page }) => {
  await page.goto(`${transferPath}?lang=vi`)
  const stateBadge = page.locator('[data-ui="record-badges"] [data-ui="badge"]')
  const addMove = page.locator('form:has(input[name="action"][value="add-move"])')
  await addMove.locator('input[name="name"]').fill('Áo khoác bổ sung')
  await addMove.locator('select[name="productId"]').selectOption('stock-variant')
  await addMove.locator('select[name="productUomId"]').selectOption('unit')
  await addMove.locator('input[name="productUomQty"]').fill('2')
  await addMove.getByRole('button', { name: 'Thêm dòng hàng' }).click()
  await expect(page.locator('[data-ui="row"]')).toHaveCount(2)

  await page.getByRole('button', { name: 'Xác nhận' }).click()
  await expect(stateBadge).toContainText('Đã xác nhận')
  await page.getByRole('button', { name: 'Giữ hàng' }).click()
  await expect(stateBadge).toContainText('Đã giữ hàng')

  const operation = page.locator('select[name="operationId"]')
  const values = await operation
    .locator('option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value).filter(Boolean))
  expect(values).toHaveLength(2)
  for (const [index, value] of values.entries()) {
    await operation.selectOption(value)
    await page.locator('input[name="quantity"]').fill(index === 0 ? '3' : '2')
    await page.getByRole('button', { name: 'Ghi nhận đã xử lý' }).click()
  }

  await page.getByRole('button', { name: 'Hoàn tất, không tạo đơn bù' }).click()
  await expect(stateBadge).toContainText('Hoàn tất')
  await expect(page.getByRole('button', { name: 'Xác nhận' })).toHaveCount(0)
})
