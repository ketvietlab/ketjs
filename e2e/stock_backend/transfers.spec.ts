import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const artifacts = join(moduleDir, 'artifacts', 'transfers')

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
    test(`renders transfers in ${locale} correctly on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`/admin/transfers?lang=${locale}`)
      await expect(page.locator('[data-ui="main"]')).toBeVisible()
      await expect(page.locator('form[action="/login"]')).toHaveCount(0)
      await expect(page.locator('#transfer-create-form')).toBeVisible()
      await expect(page.getByRole('link', { name: 'WH/OUT/REVIEW' })).toBeVisible()

      const metrics = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        visibleControls: [
          ...document.querySelectorAll<HTMLElement>(
            '#transfer-create-form input:not([type="hidden"]), #transfer-create-form select',
          ),
        ]
          .filter((control) => control.getBoundingClientRect().height > 0)
          .map((control) => control.getBoundingClientRect().height),
      }))
      expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
      expect(metrics.visibleControls.every((height) => height === 28)).toBe(true)
      await page.screenshot({
        path: join(artifacts, `transfers-${locale}-${viewport.name}.png`),
        fullPage: true,
      })
    })
  }
}

test('creates a transfer and opens it from the list', async ({ page }) => {
  await page.goto('/admin/transfers?lang=vi')
  await page.locator('input[name="name"]').fill('WH/OUT/E2E')
  await page.locator('select[name="pickingTypeId"]').selectOption('wh:outgoing')
  await page.locator('input[name="scheduledDate"]').fill('2026-08-22T09:15')
  await page.getByRole('button', { name: 'Tạo' }).click()

  await expect(page).toHaveURL(/\/admin\/transfers\/[^?]+\?lang=vi$/)
  await expect(page.locator('[data-ui="record-heading"]')).toHaveText('WH/OUT/E2E')
  await page.goto('/admin/transfers?lang=vi')
  const transfer = page.getByRole('link', { name: 'WH/OUT/E2E' })
  await expect(transfer).toBeVisible()
  await transfer.click()
  await expect(page.locator('[data-ui="record-heading"]')).toHaveText('WH/OUT/E2E')
})
