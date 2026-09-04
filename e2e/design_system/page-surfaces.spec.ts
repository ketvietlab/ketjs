import { expect, test } from '@playwright/test'

const kinds = ['list', 'record', 'flow', 'canvas', 'form-compat', 'dashboard-compat', 'board-compat'] as const
const states = ['baseline', 'loading', 'empty', 'error', 'validation', 'readonly'] as const
const hooks = {
  list: 'list-page',
  record: 'form-page',
  flow: 'dashboard-page',
  canvas: 'board-page',
  'form-compat': 'form-page',
  'dashboard-compat': 'dashboard-page',
  'board-compat': 'board-page',
}

test('catalogue links to the surface preview and rejects unsupported query values', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/?theme=light')
    await page.getByRole('link', { name: 'Review page surfaces' }).click()
    await expect(page.locator('[data-pattern="record"]')).toBeVisible()
    await expect(page.locator('[data-ui="catalogue-surface-preview"]')).toHaveAttribute('data-theme', 'light')
    await page.goto('/surfaces?kind=unknown&lang=unknown&theme=unknown&state=unknown&tab=unknown')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('[data-ui="catalogue-surface-preview"]')).toHaveAttribute('data-theme', 'light')
    await expect(page.locator('[data-pattern="record"]')).toBeVisible()
    await expect(page.locator('[data-ui="tab"]').filter({ hasText: 'Details' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(page.getByRole('textbox', { name: 'Display name' })).toBeEnabled()
  }
})

for (const kind of kinds)
  for (const lang of ['en', 'vi'])
    for (const theme of ['light', 'dark'])
      for (const width of [1440, 390]) {
        test(`${kind} surfaces / ${lang} / ${theme} / ${width}`, async ({ page }, testInfo) => {
          const errors: string[] = []
          page.on('pageerror', (error) => errors.push(error.message))
          await page.setViewportSize({ width, height: 1000 })
          const hook = hooks[kind]
          const record = hook === 'form-page'
          const canvas = hook === 'board-page'
          const workspace = canvas || hook === 'dashboard-page'
          const chrome = theme === 'light' ? 'rgb(247, 245, 245)' : 'rgb(29, 34, 40)'
          const working = theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(27, 31, 36)'
          const ground = theme === 'light' ? 'rgb(247, 245, 245)' : 'rgb(27, 31, 36)'
          const evidence = []
          for (const state of states) {
            await page.goto(`/surfaces?${new URLSearchParams({ kind, lang, theme, state })}`)
            const main = page.locator('[data-ui="app-main"]')
            const header = main.locator(`[data-ui="${hook}-header"]`)
            const body = main.locator(`[data-ui="${hook}-body"]`)
            await expect(main.locator('h1')).toHaveCount(1)
            await expect(main.locator('[data-pattern]')).toHaveCount(1)
            await expect(main.locator('[data-ui$="-eyebrow"]')).toHaveCount(0)
            await expect(header).toHaveCSS('background-color', chrome)
            await expect(main.locator(`[data-ui="${hook}-context"]`)).toHaveCSS('background-color', chrome)
            await expect(header).toHaveCSS('padding-top', '16px')
            await expect(header).toHaveCSS('padding-left', width === 390 ? '16px' : '28px')
            await expect(header.locator('h1')).toHaveCSS('font-size', width === 390 ? '16px' : '24px')
            if (!workspace) await expect(body).toHaveCSS('background-color', ground)
            else {
              await expect(main.locator('[data-pattern]')).toHaveCSS('background-color', ground)
              if (!canvas) await expect(body).toHaveCSS('background-color', ground)
              if (['baseline', 'validation', 'readonly'].includes(state)) {
                const panel = theme === 'light' ? working : 'rgb(29, 34, 40)'
                await expect(body.locator('[data-ui="surface"]')).toHaveCSS('background-color', panel)
                for (const metric of await body.locator('[data-ui="metric"]').all())
                  await expect(metric).toHaveCSS('background-color', panel)
                const gap = await body.evaluate((e) => {
                  const surface = e.querySelector('[data-ui="surface"]')!.getBoundingClientRect()
                  const grid = e.querySelector('[data-ui="grid"]')!.getBoundingClientRect()
                  const point = document.elementFromPoint(surface.left + 4, (grid.bottom + surface.top) / 2)!
                  let painted: Element | null = point
                  while (painted && getComputedStyle(painted).backgroundColor === 'rgba(0, 0, 0, 0)')
                    painted = painted.parentElement
                  return {
                    size: surface.top - grid.bottom,
                    background: painted && getComputedStyle(painted).backgroundColor,
                  }
                })
                expect(gap.size).toBeGreaterThanOrEqual(12)
                expect(gap.background).toBe(ground)
              }
            }
            if (record) {
              await expect(main.locator('[data-ui="form-page-navigation"]')).toHaveCSS(
                'background-color',
                ground,
              )
              await expect(main.locator('[data-ui="form-page-controller"]')).toBeHidden()
              await expect(main.locator('[data-ui="form-page-aside"]')).toHaveCSS(
                'background-color',
                theme === 'light' ? ground : 'rgb(23, 27, 32)',
              )
            }
            if (state === 'loading') await expect(body.locator('[data-ui="loading"]')).toBeVisible()
            if (state === 'empty') await expect(body.locator('[data-ui="empty"]')).toBeVisible()
            if (state === 'error') await expect(body.getByRole('alert')).toBeVisible()
            if (record && state === 'validation')
              await expect(body.locator('[aria-invalid="true"]')).toHaveCount(1)
            if (state === 'readonly') {
              await expect(header.locator('button')).toBeDisabled()
              if (record) await expect(body.locator('input')).toBeDisabled()
            }
            if (!record && ['baseline', 'validation', 'readonly'].includes(state)) {
              await expect(body.locator('[data-ui="table-scroll"]')).toHaveCSS(
                'background-color',
                theme === 'light' ? working : 'rgba(0, 0, 0, 0)',
              )
            }
            for (const surface of await body.locator('[data-ui="surface"]').all())
              await expect(surface).toHaveCSS(
                'background-color',
                theme === 'light' ? working : 'rgb(29, 34, 40)',
              )
            if (width === 390) {
              const overlaps = await body.locator('[data-responsive="stack"]').evaluateAll((tables) =>
                tables.flatMap((table) => {
                  const rows = [...table.querySelectorAll('[data-ui="row"]')]
                  return rows.flatMap((row, index) => {
                    const bounds = row.getBoundingClientRect()
                    const cells = [...row.querySelectorAll('[data-ui="cell"]')].map((cell) =>
                      cell.getBoundingClientRect(),
                    )
                    const previous = rows[index - 1]?.getBoundingClientRect()
                    return (previous && previous.bottom > bounds.top + 1) ||
                      cells.some(
                        (cell, i) =>
                          cell.bottom > bounds.bottom + 1 || (i > 0 && cells[i - 1].bottom > cell.top + 1),
                      )
                      ? [row.textContent]
                      : []
                  })
                }),
              )
              expect(overlaps).toEqual([])
            }
            const geometry = await page.evaluate((hook) => {
              const main = document.querySelector('[data-ui="app-main"]')!
              const header = main.querySelector(`[data-ui="${hook}-header"]`) as HTMLElement
              const body = main.querySelector(`[data-ui="${hook}-body"]`) as HTMLElement
              const actions = [...header.querySelectorAll('[data-ui="action"]')].map((e) =>
                e.getBoundingClientRect(),
              )
              return {
                viewport: innerWidth,
                document: document.documentElement.scrollWidth,
                headerBottom: header.getBoundingClientRect().bottom,
                bodyTop: body.getBoundingClientRect().top,
                bodyPadding: getComputedStyle(body).padding,
                actionGap:
                  actions.length > 1 && Math.abs(actions[0].top - actions[1].top) < 2
                    ? actions[1].left - actions[0].right
                    : null,
              }
            }, hook)
            expect(geometry.document).toBeLessThanOrEqual(width)
            expect(geometry.bodyTop).toBeGreaterThanOrEqual(geometry.headerBottom)
            if (geometry.actionGap !== null) expect(geometry.actionGap).toBeGreaterThanOrEqual(8)
            evidence.push({ state, ...geometry })
            if (state === 'baseline')
              await page.screenshot({ path: testInfo.outputPath('baseline.png'), fullPage: true })
          }
          if (record) {
            await page.goto(`/surfaces?${new URLSearchParams({ kind, lang, theme, state: 'baseline' })}`)
            const body = page.locator('[data-ui="form-page-body"]')
            const before = await body.evaluate((e) => ({
              padding: getComputedStyle(e).padding,
              top: e.getBoundingClientRect().top,
            }))
            await page.locator('[data-ui="tab"]').nth(1).click()
            await expect(page).toHaveURL(/tab=activity/)
            const after = await body.evaluate((e) => ({
              padding: getComputedStyle(e).padding,
              top: e.getBoundingClientRect().top,
            }))
            expect(after).toEqual(before)
            await page.goto(`/surfaces?${new URLSearchParams({ kind, lang, theme, aside: 'false' })}`)
            await expect(page.locator('[data-ui="form-page-aside"]')).toHaveCount(0)
            expect(await body.evaluate((e) => getComputedStyle(e).padding)).toBe(before.padding)
          } else {
            await page.goto(`/surfaces?${new URLSearchParams({ kind, lang, theme, controls: 'false' })}`)
            await expect(page.locator(`[data-ui="${hook}-toolbar"]`)).toHaveCount(0)
          }
          expect(errors).toEqual([])
          await testInfo.attach('surface-state-metrics', {
            body: JSON.stringify(evidence, null, 2),
            contentType: 'application/json',
          })
        })
      }
