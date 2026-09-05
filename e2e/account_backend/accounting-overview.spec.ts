/**
 * The accounting overview, in a real browser.
 *
 * Three things only a browser can answer, and each is a way this screen could
 * ship broken while every server-side test stayed green: whether Chart.js
 * actually mounted onto the canvases, whether it read its colours from the
 * stylesheet rather than falling back to its own defaults, and whether the
 * layout holds at a phone width without pushing the page sideways.
 *
 * The window is fixed in the URL. The screen defaults to the month in progress,
 * so a screenshot taken today and one taken next month would otherwise be
 * pictures of different data.
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const artifacts = join(moduleDir, 'artifacts', 'accounting-overview')

/** June 2026, which the fixture fills, against a May the fixture also fills. */
const JUNE = 'dateFrom=2026-06-01&dateTo=2026-06-30'

const login = async (page: Page, lang: 'vi' | 'en' = 'vi') => {
  await page.goto(`/login?lang=${lang}`)
  await page.locator('input[name="login"]').fill('admin')
  await page.locator('input[name="password"]').fill('accounting-demo')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/admin(?:\/|\?|$)/)
}

const overview = async (page: Page, lang: 'vi' | 'en' = 'vi') => {
  await page.goto(`/admin/accounting?lang=${lang}&${JUNE}`)
  // `Framed` contributes the generic page frame and the screen nests its own
  // workspace inside it, so there are two — the same shape every record screen
  // in this module has. The outer one is the page.
  await expect(page.locator('[data-ui="record-workspace"]').first()).toBeVisible()
}

/**
 * What a canvas actually has on it.
 *
 * `ink` counts opaque pixels, which says the chart mounted. `hues` counts the
 * distinct colours among them, which says it mounted *with the palette* — the
 * distinction matters, because handing Chart.js a colour it cannot parse makes
 * it draw everything in its own default black, and a black chart has just as
 * much ink on it as a correct one.
 */
const painted = (page: Page, canvasId: string) =>
  page.evaluate((id) => {
    const canvas = document.getElementById(id) as HTMLCanvasElement | null
    if (!canvas) return { found: false, width: 0, ink: 0, hues: 0, darkest: 255 }
    const context = canvas.getContext('2d')
    const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data
    const hues = new Set<string>()
    let ink = 0
    let darkest = 255
    for (let at = 0; pixels && at < pixels.length; at += 4) {
      if (pixels[at + 3]! < 200) continue
      ink += 1
      const [r, g, b] = [pixels[at]!, pixels[at + 1]!, pixels[at + 2]!]
      hues.add(`${r >> 4}:${g >> 4}:${b >> 4}`)
      darkest = Math.min(darkest, Math.max(r, g, b))
    }
    return { found: true, width: canvas.width, ink, hues: hues.size, darkest }
  }, canvasId)

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => mkdir(artifacts, { recursive: true }))
test.beforeEach(async ({ page }) => login(page))

test('the headline figures come off the ledger, and a draft is not in them', async ({ page }) => {
  await overview(page)
  const metric = (label: string) =>
    page.locator('[data-ui="metric"]', { hasText: label }).locator('[data-ui="metric-value"]')

  // June revenue: 610 + 388 + 742 + 455 + 256 = 2.451 tỷ. The 9 tỷ draft is not
  // posted, so it is not here — the number the old card grid would have moved on.
  await expect(metric('Doanh thu thuần')).toHaveText(/2\.451\.000\.000/)
  // Less 1.320 of goods sold and 310 of expenses: 821.
  await expect(metric('Lợi nhuận trước thuế')).toHaveText(/821\.000\.000/)
  await expect(page.locator('[data-ui="metric-value"]')).toHaveCount(5)

  // Cash and bank: 600 opening plus the 880 receipt.
  await expect(metric('Tiền và tương đương tiền')).toHaveText(/1\.480\.000\.000/)
})

test('a change is coloured by whether it is good news, not by which way it went', async ({ page }) => {
  await overview(page)
  const card = (label: string) => page.locator('[data-ui="metric"]', { hasText: label })
  const revenue = card('Doanh thu thuần').locator('[data-ui="delta"]')
  const liabilities = card('Tổng nợ phải trả').locator('[data-ui="delta"]')

  // Revenue rose: up, and good.
  await expect(revenue).toHaveAttribute('data-direction', 'up')
  await expect(revenue).toHaveAttribute('data-sentiment', 'good')
  // Liabilities rose too — a June bill on top of the unpaid May one — and that is
  // the bad news the old design painted the same green as revenue rising.
  await expect(liabilities).toHaveAttribute('data-direction', 'up')
  await expect(liabilities).toHaveAttribute('data-sentiment', 'bad')

  const colours = await page.evaluate(() => {
    const read = (node: Element | null) => (node ? getComputedStyle(node).color : '')
    const cards = [...document.querySelectorAll('[data-ui="metric"]')]
    const of = (label: string) =>
      read(
        cards.find((card) => card.textContent?.includes(label))?.querySelector('[data-ui="delta"]') ?? null,
      )
    return { revenue: of('Doanh thu thuần'), liabilities: of('Tổng nợ phải trả') }
  })
  expect(colours.revenue).not.toBe(colours.liabilities)
  expect(colours.revenue).not.toBe('')
})

test('both canvases mount and take their colours from the stylesheet', async ({ page }) => {
  await overview(page)
  await expect(page.locator('#chart-overview-revenue')).toBeVisible()
  await expect(page.locator('#chart-overview-mix')).toBeVisible()

  // A canvas that never hydrated is present and blank, which is exactly what a
  // server-side assertion on the markup cannot tell apart from a working one.
  await expect
    .poll(async () => (await painted(page, 'chart-overview-revenue')).ink, { timeout: 10_000 })
    .toBeGreaterThan(500)
  await expect.poll(async () => (await painted(page, 'chart-overview-mix')).ink).toBeGreaterThan(500)

  // And it drew them in the palette. `--admin-chart-N` is declared as
  // `light-dark(...)`, which `getPropertyValue` hands back as text rather than
  // as a colour; passing that string to Chart.js drew the whole screen in its
  // default black, on a dark background, with a correctly coloured legend
  // beside it saying otherwise.
  const mix = await painted(page, 'chart-overview-mix')
  expect(mix.hues).toBeGreaterThan(1)
  expect(mix.darkest).toBeGreaterThan(40)

  // The palette is the stylesheet's. If the client had fallen back to Chart.js
  // defaults these would be its greys, not the token.
  const palette = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    return {
      first: style.getPropertyValue('--admin-chart-1').trim(),
      comparison: style.getPropertyValue('--admin-chart-comparison').trim(),
      swatch: getComputedStyle(
        document.querySelector(
          '[data-ui="chart-legend-item"][data-series="1"] [data-ui="chart-legend-swatch"]',
        )!,
      ).backgroundColor,
    }
  })
  expect(palette.first).not.toBe('')
  expect(palette.comparison).not.toBe('')
  expect(palette.swatch).not.toBe('rgba(0, 0, 0, 0)')

  // And the legend says the same thing in text, which is what a reader without
  // the bundle, a screen reader, and a printed page all get instead.
  await expect(page.locator('[data-ui="chart-legend-item"]', { hasText: 'Kỳ này' })).toBeVisible()
  await expect(page.locator('[data-ui="chart-legend-item"]', { hasText: 'Kỳ trước' })).toBeVisible()
})

test('an expense bar opens the ledger behind it, carrying the window', async ({ page }) => {
  await overview(page)
  const bar = page.locator('[data-ui="bar-chart-label"] a').first()
  await expect(bar).toBeVisible()
  await bar.click()
  await expect(page).toHaveURL(/\/admin\/accounting\/general-ledger\?/)
  await expect(page).toHaveURL(/accountId=/)
  await expect(page).toHaveURL(/dateFrom=2026-06-01/)
})

test('the period filter drives the screen from the URL', async ({ page }) => {
  await page.goto(`/admin/accounting?lang=vi&${JUNE}`)
  const from = page.locator('input[name="dateFrom"]')
  await expect(from).toHaveValue('2026-06-01')
  await from.fill('2026-05-01')
  await page.locator('input[name="dateTo"]').fill('2026-05-31')
  await page.locator('form[action^="/admin/accounting"] button[type="submit"]').click()
  await expect(page).toHaveURL(/dateFrom=2026-05-01/)
  // May's revenue, not June's — the window is the whole state this screen has.
  await expect(
    page.locator('[data-ui="metric"]', { hasText: 'Doanh thu thuần' }).locator('[data-ui="metric-value"]'),
  ).toHaveText(/1\.240\.000\.000/)
})

test('a named window travels as its name, so a bookmark stays what it says', async ({ page }) => {
  await overview(page)
  const chip = (label: string) => page.locator('[data-ui="tab"]', { hasText: label }).first()

  // Nothing is current while the URL carries typed dates: the chips name windows,
  // and a hand-typed range is not one of them.
  await expect(page.locator('[data-ui="tab"][data-active="true"]')).toHaveCount(0)

  await chip('Hôm nay').click()
  // The name is what is in the address, not the dates it happens to mean today.
  await expect(page).toHaveURL(/period=today/)
  await expect(page).not.toHaveURL(/dateFrom=/)
  await expect(chip('Hôm nay')).toHaveAttribute('data-active', 'true')
  await expect(chip('Hôm nay')).toHaveAttribute('aria-current', 'page')

  // A relative window is already exact, so it takes no date fields: a pair of
  // them under "today" only invites editing numbers the next click overwrites.
  await expect(page.locator('input[name="dateFrom"]')).toHaveCount(0)

  // Every window the screen offers is reachable and marks itself.
  for (const label of [
    'Hôm qua',
    '7 ngày qua',
    '14 ngày qua',
    '30 ngày qua',
    'Tháng này',
    'Tháng trước',
    '90 ngày qua',
  ]) {
    await chip(label).click()
    await expect(chip(label)).toHaveAttribute('data-active', 'true')
    await expect(page.locator('[data-ui="tab"][data-active="true"]')).toHaveCount(1)
  }
})

test('a year is one click, and it is the only window with dates to narrow', async ({ page }) => {
  await overview(page)
  const year = String(new Date().getUTCFullYear())
  await page.locator('[data-ui="tab"]', { hasText: year }).first().click()
  await expect(page).toHaveURL(new RegExp(`period=${year}`))
  // The year is the coarse frame, and the fields are how it is narrowed — so
  // they are here, filled with the frame they start from.
  await expect(page.locator('input[name="dateFrom"]')).toHaveValue(`${year}-01-01`)
  await expect(page.locator('input[name="dateTo"]')).toHaveValue(`${year}-12-31`)
  // 2026 covers both months the fixture posts, so it is more than either of them.
  await expect(
    page.locator('[data-ui="metric"]', { hasText: 'Doanh thu thuần' }).locator('[data-ui="metric-value"]'),
  ).toHaveText(/3\.691\.000\.000/)
})

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  for (const scheme of ['dark', 'light'] as const) {
    test(`holds its layout on ${viewport.name} in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await overview(page)
      await expect
        .poll(async () => (await painted(page, 'chart-overview-revenue')).ink, { timeout: 10_000 })
        .toBeGreaterThan(200)

      const metrics = await page.evaluate(() => {
        const canvases = [...document.querySelectorAll('canvas[data-ui="chart-canvas"]')]
        const main = document.querySelector('[data-ui="main"]')
        return {
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          mainWidth: main?.getBoundingClientRect().width ?? 0,
          canvases: canvases.map((node) => {
            const box = node.getBoundingClientRect()
            return { width: box.width, height: box.height }
          }),
          bodyBackground: getComputedStyle(document.body).backgroundColor,
          amounts: [...document.querySelectorAll('[data-ui="metric-value"]')].map((node) => ({
            text: node.textContent ?? '',
            overflow: node.scrollWidth - node.clientWidth,
          })),
        }
      })
      // A canvas sized from a stale layout is the classic way a chart pushes the
      // page sideways: it has no intrinsic size and will happily be wider than
      // the column it was put in.
      expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
      expect(metrics.canvases.length).toBe(2)
      for (const canvas of metrics.canvases) {
        expect(canvas.width).toBeGreaterThan(0)
        expect(canvas.height).toBeGreaterThan(0)
        expect(canvas.width).toBeLessThanOrEqual(metrics.mainWidth)
      }
      expect(metrics.bodyBackground).not.toBe('rgba(0, 0, 0, 0)')
      // A clipped total reads as a different number, which is the one way a
      // money card can be worse than useless. Thirteen digits and a symbol is
      // what an amount in đồng is, and two cards fit across a phone.
      for (const amount of metrics.amounts) expect(amount.overflow).toBeLessThanOrEqual(1)

      await page.screenshot({
        path: join(artifacts, `overview-${viewport.name}-${scheme}.png`),
        fullPage: true,
      })

      // And the filter with a named window current, which the shot above cannot
      // show: it arrives on typed dates, where no chip is the answer.
      await page.goto(`/admin/accounting?lang=vi&period=last30`)
      await expect(page.locator('[data-ui="tab"][data-active="true"]')).toHaveCount(1)
      const filter = page.locator('[data-ui="section"]', { hasText: 'Kỳ báo cáo' }).first()
      // Every named window is on screen, wrapped rather than scrolled past the
      // edge: a current choice the reader cannot see is one they do not have.
      const chips = await page.evaluate(() => {
        const row = document.querySelector('[data-ui="tabs"][data-wrap="true"]')
        const bounds = row?.getBoundingClientRect()
        return [...(row?.querySelectorAll('[data-ui="tab"]') ?? [])].map((tab) => {
          const box = tab.getBoundingClientRect()
          return { inside: !!bounds && box.left >= bounds.left - 1 && box.right <= bounds.right + 1 }
        })
      })
      expect(chips.length).toBe(8)
      expect(chips.every((chip) => chip.inside)).toBeTruthy()
      await expect(page.locator('input[name="dateFrom"]')).toHaveCount(0)
      await filter.screenshot({ path: join(artifacts, `period-${viewport.name}-${scheme}.png`) })

      // And with a year current, where the date fields do belong.
      await page.goto(`/admin/accounting?lang=vi&period=${new Date().getUTCFullYear()}`)
      await expect(page.locator('input[name="dateFrom"]')).toHaveCount(1)
      await filter.screenshot({ path: join(artifacts, `period-year-${viewport.name}-${scheme}.png`) })
    })
  }
}

test('renders in English without falling back to Vietnamese or to the login screen', async ({ page }) => {
  await overview(page, 'en')
  await expect(page.locator('form[action="/login"]')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Accounting overview' })).toBeVisible()
  await expect(page.locator('[data-ui="metric"]', { hasText: 'Net revenue' })).toBeVisible()
  await expect(page.locator('[data-ui="metric"]', { hasText: 'Total liabilities' })).toBeVisible()
  // Every visible string goes through the catalogue: an untranslated key would
  // show up here as its own name.
  await expect(page.locator('[data-ui="main"]')).not.toContainText('account_backend.')
  await page.screenshot({ path: join(artifacts, 'overview-desktop-en.png'), fullPage: true })
})
