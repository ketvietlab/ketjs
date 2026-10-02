import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/login?lang=vi')
  await page.locator('input[name="login"]').fill('admin')
  await page.locator('input[name="password"]').fill('product-demo')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/admin(?:\/|\?|$)/)
})

for (const width of [1440, 1024, 390]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`SearchFilter layout and keyboard dismissal at ${width}px ${colorScheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme })
      await page.goto('/admin/product/templates?lang=vi')
      const toggle = page.locator('[data-ui="search-filter-toggle"]')
      const menu = page.locator('[data-ui="menu"][data-variant="search-filter"]')
      await toggle.click()
      if (width === 390) {
        const sheet = page.locator('[data-ui="search-filter-sheet"]')
        await expect(sheet).toBeVisible()
        await expect(sheet.locator('[data-ui="modal-close"]')).toBeFocused()
        await expect(sheet.getByRole('button', { name: 'Đóng', exact: true })).toHaveCount(1)
        await expect(page.locator('[data-ui="search-filter-section-toggle"]').first()).toBeHidden()
        const box = await sheet.boundingBox()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width)
        await sheet.getByRole('combobox', { name: 'Trường', exact: true }).selectOption('categoryId')
        await sheet.getByRole('combobox', { name: 'Điều kiện', exact: true }).selectOption('equals')
        await expect(sheet.getByRole('combobox', { name: 'Giá trị', exact: true })).toBeVisible()
        await page.screenshot({ path: `test-results/product-filter-sheet-${width}-${colorScheme}.png` })
        await page.keyboard.press('Escape')
        await expect(sheet).not.toBeVisible()
        await expect(toggle).toBeFocused()
      } else {
        const panel = menu.locator('[data-ui="menu-panel"]')
        await expect(panel).toBeVisible()
        const bar = await page.locator('[data-ui="search-filter-bar"]').boundingBox()
        const box = await panel.boundingBox()
        expect(box!.x).toBeGreaterThanOrEqual(bar!.x - 1)
        expect(box!.x + box!.width).toBeLessThanOrEqual(bar!.x + bar!.width + 1)
        await panel.getByRole('combobox', { name: 'Trường', exact: true }).click()
        await expect(panel).toBeVisible()
        await page.getByRole('heading', { name: 'Danh mục sản phẩm', exact: true }).click()
        await expect(menu).not.toHaveAttribute('open')
        await page.locator('[data-ui="search-filter-section-toggle"][data-section="favorite"]').click()
        await expect(panel.locator('[data-ui="favorite-save"]')).toHaveCount(0)
        await expect(panel.getByRole('link', { name: 'Lưu bộ lọc này' })).toHaveAttribute(
          'href',
          /modal=favorite/,
        )
        await page.keyboard.press('Escape')
        await expect(menu).not.toHaveAttribute('open')
      }
      await page.screenshot({ path: `test-results/product-list-${width}-${colorScheme}.png` })
    })
  }
}

test('inline favorite form stays open on desktop and returns focus after cancel/save', async ({ page }) => {
  await page.goto('/admin/sales/orders?lang=vi')
  const menu = page.locator('[data-ui="menu"][data-variant="search-filter"]')
  await page.locator('[data-ui="search-filter-section-toggle"][data-section="favorite"]').click()
  const opener = menu.locator('[data-ui="favorite-save-toggle"]')
  await opener.click()
  const form = menu.locator('[data-ui="favorite-save"]')
  const name = form.getByRole('textbox', { name: 'Tên bộ lọc' })
  await expect(menu).toHaveAttribute('open')
  await expect(name).toBeFocused()
  expect((await form.boundingBox())!.y).toBeGreaterThan((await opener.boundingBox())!.y)
  await form.getByRole('button', { name: 'Huỷ', exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(opener).toBeFocused()
  await opener.click()
  await name.fill('Desktop regression favorite')
  await form.getByRole('button', { name: 'Lưu', exact: true }).click()
  // Applying a saved favorite may navigate; both response modes must retain the saved entry.
  await expect(page.locator('[data-ui="search-filter-facet"][data-type="favorite"]')).toContainText(
    'Desktop regression favorite',
  )
})

test('Escape closes a nested grouping disclosure before returning to its desktop trigger', async ({
  page,
}) => {
  await page.goto('/admin/sales/orders?lang=vi')
  const trigger = page.locator('[data-ui="search-filter-section-toggle"][data-section="groupBy"]')
  await trigger.click()
  const menu = page.locator('[data-ui="menu"][data-variant="search-filter"]')
  const disclosure = menu.locator('[data-facet-type="groupBy"] details[data-ui="disclosure"]').first()
  const summary = disclosure.locator('summary')
  await summary.click()
  await summary.press('Tab')
  await page.keyboard.press('Escape')
  await expect(disclosure).not.toHaveAttribute('open')
  await expect(summary).toBeFocused()
  await expect(menu).toHaveAttribute('open')
  await page.keyboard.press('Escape')
  await expect(menu).not.toHaveAttribute('open')
  await expect(trigger).toBeFocused()
})

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
  await page.locator('[data-ui="search-filter-section-toggle"][data-section="groupBy"]').click()
  await expect(page.locator('[data-ui="custom-group-by"]')).toBeDisabled()
  await page.keyboard.press('Escape')
  for (let depth = 0; depth < 4; depth++) {
    await page.locator('[data-ui="kt-group-toggle"][aria-expanded="false"]').first().click()
  }
  await expect(page.locator('[data-ui="kt-row"]')).not.toHaveCount(0)
})
