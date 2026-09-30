import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark']) {
  for (const width of [390, 768, 1440]) {
    test(`primitive alignment / ${theme} / ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      for (const density of ['compact', 'default', 'comfortable']) {
        await page.goto(`/primitives?theme=${theme}&density=${density}`)
        await expect(page.getByRole('navigation', { name: 'Primitive families' })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        for (const size of ['compact', 'default', 'prominent']) {
          const group = page.getByRole('group', { name: `${size} actions`, exact: true })
          const boxes = await group.getByRole('button').evaluateAll((nodes) =>
            nodes.map((node) => {
              const { width, height, top } = node.getBoundingClientRect()
              return { width, height, top }
            }),
          )
          expect(boxes[0].height).toBeCloseTo(boxes[1].height, 1)
          expect(boxes[0].top).toBeCloseTo(boxes[1].top, 1)
          expect(boxes[1].width).toBeCloseTo(boxes[1].height, 1)
        }
        const leaks = await page.locator('[data-ui="primitive-sample"]').evaluateAll((samples) =>
          samples.flatMap((sample) => {
            const frame = sample.getBoundingClientRect()
            return [
              ...sample.querySelectorAll(
                '[data-ui="action"], [data-ui="field-control"], [data-ui="tag"], [data-ui="notice"], [data-ui="progress"]',
              ),
            ]
              .filter((node) => node.getBoundingClientRect().right > frame.right + 1)
              .map((node) => node.getAttribute('data-ui'))
          }),
        )
        expect(leaks).toEqual([])
        const select = page.locator('#primitive-region')
        await expect(select).toHaveCSS('appearance', 'none')
        const rows = await select.evaluate((node) => ({
          control: getComputedStyle(node).gridRowStart,
          chevron: getComputedStyle(node.parentElement!, '::after').gridRowStart,
          interactive: getComputedStyle(node.parentElement!, '::after').pointerEvents,
        }))
        expect(rows.control).toBe(rows.chevron)
        expect(rows.interactive).toBe('none')
        const notice = page.locator('#primitive-feedback [data-ui="notice"]').last()
        const mark = await notice.locator('[data-ui="notice-mark"]').boundingBox()
        const copy = await notice.locator('[data-ui="notice-copy"]').boundingBox()
        const action = await notice.locator('[data-ui="notice-actions"]').boundingBox()
        expect(mark!.y).toBeCloseTo(copy!.y, 1)
        expect(mark!.x + mark!.width).toBeLessThan(copy!.x)
        if (width === 390) expect(action!.y).toBeGreaterThanOrEqual(copy!.y + copy!.height)
      }
    })
  }
}

test('primitive keyboard controls and route state work without specimen scripts', async ({ page }) => {
  await page.goto('/primitives?theme=dark&density=compact')
  const name = page.getByRole('textbox', { name: 'Project name', exact: true })
  await name.fill('Kế hoạch khu vực')
  await name.press('Tab')
  await expect(page.getByRole('combobox', { name: 'Region', exact: true })).toBeFocused()
  await page.getByRole('combobox', { name: 'Region', exact: true }).selectOption('hcm')
  await expect(page.getByRole('combobox', { name: 'Region', exact: true })).toHaveValue('hcm')
  const notify = page.getByRole('checkbox', { name: 'Send updates' })
  await notify.focus()
  await notify.press('Space')
  await expect(notify).not.toBeChecked()
  const team = page.getByRole('radio', { name: 'Team', exact: true })
  await team.focus()
  await team.press('ArrowRight')
  await expect(page.getByRole('radio', { name: 'Private', exact: true })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'Public', exact: true })).toBeDisabled()
  await page
    .getByRole('navigation', { name: 'Project views' })
    .getByRole('link', { name: 'Activity' })
    .click()
  await expect(page).toHaveURL(/theme=dark&density=compact&tab=activity/)
  await expect(page.locator('#primitive-project-panel')).toContainText('updated the project description')
  await page.getByRole('link', { name: 'Light', exact: true }).click()
  await expect(page).toHaveURL(/tab=activity&theme=light&density=compact/)
  await expect(page.locator('#primitive-project-tabs-activity-tab')).toHaveAttribute('aria-current', 'page')
})
