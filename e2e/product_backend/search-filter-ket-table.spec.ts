import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/login?lang=vi')
  await page.locator('input[name="login"]').fill('admin')
  await page.locator('input[name="password"]').fill('product-demo')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/admin(?:\/|\?|$)/)
})

for (const width of [1440, 1024, 390]) {
  test(`SearchFilter stays inside its bar and dismisses at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/admin/product/templates?lang=vi')
    const toggle = page.locator('[data-ui="search-filter-toggle"]')
    const menu = page.locator('[data-ui="menu"][data-variant="search-filter"]')
    const panel = menu.locator('[data-ui="menu-panel"]')
    await toggle.click()
    await expect(panel).toBeVisible()
    const bar = await page.locator('[data-ui="search-filter-bar"]').boundingBox()
    const box = await panel.boundingBox()
    expect(bar).not.toBeNull()
    expect(bar!.width).toBeGreaterThan(200)
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(bar!.x - 1)
    expect(box!.x + box!.width).toBeLessThanOrEqual(bar!.x + bar!.width + 1)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    // A real click must reach the panel, not the table beneath it.
    await panel.getByRole('textbox', { name: 'Tên tìm kiếm' }).click()
    await expect(panel).toBeVisible()
    await page.getByRole('heading', { name: 'Danh mục sản phẩm', exact: true }).click()
    await expect(menu).not.toHaveAttribute('open')
    await toggle.click()
    await page.keyboard.press('Escape')
    await expect(menu).not.toHaveAttribute('open')
    await page.screenshot({ path: `test-results/product-list-${width}.png`, fullPage: true })
  })
}

test('KetTable preserves pagination, selection, native sort and record-modal navigation', async ({
  page,
}) => {
  await page.goto('/admin/product/templates?lang=vi&page=2&cols=id')
  await expect(page.locator('[data-ui="ket-table"]')).toBeVisible()
  await expect(page.locator('[data-ui="kt-row"]')).not.toHaveCount(0)
  await expect(page.locator('[data-ui="pager-range"]')).toContainText('31')
  await expect(page.locator('[data-ui="kt-pager"]')).toHaveCount(0)
  const url = page.url()
  await page.locator('[data-ui="kt-row-select"]').first().check()
  await expect(page).toHaveURL(url)
  await expect(page.locator('[data-ui="kt-select-all"]')).toHaveJSProperty('indeterminate', true)
  await expect(page.locator('[data-ui="kt-select-persisted"] input')).toHaveCount(1)
  await expect(page.locator('[data-ui="kt-select-persisted"] input')).toHaveAttribute(
    'form',
    'product-template-bulk',
  )
  await page.locator('[data-ui="kt-select-all"]').check()
  await expect(page.locator('[data-ui="kt-row-select"]:not(:checked)')).toHaveCount(0)
  await page.locator('[data-ui="kt-select-all"]').uncheck()
  await expect(page.locator('[data-ui="kt-select-persisted"] input')).toHaveCount(0)
  await page.locator('[data-ui="kt-col"][data-col="name"] a').click()
  await expect(page).not.toHaveURL(/page=2/)
  await expect(page.locator('[data-ui="kt-col"][data-col="name"]')).toHaveAttribute('aria-sort', 'descending')
  await page
    .locator('[data-ui="kt-row"]')
    .first()
    .locator('[data-ui="kt-cell"]')
    .nth(1)
    .click({ force: true })
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page).toHaveURL(/record=product\.template/)
})

test('SearchFilter applies text, groups four levels, and prevents a fifth', async ({ page }) => {
  await page.goto('/admin/product/templates?lang=vi')
  await page.locator('[data-ui="search-filter-input"]').fill('Áo khoác')
  await page.locator('[data-ui="search-filter-input"]').press('Enter')
  await expect(page).toHaveURL(/q=/)
  await expect(page.locator('[data-ui="kt-row"]')).toContainText(['Áo khoác'])
  await page.goto(
    '/admin/product/templates?lang=vi&group=categoryId&group=active&group=saleOk&group=purchaseOk',
  )
  await expect(page.locator('[data-ui="search-filter-grouping-item"]')).toHaveCount(4)
  await page.locator('[data-ui="search-filter-toggle"]').click()
  await expect(page.locator('[data-ui="custom-group-by"]')).toBeDisabled()
  await page.keyboard.press('Escape')
  for (let depth = 0; depth < 4; depth++) {
    await page.locator('[data-ui="kt-group-toggle"][aria-expanded="false"]').first().click()
  }
  await expect(page.locator('[data-ui="kt-row"]')).not.toHaveCount(0)
})
