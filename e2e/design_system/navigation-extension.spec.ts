import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark']) {
  for (const width of [390, 1440]) {
    test(`tab extension stays inside navigation / ${theme} / ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/components/navigation?theme=${theme}&density=default`)
      await page.evaluate(() => document.fonts.ready)

      const tabs = page.locator('#navigation-items [data-ui="tabs"]')
      const extension = tabs.getByRole('link', { name: 'Extension', exact: true })
      await expect(tabs).toBeVisible()
      await expect(extension).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)

      const tabBounds = await tabs.boundingBox()
      const extensionBounds = await extension.boundingBox()
      expect(extensionBounds!.x).toBeGreaterThanOrEqual(tabBounds!.x)
      expect(extensionBounds!.x + extensionBounds!.width).toBeLessThanOrEqual(
        tabBounds!.x + tabBounds!.width + 1,
      )

      await tabs.screenshot({ path: testInfo.outputPath(`tabs-${theme}-${width}.png`) })
    })
  }
}
