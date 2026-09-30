import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/dates')
})

test('all seven presets commit civil dates and keep one visible range input', async ({ page }) => {
  const picker = page.locator('#range')
  for (const [label, from, to] of [
    ['Hôm nay', '2026-09-30', '2026-09-30'],
    ['Hôm qua', '2026-09-29', '2026-09-29'],
    ['7 ngày qua', '2026-09-24', '2026-09-30'],
    ['Tháng này', '2026-09-01', '2026-09-30'],
    ['Tháng trước', '2026-08-01', '2026-08-31'],
    ['30 ngày qua', '2026-09-01', '2026-09-30'],
    ['90 ngày qua', '2026-07-03', '2026-09-30'],
  ]) {
    await picker.locator('#range-input').click()
    await picker.locator('select').selectOption({ label })
    await expect(page.locator('#range-input')).toBeVisible()
    await expect(picker.locator('input:not([type="hidden"])')).toHaveCount(1)
    await expect(page.locator('#from')).toHaveValue(from)
    await expect(page.locator('#to')).toHaveValue(to)
  }
})

test('range draft supports reverse and cross-month selection, cancel and native reset', async ({ page }) => {
  const picker = page.locator('#range')
  const open = picker.getByRole('button', { name: 'Chọn khoảng ngày', exact: true })
  await open.click()
  await picker.locator('[data-date="2026-10-02"]').click()
  await expect(picker.getByRole('button', { name: 'Áp dụng' })).toBeDisabled()
  await picker.locator('[data-date="2026-09-29"]').click()
  await expect(picker.getByRole('status')).toHaveText('29/09/2026 — 02/10/2026')
  await expect(page.locator('#from')).toHaveValue('2026-09-01')
  await picker.getByRole('button', { name: 'Hủy', exact: true }).click()
  await expect(open).toBeFocused()
  await expect(page.locator('#to')).toHaveValue('2026-09-30')
  await picker.locator('#range-input').click()
  await picker.locator('select').selectOption('last7')
  await page.getByRole('button', { name: 'Đặt lại', exact: true }).click()
  await expect(page.locator('#from')).toHaveValue('2026-09-01')
})

test('single calendar supports keyboard month transitions and Escape focus return', async ({ page }) => {
  const open = page.getByRole('button', { name: 'Chọn ngày: Ngày giao hàng', exact: true })
  await open.click()
  const calendar = page.locator('#date-calendar')
  const selected = calendar.locator('[data-date="2026-09-30"]')
  await expect(selected).toBeFocused()
  await selected.press('ArrowRight')
  const next = calendar.locator('[data-date="2026-10-01"]')
  await expect(next).toBeFocused()
  await next.press('Enter')
  await expect(page.locator('#date')).toHaveValue('2026-09-30')
  await calendar.getByRole('button', { name: 'Áp dụng' }).click()
  await expect(page.locator('#date')).toHaveValue('2026-10-01')
  await expect(open).toBeFocused()
  await open.click()
  await calendar.locator('[data-date="2026-10-01"]').press('Escape')
  await expect(calendar).not.toBeVisible()
  await expect(open).toBeFocused()
})

test('bounds and readonly state constrain calendar selection', async ({ page }) => {
  await page.getByText('Giới hạn ngày và trạng thái', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Chọn ngày: Ngày xác nhận', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Chọn ngày: Ngày lưu trữ', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Chọn ngày: Lịch hẹn', exact: true }).click()
  await expect(page.locator('#bounded-date-calendar [data-date="2026-09-09"]')).toBeDisabled()
  await expect(page.locator('#bounded-date-calendar [data-date="2026-09-20"]')).toBeEnabled()
  await expect(page.locator('#bounded-date-calendar [data-date="2026-09-21"]')).toBeDisabled()
  await page.locator('#bounded-date-calendar').getByRole('button', { name: 'Hủy', exact: true }).click()
  const presets = page.locator('#bounded-range-preset')
  await expect(presets.locator('option[value="last7"]')).toBeEnabled()
  await expect(presets.locator('option[value="last30"]')).toBeDisabled()
})

for (const theme of ['light', 'dark']) {
  test(`mobile calendars cover the viewport / ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/dates?theme=${theme}`)
    await page.locator('#range').getByRole('button', { name: 'Chọn khoảng ngày', exact: true }).click()
    const calendar = page.locator('#range-calendar')
    await expect(calendar.getByRole('grid')).toHaveCount(12)
    await expect(calendar).toHaveAttribute('aria-modal', 'true')
    const box = await calendar.boundingBox()
    expect(box).toEqual({ x: 0, y: 0, width: 390, height: 844 })
    await calendar.getByRole('button', { name: 'Áp dụng' }).focus()
    await calendar.getByRole('button', { name: 'Áp dụng' }).press('Tab')
    await expect(calendar.locator('select')).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await calendar.getByRole('button', { name: 'Hủy', exact: true }).click()
    await page.locator('#range-input').click()
    await page.locator('#range-preset').selectOption('last90')
    await expect(page.locator('#range-input')).toBeVisible()
    await expect(page.locator('#from')).toHaveValue('2026-07-03')
    await page.getByRole('button', { name: 'Chọn ngày: Ngày giao hàng', exact: true }).click()
    const single = page.locator('#date-calendar')
    expect(await single.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 })
    await expect(single).toHaveAttribute('aria-modal', 'true')
    await single.getByRole('button', { name: 'Hủy', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Chọn ngày: Ngày giao hàng', exact: true })).toBeFocused()
  })
}

test('mobile range scrolls through months without moving its footer or losing its draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('#range').getByRole('button', { name: 'Chọn khoảng ngày', exact: true }).click()
  const calendar = page.locator('#range-calendar')
  const footer = await calendar.locator('[data-ui="date-calendar-footer"]').boundingBox()
  await calendar.locator('[data-date="2026-09-29"]').click()
  await expect(calendar.getByRole('button', { name: 'Áp dụng' })).toBeDisabled()
  await calendar.locator('[data-date="2026-12-03"]').scrollIntoViewIfNeeded()
  await calendar.locator('[data-date="2026-12-03"]').click()
  await expect(calendar.getByRole('status')).toHaveText('29/09/2026 — 03/12/2026')
  expect(await calendar.locator('[data-ui="date-calendar-footer"]').boundingBox()).toEqual(footer)
  await calendar.getByRole('button', { name: 'Áp dụng' }).click()
  await expect(page.locator('#from')).toHaveValue('2026-09-29')
  await expect(page.locator('#to')).toHaveValue('2026-12-03')
})

test('native form submits only civil-date fields and reset preserves defaults', async ({ page }) => {
  await page.locator('#range-input').click()
  await page.locator('#range-preset').selectOption('last7')
  await page.getByRole('button', { name: 'Kiểm tra giá trị', exact: true }).click()
  await expect(page).toHaveURL(/\/specimens\/dates\?/)
  const query = new URL(page.url()).searchParams
  expect(query.get('from')).toBe('2026-09-24')
  expect(query.get('to')).toBe('2026-09-30')
  expect(query.has('kv-date-command')).toBe(false)
  expect(query.has('disabledDate')).toBe(false)
  expect(query.get('readonlyDate')).toBe('2026-09-15')
})
