import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark'])
  for (const width of [1440, 390])
    for (const view of ['overview', 'orders', 'record', 'board']) {
      test(`sales demo / ${view} / ${theme} / ${width}`, async ({ page }, testInfo) => {
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        await page.setViewportSize({ width, height: 1000 })
        await page.goto(`/demo?view=${view}&theme=${theme}`)
        await page.evaluate(() => document.fonts.ready)
        await expect(page.locator('main')).toHaveCount(1)
        await expect(page.locator('h1')).toHaveCount(1)
        await expect(page.locator('[data-ui="app-main"]')).toHaveCSS('background-color', 'rgb(246, 246, 247)')
        await expect(page.locator('[data-ui="app-main"]')).toHaveCSS('color-scheme', 'light')
        await expect(page.locator('[data-ui="app-sidebar"]')).toHaveCSS(
          'background-color',
          theme === 'light' ? 'rgb(247, 245, 245)' : 'rgb(23, 27, 32)',
        )
        await expect(page.locator('[data-ui="app-sidebar"]')).toHaveCSS('border-radius', '0px')
        await expect(page.locator('[data-ui="app-sidebar"]')).toHaveCSS('box-shadow', 'none')
        if (theme === 'light') {
          await expect(page.locator('[data-ui="app-sidebar"]')).toHaveCSS(
            width === 390 ? 'border-bottom-color' : 'border-right-color',
            'rgb(233, 231, 232)',
          )
          await expect(
            page.locator('[data-ui="app-sidebar"] [data-ui="nav-item"][data-active="true"]'),
          ).toHaveCSS('background-color', 'rgb(238, 240, 251)')
        }
        for (const header of await page.locator('main [data-ui$="-header"]').all())
          await expect(header).toHaveCSS('border-bottom-color', 'rgb(226, 228, 232)')
        for (const block of await page
          .locator(
            'main :is([data-ui="surface"], [data-ui="metric"], [data-ui="content-card"]):not([data-ui="record-page-aside"] *)',
          )
          .all()) {
          await expect(block).toHaveCSS('border-top-width', '1px')
          await expect(block).toHaveCSS('border-radius', '7px')
          await expect(block).toHaveCSS('box-shadow', 'none')
          await expect(block).toHaveCSS('background-color', 'rgb(255, 255, 255)')
          await expect(block).toHaveCSS('padding', '12px')
          await expect(block).toHaveCSS('border-top-color', 'rgb(226, 228, 232)')
        }
        for (const region of await page
          .locator('main :is([data-ui$="-context"], [data-ui$="-header"])')
          .all())
          await expect(region).toHaveCSS('background-color', 'rgb(246, 246, 247)')
        for (const aside of await page.locator('main [data-ui="record-page-aside"]').all())
          await expect(aside).toHaveCSS('background-color', 'rgb(255, 255, 255)')
        const framed =
          '[data-ui="surface"], [data-ui="metric"], [data-ui="content-card"], [data-ui="table-scroll"]:not([data-framed="false"])'
        expect(
          await page
            .locator(framed)
            .evaluateAll(
              (elements, selector) => elements.filter((element) => element.querySelector(selector)).length,
              framed,
            ),
        ).toBe(0)
        for (const surface of await page.locator('[data-ui="surface"][data-has-heading="true"]').all()) {
          await expect(surface).toHaveCSS('background-color', 'rgb(255, 255, 255)')
          await expect(surface.locator('[data-ui="surface-title"]')).toHaveCSS('font-size', '18px')
          const geometry = await surface.evaluate((element) => {
            const bounds = element.getBoundingClientRect()
            const head = element.querySelector('[data-ui="surface-head"]')!
            const heading = head.getBoundingClientRect()
            const title = head.querySelector('[data-ui="surface-title"]')!.getBoundingClientRect()
            const content = head.nextElementSibling!.getBoundingClientRect()
            return {
              inset: heading.left - bounds.left,
              top: heading.top - bounds.top,
              gap: content.top - heading.bottom,
              titleInset: title.left - bounds.left,
            }
          })
          const inset = 13
          expect(geometry.inset).toBe(inset)
          expect(geometry.top).toBe(inset)
          expect(geometry.gap).toBe(12)
          expect(geometry.titleInset).toBe(13)
          await expect(surface.locator('[data-ui="surface-head"]')).toHaveCSS('padding', '0px')
        }
        for (const table of await page.locator('[data-ui="table-scroll"][data-framed="false"]').all()) {
          await expect(table).toHaveCSS('border-top-width', '0px')
          await expect(table).toHaveCSS('border-radius', '0px')
          await expect(table).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
          await expect(table).toHaveCSS('margin-left', '0px')
          await expect(table).toHaveCSS('margin-right', '0px')
          const insets = await table.evaluate((element) => {
            const tableBounds = element.getBoundingClientRect()
            const parent = element.parentElement!
            const bounds = parent.getBoundingClientRect()
            const style = getComputedStyle(parent)
            return [
              tableBounds.left - bounds.left - parseFloat(style.borderLeftWidth),
              bounds.right - tableBounds.right - parseFloat(style.borderRightWidth),
            ]
          })
          expect(insets).toEqual([12, 12])
        }
        for (const heading of await page.locator('[data-ui="section-head"]').all())
          await expect(heading).toHaveCSS('border-bottom-width', '0px')
        for (const body of await page
          .locator(
            'main :is([data-ui="dashboard-page-body"], [data-ui="board-page-body"], [data-ui="record-page-body"])',
          )
          .all()) {
          await expect(body).toHaveCSS('padding-top', '12px')
          if (view === 'board') {
            await expect(body).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
            await expect(page.locator('[data-ui="board-page"]')).toHaveCSS(
              'background-color',
              'rgb(246, 246, 247)',
            )
          } else await expect(body).toHaveCSS('background-color', 'rgb(246, 246, 247)')
          await expect(body).toHaveCSS('padding-left', '12px')
          await expect(body).toHaveCSS('padding-right', '12px')
          for (const stack of await body.locator(':scope > [data-ui="stack"]').all())
            await expect(stack).toHaveCSS('row-gap', '8px')
        }
        for (const grid of await page.locator('main [data-ui="grid"], .demo-overview-grid').all())
          await expect(grid).toHaveCSS('gap', '8px')
        await expect(page.locator('[data-ui="table"] button')).toHaveCount(0)
        if (view === 'orders') {
          const pager = page.locator('[data-ui="list-chrome"] [data-ui="pager-bar"]')
          await expect(pager).toHaveCount(1)
          await expect(pager).toContainText('1–8 / 12 đơn hàng')
          await expect(page.locator('[data-ui="list-page-footer"], [data-ui="pager-pages"]')).toHaveCount(0)
          await expect(page.locator('[data-ui="bulk-actions"]')).toBeHidden()
          const pagerBox = await pager.boundingBox()
          const bodyBox = await page.locator('[data-ui="list-page-body"]').boundingBox()
          const searchBox = await page.locator('[data-ui="list-search"]').boundingBox()
          expect(pagerBox!.y + pagerBox!.height).toBeLessThanOrEqual(bodyBox!.y)
          const facets = page.locator('[data-row="query"] [data-ui="list-facets"]')
          const filtersBox = await facets.boundingBox()
          if (width === 1440) {
            expect(searchBox!.width).toBeLessThanOrEqual(512)
            expect(filtersBox!.x + filtersBox!.width).toBeLessThanOrEqual(pagerBox!.x)
            expect(searchBox!.x).toBeLessThan(filtersBox!.x)
            expect(Math.abs(searchBox!.y - filtersBox!.y)).toBeLessThanOrEqual(4)
            expect(Math.abs(filtersBox!.y - pagerBox!.y)).toBeLessThanOrEqual(4)
            expect(pagerBox!.x - (searchBox!.x + searchBox!.width)).toBeGreaterThan(8)
          } else {
            expect(Math.abs(searchBox!.y - pagerBox!.y)).toBeLessThanOrEqual(4)
            expect(filtersBox!.y).toBeGreaterThanOrEqual(searchBox!.y + searchBox!.height - 1)
            const firstFacet = await page.locator('[data-ui="list-facet"]').nth(0).boundingBox()
            const secondFacet = await page.locator('[data-ui="list-facet"]').nth(1).boundingBox()
            expect(Math.abs(firstFacet!.y - secondFacet!.y)).toBeLessThanOrEqual(4)
          }
          const summaryBox = await pager.locator('[data-ui="pager-summary"]').boundingBox()
          const actionsBox = await pager.locator('[data-ui="pager-actions"]').boundingBox()
          expect(actionsBox!.x - (summaryBox!.x + summaryBox!.width)).toBe(8)
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        if (view === 'record') {
          const metric = page.locator('[data-ui="record-page-aside"] [data-ui="metric"]')
          await expect(metric).toHaveCSS('border-top-width', '0px')
          await expect(metric).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
          const invalid = await page.locator('[data-ui="field"]').evaluateAll((fields) =>
            fields.flatMap((field) => {
              const label = field.querySelector('[data-ui="field-label"]')?.getBoundingClientRect()
              const control = field
                .querySelector('[data-ui="field-control"], [data-ui="field-options"]')
                ?.getBoundingClientRect()
              return label && control && label.right > control.left - 7 ? [field.textContent] : []
            }),
          )
          expect(invalid).toEqual([])
        }
        await page.screenshot({ path: testInfo.outputPath('page.png'), fullPage: true })
        if (view === 'overview') {
          await page.getByRole('link', { name: 'Tạo đơn hàng', exact: true }).click()
          await expect(page.getByRole('dialog')).toBeVisible()
          await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
          await expect(page.getByRole('dialog')).toHaveCSS('border-radius', '0px')
          await expect(page.getByLabel('Khách hàng', { exact: false })).toBeFocused()
          expect(
            await page.locator('[data-ui="app-shell"]').evaluate((element) => (element as HTMLElement).inert),
          ).toBe(true)
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
          await page.screenshot({ path: testInfo.outputPath('create-sheet.png') })
          await page.keyboard.press('Escape')
          await expect(page.getByRole('dialog')).toHaveCount(0)
        }
        expect(errors).toEqual([])
      })
    }

test('sales demo: ListChrome paging preserves the query and has no footer', async ({ page }) => {
  await page.goto('/demo?view=orders&theme=dark&q=SO&sort=asc')
  const chrome = page.locator('[data-ui="list-chrome"]')
  await expect(chrome.getByRole('link', { name: 'Trang trước', exact: true })).toHaveCount(0)
  await chrome.getByRole('link', { name: 'Trang sau', exact: true }).click()
  await expect(chrome).toContainText('9–12 / 12 đơn hàng')
  await expect(page.locator('[data-ui="row"]')).toHaveCount(4)
  const url = new URL(page.url())
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    q: 'SO',
    sort: 'asc',
    theme: 'dark',
    page: '2',
  })
  await expect(chrome.getByRole('link', { name: 'Trang sau', exact: true })).toHaveCount(0)
  await chrome.getByRole('link', { name: 'Trang trước', exact: true }).click()
  await expect(chrome).toContainText('1–8 / 12 đơn hàng')
  await page.getByRole('searchbox').fill('no-such-customer')
  await page.getByRole('button', { name: 'Tìm kiếm' }).click()
  await expect(chrome).toContainText('0–0 / 0 đơn hàng')
  await expect(chrome.locator('[data-ui="pager-link"][data-disabled="true"]')).toHaveCount(2)
  await expect(page.locator('[data-ui="list-page-footer"]')).toHaveCount(0)
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toMatchObject({
    q: 'no-such-customer',
    sort: 'asc',
    theme: 'dark',
  })
})

test('sales demo: search, pagination, bulk state, edit, history and export', async ({ page }) => {
  await page.goto('/demo?view=orders')
  await page.getByRole('searchbox').fill('Mùa Hạ')
  await page.getByRole('button', { name: 'Tìm kiếm' }).click()
  await expect(page.locator('[data-ui="row"]')).toHaveCount(1)
  await page.getByLabel('Chọn tất cả', { exact: true }).check()
  await expect(page.getByText('1 đơn được chọn')).toBeVisible()
  await page.getByRole('button', { name: 'Chuyển bước tiếp theo' }).click()
  await expect(page.getByText('Đã lưu thay đổi')).toBeVisible()
  await expect(page.locator('[data-ui="row"]')).toContainText('Đang chuẩn bị')
  const customerCell = await page.locator('[data-ui="row"] [data-col="customer"]').boundingBox()
  expect(customerCell).not.toBeNull()
  await page.mouse.click(
    customerCell!.x + customerCell!.width / 2,
    customerCell!.y + customerCell!.height / 2,
  )
  await expect(page.locator('h1')).toHaveText('SO-1042')
  await page.getByRole('textbox', { name: 'Ghi chú', exact: true }).fill('Giao tại cửa phía Đông.')
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(page.getByRole('textbox', { name: 'Ghi chú', exact: true })).toHaveValue(
    'Giao tại cửa phía Đông.',
  )
  await page.getByRole('link', { name: 'Hoạt động', exact: false }).click()
  await page.getByLabel('Nội dung', { exact: false }).fill('Đã xác nhận lịch giao với khách.')
  await page.getByRole('button', { name: 'Thêm ghi nhận' }).click()
  await expect(page.locator('[data-ui="record-page-body"]')).toContainText('Đã xác nhận lịch giao với khách.')
  await page.getByRole('link', { name: 'Chứng từ', exact: false }).click()
  await expect(page.getByText('Chưa có chứng từ')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Xuất bảng kê' }).click()
  expect((await download).suggestedFilename()).toBe('orders.csv')
  await page.goto('/demo?view=orders&page=2')
  await expect(page.locator('[data-ui="row"]')).toHaveCount(4)
  await page.getByRole('searchbox').fill('no-such-customer')
  await page.getByRole('button', { name: 'Tìm kiếm' }).click()
  await expect(page.getByText('Không tìm thấy đơn hàng')).toBeVisible()
  await page.getByRole('link', { name: 'Xóa bộ lọc' }).click()
  await expect(page.locator('[data-ui="row"]')).toHaveCount(8)
})

test('sales demo: create, validation, confirmation and keyboard modal', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const rejected = await request.post('/demo/action', {
    form: {
      intent: 'create',
      return: '/demo',
      customer: '',
      address: '',
      product: 'CF-01',
      quantity: '0',
      date: '',
    },
  })
  expect(rejected.status()).toBe(422)
  expect(await rejected.text()).toContain('Vui lòng nhập khách hàng.')
  await page.goto('/demo?modal=create')
  await page.getByLabel('Khách hàng', { exact: false }).fill('Khách kiểm thử')
  await page.getByLabel('Địa chỉ giao', { exact: false }).fill('12 Thảo Điền')
  await page.getByLabel('Email', { exact: true }).fill('demo@example.com')
  await page.getByRole('button', { name: 'Tạo đơn hàng', exact: true }).click()
  await expect(page).toHaveURL(/view=record/)
  await expect(page.getByLabel('Khách hàng', { exact: false })).toHaveValue('Khách kiểm thử')
  await page.getByRole('link', { name: 'Chuyển trạng thái' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Đang chuẩn bị')
  await dialog.getByRole('button', { name: 'Xác nhận' }).focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('link', { name: 'Đóng', exact: true })).toBeFocused()
  await dialog.getByRole('button', { name: 'Xác nhận' }).click()
  await expect(page.locator('[data-ui="record-page-status"]')).toContainText('Đang chuẩn bị')
  await page.reload()
  await expect(page.getByLabel('Khách hàng', { exact: false })).toHaveValue('Khách kiểm thử')
})
