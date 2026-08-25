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
  await expect(page).toHaveURL(/\/admin(?:\/|\?|$)/)
}

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => mkdir(artifacts, { recursive: true }))
test.beforeEach(async ({ page }) => login(page))

test('search, pagination, columns, view switching and record navigation work', async ({ page }) => {
  await page.goto('/admin/product/templates?lang=vi&view=list&cols=id')
  await expect(page.getByRole('heading', { name: 'Danh mục sản phẩm' })).toBeVisible()
  await expect(page.locator('[data-ui="chrome-create"]')).toHaveAttribute(
    'href',
    /\/admin\/product\/templates\/new/,
  )

  await page.getByRole('link', { name: 'Trang sau' }).click()
  await expect(page).toHaveURL(/page=2/)
  await expect.poll(() => page.locator('[data-ui="row"]').count()).toBeGreaterThan(0)
  expect(await page.locator('[data-ui="row"]').count()).toBeLessThan(30)

  await page.goto('/admin/product/templates?lang=vi&view=list&cols=id')
  const firstRecord = page.locator('[data-ui="row-link"]').first()
  await expect(firstRecord).toBeVisible()
  await firstRecord.click()
  await expect(page).toHaveURL(/\/admin\/product\/templates\/[^/?]+/)

  await page.goto('/admin/product/templates?lang=vi&view=list&cols=id')
  const inlineSearch = page.locator(
    '[data-ui="chrome-search"][data-presentation="inline"] [data-ui="chrome-search-input"]',
  )
  await inlineSearch.fill('Áo khoác')
  await inlineSearch.press('Enter')
  await expect(page).toHaveURL(/q=%C3%81o(?:\+|%20)kho%C3%A1c/)
  await expect(page.getByRole('link', { name: 'Áo khoác vận hành KETSUITE' })).toBeVisible()

  await page.goto('/admin/product/templates?lang=vi&view=list&cols=id')
  await page.locator('[data-ui="col-config-open"]').click()
  await page.locator('[data-ui="col-toggle"][data-on="true"]').click()
  await expect(page).not.toHaveURL(/cols=id/)

  await page.getByRole('link', { name: 'Thẻ' }).click()
  await expect(page).toHaveURL(/view=kanban/)
  await page.locator('[data-ui="kanban-title"] a').first().click()
  await expect(page).toHaveURL(/\/admin\/product\/templates\/[^/?]+/)
})

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  test(`uses the product list behavior on the partner directory on ${viewport.name}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/admin/partner/partners?lang=vi')
    await expect(page.locator('[data-ui="topbar"]')).toBeVisible()
    await expect(page.locator('[data-ui="record-workspace"]')).toHaveCount(0)
    await expect(page.locator('[data-ui="chrome-create"]')).toHaveAttribute(
      'href',
      /\/admin\/partner\/partners\/new/,
    )
    await expect(page.locator('[data-ui="list-context"]')).toContainText('Đối tác')
    await page.screenshot({
      path: join(artifacts, `partner-list-product-pattern-${viewport.name}.png`),
      fullPage: true,
    })
    if (viewport.name === 'desktop') {
      await page
        .locator('[data-ui="chrome-search"][data-presentation="inline"] [data-ui="search-menu-open"]')
        .click()
    } else {
      await page.locator('[data-ui="chrome-search-toggle"]').click()
      await page.locator('[data-ui="chrome-search-modal"] [data-ui="search-menu-open"]').click()
    }
    await expect(
      page.locator('[data-ui="search-menu-content"]').getByRole('link', { name: 'Khách hàng', exact: true }),
    ).toBeVisible()
  })

  test(`renders the partner detail and edit screens on ${viewport.name}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/admin/partner/partners?lang=vi')
    const detailPath = await page.locator('[data-row-href]').first().getAttribute('data-row-href')
    expect(detailPath).toBeTruthy()
    await page.goto(detailPath!)
    await expect(page.locator('[data-ui="partner-detail-layout"]')).toBeVisible()
    await expect(page.locator('[data-ui="topbar"]')).toHaveCount(0)
    await expect(page.locator('a[href*="tab=addresses"]')).toBeVisible()
    await expect(page.locator('a[href*="tab=roles"]')).toBeVisible()
    await page.locator('a[href*="tab=addresses"]').click()
    await expect(page).toHaveURL(/[?&]tab=addresses(?:&|$)/)
    await expect(page.locator('#partner-addresses')).toBeVisible()
    await expect(page.locator('#partner-roles')).toHaveCount(0)
    await page.locator('a[href*="tab=roles"]').click()
    await expect(page).toHaveURL(/[?&]tab=roles(?:&|$)/)
    await expect(page.locator('#partner-roles')).toBeVisible()
    await expect(page.locator('#partner-addresses')).toHaveCount(0)
    const editLink = page.locator('a[href*="/edit"]').first()
    await expect(editLink).toBeVisible()
    await page.screenshot({
      path: join(artifacts, `partner-detail-${viewport.name}.png`),
      fullPage: true,
    })

    await editLink.click()
    await expect(page.locator('#partner-identity-form')).toBeVisible()
    await expect(page.locator('[data-ui="topbar"]')).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('<!--k-->')
    await expect(page.locator('body')).not.toContainText('<ket-island')
    await expect(page.locator('ket-island[data-island="partner.address-form"]')).not.toHaveAttribute(
      'data-key',
      /address-country-/,
    )
    await page.screenshot({
      path: join(artifacts, `partner-edit-${viewport.name}.png`),
      fullPage: true,
    })
  })
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  test(`keeps the company switcher in the user menu on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/admin/product/templates?lang=vi&view=list')
    await expect(page.locator('[data-ui="topbar"] [data-ui="context-switcher"]')).toHaveCount(0)
    await expect(page.locator('[data-ui="viewer-company-indicator"]')).toHaveCount(0)
    await page.locator('[data-ui="viewer-trigger"]').click()
    const switcher = page.locator('[data-ui="viewer-context-switcher"]')
    await expect(switcher).toBeVisible()
    await expect(switcher).toHaveAttribute('href', /^\/admin\/context(?:\?|$)/)
    await expect(switcher).toContainText('Chuyển công ty')
    await page.screenshot({
      path: join(artifacts, `company-switcher-${viewport.name}.png`),
      fullPage: true,
    })
  })
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  test(`renders aligned list and kanban views on ${viewport.name}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    for (const [view, path] of [
      ['list', '/admin/product/templates?lang=vi&view=list&cols=id'],
      ['kanban', '/admin/product/templates?lang=vi&view=kanban'],
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
        tableHeader: (() => {
          const header = document.querySelector<HTMLElement>('[data-ui="table"] th')
          return header ? getComputedStyle(header).backgroundColor : null
        })(),
        rowHeight:
          document.querySelector<HTMLElement>('[data-ui="row"]')?.getBoundingClientRect().height ?? null,
      }))
      expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
      expect(metrics.main).not.toBeNull()
      expect(metrics.create).not.toBeNull()
      expect(metrics.create!.left - metrics.main!.left).toBeGreaterThanOrEqual(12)
      expect(metrics.create!.height).toBe(viewport.name === 'desktop' ? 28 : 44)
      expect(metrics.iconSizes.every(({ width, height }) => width <= 14 && height <= 14)).toBeTruthy()
      if (view === 'list') {
        expect(metrics.tableHeader).toBe('rgb(40, 45, 52)')
        expect(metrics.rowHeight).toBe(52)
      }
      await page.screenshot({ path: join(artifacts, `${view}-${viewport.name}.png`), fullPage: true })
    }
  })
}

test('renders the English locale without falling back to the login screen', async ({ page }) => {
  await page.goto('/admin/product/templates?lang=en&view=list')
  await expect(page).toHaveURL(/\/admin\/product\/templates/)
  await expect(page.locator('[data-ui="main"]')).toBeVisible()
  await expect(page.locator('form[action="/login"]')).toHaveCount(0)
  await page.screenshot({ path: join(artifacts, 'list-en-desktop.png'), fullPage: true })
})
