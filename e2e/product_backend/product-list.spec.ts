import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const artifacts = join(moduleDir, 'artifacts', 'product-list')

const login = async (page: Page, lang: 'vi' | 'en' = 'vi') => {
  await page.goto(`/login?lang=${lang}`)
  await page.locator('input[name="login"]').fill('admin')
  await page.locator('input[name="password"]').fill('product-demo')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/admin(?:\?|$)/)
}

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => mkdir(artifacts, { recursive: true }))
test.beforeEach(async ({ page }) => login(page))

test('search, pagination, columns, view switching and record navigation work', async ({ page }) => {
  await page.goto('/admin/products?lang=vi&view=list&cols=id')
  await expect(page.getByRole('heading', { name: 'Danh mục sản phẩm' })).toBeVisible()
  await expect(page.locator('[data-ui="chrome-create"]')).toHaveAttribute('href', /\/admin\/products\/new/)

  await page.getByRole('link', { name: 'Trang sau' }).click()
  await expect(page).toHaveURL(/page=2/)
  await expect(page.locator('[data-ui="row"]')).toHaveCount(2)

  await page.goto('/admin/products?lang=vi&view=list&cols=id')
  const firstRecord = page.locator('[data-ui="row-link"]').first()
  await expect(firstRecord).toBeVisible()
  await firstRecord.click()
  await expect(page).toHaveURL(/\/admin\/products\/[^/?]+/)

  await page.goto('/admin/products?lang=vi&view=list&cols=id')
  await page.locator('[data-ui="chrome-search-input"]').fill('Áo khoác')
  await page.locator('[data-ui="chrome-search-input"]').press('Enter')
  await expect(page).toHaveURL(/q=%C3%81o(?:\+|%20)kho%C3%A1c/)
  await expect(page.getByRole('link', { name: 'Áo khoác vận hành KETSUITE' })).toBeVisible()

  await page.goto('/admin/products?lang=vi&view=list&cols=id')
  await page.locator('[data-ui="col-config-open"]').click()
  await page.locator('[data-ui="col-toggle"][data-on="true"]').click()
  await expect(page).not.toHaveURL(/cols=id/)

  await page.getByRole('link', { name: 'Thẻ' }).click()
  await expect(page).toHaveURL(/view=kanban/)
  await page.locator('[data-ui="kanban-title"] a').first().click()
  await expect(page).toHaveURL(/\/admin\/products\/[^/?]+/)
})

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  test(`renders aligned list and kanban views on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    for (const [view, path] of [
      ['list', '/admin/products?lang=vi&view=list&cols=id'],
      ['kanban', '/admin/products?lang=vi&view=kanban'],
    ] as const) {
      await page.goto(path)
      await expect(page.locator('[data-ui="main"]')).toBeVisible()
      const metrics = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        main: (() => {
          const box = document.querySelector<HTMLElement>('[data-ui="main"]')?.getBoundingClientRect()
          return box ? { left: box.left } : null
        })(),
        create: (() => {
          const box = document
            .querySelector<HTMLElement>('[data-ui="chrome-create"]')
            ?.getBoundingClientRect()
          return box ? { left: box.left, height: box.height } : null
        })(),
        iconSizes: [
          ...document.querySelectorAll<HTMLElement>(
            '[data-ui="view-kind"] [data-ui="icon"], [data-ui="col-config-open"] [data-ui="icon"]',
          ),
        ].map((icon) => {
          const box = icon.getBoundingClientRect()
          return { width: box.width, height: box.height }
        }),
      }))
      expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
      expect(metrics.main).not.toBeNull()
      expect(metrics.create).not.toBeNull()
      expect(metrics.create!.left - metrics.main!.left).toBeGreaterThanOrEqual(12)
      expect(metrics.create!.height).toBe(viewport.name === 'desktop' ? 28 : 44)
      expect(metrics.iconSizes.every(({ width, height }) => width <= 14 && height <= 14)).toBeTruthy()
      await page.screenshot({ path: join(artifacts, `${view}-${viewport.name}.png`), fullPage: true })
    }
  })
}

test('renders the English locale without falling back to the login screen', async ({ page }) => {
  await page.goto('/admin/products?lang=en&view=list')
  await expect(page).toHaveURL(/\/admin\/products/)
  await expect(page.locator('[data-ui="main"]')).toBeVisible()
  await expect(page.locator('form[action="/login"]')).toHaveCount(0)
  await page.screenshot({ path: join(artifacts, 'list-en-desktop.png'), fullPage: true })
})
