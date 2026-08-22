import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const artifacts = join(moduleDir, 'artifacts', 'forecast')

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
    test(`renders forecast in ${locale} correctly on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`/admin/stock/forecast?lang=${locale}`)
      await expect(page.locator('[data-ui="main"]')).toBeVisible()
      await expect(page.locator('form[action="/login"]')).toHaveCount(0)
      await expect(page.locator('select[name="productId"]')).toContainText('STOCK-JACKET')

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
      const fieldHeight = viewport.name === 'desktop' ? 28 : 32
      expect(metrics.visibleControls.every((height) => height === fieldHeight)).toBe(true)
      await page.screenshot({
        path: join(artifacts, `forecast-${locale}-${viewport.name}.png`),
        fullPage: true,
      })
    })
  }
}

test('calculates forecast for a selected product and warehouse', async ({ page }) => {
  await page.goto('/admin/stock/forecast?lang=vi')
  await page.locator('select[name="productId"]').selectOption('stock-variant')
  await page.locator('select[name="warehouseId"]').selectOption('wh')
  await page.getByRole('button', { name: 'Tính dự báo' }).click()

  await expect(page).toHaveURL(/productId=stock-variant/)
  await expect(page).toHaveURL(/warehouseId=wh/)
  await expect(page.locator('[data-ui="metric"]')).toHaveCount(4)
  await expect(page.locator('[data-ui="metric"]')).toContainText([
    'Tồn thực tế12',
    'Sắp nhận0',
    'Sắp xuất0',
    'Dự báo12',
  ])
})
