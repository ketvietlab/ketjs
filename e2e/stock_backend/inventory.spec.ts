import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const artifacts = join(moduleDir, 'artifacts', 'inventory')

const login = async (page: Page) => {
  await page.goto('/login?lang=vi')
  await page.locator('input[name="login"]').fill('admin')
  await page.locator('input[name="password"]').fill('stock-demo')
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
    test(`renders inventory in ${locale} correctly on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`/admin/stock/inventory?lang=${locale}`)
      await expect(page.locator('[data-ui="main"]')).toBeVisible()
      await expect(page.locator('form[action="/login"]')).toHaveCount(0)
      await expect(page.locator('#inventory-adjustment-form')).toBeVisible()
      await expect(page.locator('[data-ui="row"]')).toHaveCount(1)

      const metrics = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        visibleControls: [
          ...document.querySelectorAll<HTMLElement>(
            '#inventory-adjustment-form input:not([type="hidden"]), #inventory-adjustment-form select',
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
        path: join(artifacts, `inventory-${locale}-${viewport.name}.png`),
        fullPage: true,
      })
    })
  }
}

test('applies an inventory count and refreshes the balance', async ({ page }) => {
  await page.goto('/admin/stock/inventory?lang=vi')
  await page.locator('select[name="productId"]').selectOption('stock-variant')
  await page.locator('select[name="locationId"]').selectOption('wh:stock')
  await page.locator('input[name="countedQuantity"]').fill('15')
  await page.locator('select[name="productUomId"]').selectOption('unit')
  await page.locator('select[name="inventoryLocationId"]').selectOption('inventory')
  await page.getByRole('button', { name: 'Áp dụng' }).click()

  await expect(page).toHaveURL(/\/admin\/stock\/inventory\?applied=1&lang=vi$/)
  await expect(page.locator('[data-ui="notice"]')).toContainText('Đã áp dụng kiểm kê')
  await expect(page.locator('[data-ui="row"]')).toContainText('15')
  await expect(page.locator('[data-ui="record-facts"] [data-ui="record-fact"]').first()).toContainText('15')
})
