import { defineConfig } from '@playwright/test'

const moduleName = process.env.E2E_MODULE ?? 'product_backend'

export default defineConfig({
  testDir: `./${moduleName}`,
  outputDir: './test-results',
  timeout: 120_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  webServer: {
    command: `${JSON.stringify(process.execPath)} ./${moduleName}/fixtures/server.mjs`,
    url: 'http://127.0.0.1:4173/_ket/health',
    timeout: 120_000,
    reuseExistingServer: false,
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
    headless: true,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
