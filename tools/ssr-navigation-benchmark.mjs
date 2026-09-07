// @ts-nocheck -- Executed against built workspace output and Playwright's e2e-only installation.
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'

const builtImport = (path) => import(pathToFileURL(resolve(path)).href)
const { createTestDeployment } = await builtImport('packages/ketjs/dist/testing.js')
const { ketsuite } = await builtImport('.build/apps/ketsuite/deployment.js')
const { SSR_NAVIGATION_PARTNER_COUNTS, seedSsrNavigationFixture } = await builtImport(
  '.build/bench/ssr-navigation-fixture.js',
)

const require = createRequire(resolve('e2e/package.json'))
const { chromium } = require('playwright')
const sizes = process.env.SSR_NAV_SIZES
  ? SSR_NAVIGATION_PARTNER_COUNTS.filter((size) =>
      process.env.SSR_NAV_SIZES.split(',').includes(String(size)),
    )
  : SSR_NAVIGATION_PARTNER_COUNTS
const samples = Math.max(1, Number(process.env.SSR_NAV_SAMPLES ?? 10))
const artifactRoot = resolve(process.env.SSR_NAV_ARTIFACT_DIR ?? '.artifacts/ssr-navigation')
const runDir = join(artifactRoot, `run-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`)
await mkdir(join(runDir, 'browser-evidence'), { recursive: true })

const percentile = (values, ratio) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * ratio) - 1]
const summary = (values) => ({
  n: values.length,
  medianMs: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95),
  minMs: Math.min(...values),
  maxMs: Math.max(...values),
})
const raw = []
const seeds = []
const browser = await chromium.launch({ headless: true })
try {
  for (const size of sizes) {
    const deployment = await createTestDeployment(ketsuite, { worker: false })
    try {
      seeds.push(await seedSsrNavigationFixture(deployment, size))
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
      await context.request.post(`${deployment.baseUrl}/login`, {
        form: { login: 'bench-admin', password: 'navigation-local-only' },
      })
      const page = await context.newPage()
      await page.addInitScript(() => {
        globalThis.__ketNavigationErrors = []
        document.addEventListener('ket:navigation-error', (event) => {
          globalThis.__ketNavigationErrors.push(event.detail?.error ?? 'unknown navigation error')
          console.warn(`KET_NAVIGATION_ERROR: ${event.detail?.error ?? 'unknown navigation error'}`)
        })
      })
      const reportedNavigationErrors = []
      page.on('console', (message) => {
        if (message.text().startsWith('KET_NAVIGATION_ERROR: '))
          reportedNavigationErrors.push(message.text().slice('KET_NAVIGATION_ERROR: '.length))
      })
      for (const mode of ['document', 'fragment']) {
        for (let sample = 0; sample < samples; sample++) {
          await page.goto(`${deployment.baseUrl}/admin/partner/partners`, { waitUntil: 'load' })
          await page.evaluate(() => {
            globalThis.__ketBenchmarkRealm = globalThis.__ketBenchmarkRealm ?? crypto.randomUUID()
          })
          const realmBefore = await page.evaluate(() => globalThis.__ketBenchmarkRealm)
          const requests = []
          reportedNavigationErrors.length = 0
          const onRequest = (request) => requests.push({ url: request.url(), type: request.resourceType() })
          page.on('request', onRequest)
          const started = performance.now()
          if (mode === 'document') {
            await page.goto(`${deployment.baseUrl}/admin/partner/partners?role=customer`, {
              waitUntil: 'load',
            })
          } else {
            await page.locator('a[data-ui="tab"][href="/admin/partner/partners?role=customer"]').click()
            await page.waitForFunction(() => location.search === '?role=customer')
            await page.locator('[data-ui="row"]').first().waitFor()
          }
          const durationMs = performance.now() - started
          page.off('request', onRequest)
          const state = await page.evaluate(() => ({
            realm: globalThis.__ketBenchmarkRealm ?? null,
            rows: document.querySelectorAll('[data-ui="row"]').length,
            slots: document.querySelectorAll('[data-ket-slot]').length,
            navigationErrors: globalThis.__ketNavigationErrors ?? [],
          }))
          raw.push({
            size,
            mode,
            sample,
            durationMs,
            documentRequests: requests.filter(({ type }) => type === 'document').length,
            requestCount: requests.length,
            requests,
            realmPreserved: state.realm === realmBefore,
            rows: state.rows,
            slots: state.slots,
            navigationErrors: [...reportedNavigationErrors, ...state.navigationErrors],
          })
        }
      }
      await page.goto(`${deployment.baseUrl}/admin/partner/partners`, { waitUntil: 'load' })
      await page.locator('a[data-ui="tab"][href="/admin/partner/partners?role=customer"]').click()
      await page.waitForFunction(() => location.search === '?role=customer')
      await page.screenshot({
        path: join(runDir, 'browser-evidence', `${size}-fragment-customer.png`),
        fullPage: true,
      })
      await context.close()
    } finally {
      await deployment.close()
    }
  }
} finally {
  await browser.close()
}
const grouped = sizes.flatMap((size) =>
  ['document', 'fragment'].map((mode) => {
    const held = raw.filter((row) => row.size === size && row.mode === mode)
    return {
      size,
      mode,
      ...summary(held.map(({ durationMs }) => durationMs)),
      documentRequests: [...new Set(held.map(({ documentRequests }) => documentRequests))],
      requestCountMedian: percentile(
        held.map(({ requestCount }) => requestCount),
        0.5,
      ),
      realmPreserved: held.every(({ realmPreserved }) => realmPreserved),
      navigationErrors: [...new Set(held.flatMap(({ navigationErrors }) => navigationErrors))],
    }
  }),
)
const result = { runDir, samples, seeds, summary: grouped, raw }
await writeFile(join(runDir, 'results.json'), `${JSON.stringify(result, null, 2)}\n`)
await writeFile(join(artifactRoot, 'latest.json'), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({ runDir, summary: grouped }, null, 2))
