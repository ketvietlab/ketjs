import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark'])
  for (const width of [1440, 390]) {
    test(`catalogue surface ownership / ${theme} / ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(`/?theme=${theme}`)
      await page.evaluate(() => document.fonts.ready)
      const framed =
        '[data-ui="surface"], [data-ui="content-card"], [data-ui="metric"], [data-ui="table-scroll"]:not([data-framed="false"])'
      for (const id of ['app-shell', 'record-page', 'workspace-flow', 'workspace-canvas']) {
        const specimen = page.locator(`[data-ui="catalogue-specimen"]#${id}`)
        await expect(specimen).toBeVisible()
        for (const heading of await specimen.locator('[data-ui="section-head"]').all()) {
          await expect(heading).toHaveCSS('border-bottom-width', '0px')
          await expect(heading).toHaveCSS('padding-bottom', '0px')
        }
        for (const section of await specimen.locator('[data-ui="section"]').all()) {
          await expect(section).toHaveCSS('border-bottom-width', '0px')
          await expect(section).toHaveCSS('padding-bottom', '0px')
        }
        const nested = await specimen
          .locator(framed)
          .evaluateAll(
            (elements, selector) =>
              elements.flatMap((element) =>
                element.querySelector(selector) ? [element.textContent?.trim().slice(0, 100)] : [],
              ),
            framed,
          )
        expect(nested).toEqual([])
        await specimen.screenshot({ path: testInfo.outputPath(`${id}.png`) })
      }
      const recentOrders = page
        .locator('#record-page [data-ui="surface"]')
        .filter({ hasText: 'Recent orders' })
      await expect(recentOrders.locator('[data-ui="surface-title"]')).toHaveText('Recent orders')
      await expect(recentOrders.locator('[data-ui="table-scroll"][data-framed="false"]')).toHaveCount(1)
      const mainInformation = page
        .locator('#record-page [data-ui="surface"]')
        .filter({ hasText: 'Main information' })
      await expect(mainInformation.locator('[data-ui="surface-title"]')).toHaveText('Main information')
      await expect(mainInformation.locator('[data-ui="record-form"]')).toHaveCount(1)
      await expect(page.locator('#form-page [data-ui="form-page-body"] > [data-ui="surface"]')).toHaveCount(1)
      await expect(
        page.locator('#form-page [data-ui="form-page-body"] [data-ui="surface-title"]'),
      ).toHaveText('Main information')
      await expect(page.locator('#form-page [data-ui="form-page-body"] [data-ui="section"]')).toHaveCount(0)
      for (const id of ['list-page', 'data-table']) {
        const card = page.locator(`#${id} [data-ui="surface"][data-has-heading="true"]`).first()
        await expect(card).toHaveCSS('padding', '12px')
        await expect(card.locator('[data-ui="surface-title"]')).toHaveCSS('font-size', '18px')
        await expect(card.locator('[data-ui="table-scroll"][data-framed="false"]')).toHaveCSS(
          'background-color',
          'rgba(0, 0, 0, 0)',
        )
        const insets = await card
          .locator('[data-ui="table-scroll"][data-framed="false"]')
          .evaluate((element) => {
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
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    })
  }
