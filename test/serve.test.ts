import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readConfig } from '../apps/ketsuite/config.ts'

/**
 * Configuration is read once into a value rather than looked up from process.env
 * wherever it is needed, so a misspelt variable shows up as a visible default
 * instead of an undefined that surfaces three layers down as something else.
 */
test('config: sensible defaults, so `npm start` works with nothing set', () => {
  const c = readConfig({})
  assert.equal(c.port, 3000)
  assert.equal(c.databaseUrl, null, 'SQLite unless told otherwise')
  assert.equal(c.migrateOnBoot, true)
  assert.equal(c.defaultLocale, 'vi')
  assert.ok(c.bootstrapApps.includes('website'))
})

test('config: every knob is settable, and DATABASE_URL is what switches the engine', () => {
  const c = readConfig({
    PORT: '8080', DATABASE_URL: 'postgres://x/y', KET_MIGRATE: '0',
    KET_APPS: 'website, product', KET_LOCALE: 'en', KET_COMPANY: 'acme',
  })
  assert.equal(c.port, 8080)
  assert.equal(c.databaseUrl, 'postgres://x/y')
  assert.equal(c.migrateOnBoot, false, 'a production deploy migrates separately')
  assert.deepEqual(c.bootstrapApps, ['website', 'product'], 'whitespace is not a module name')
  assert.equal(c.defaultLocale, 'en')
  assert.equal(c.defaultCompany, 'acme')
})
