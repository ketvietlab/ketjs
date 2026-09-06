import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bootDeployment,
  callFn,
  compose,
  defineDeployment,
  migrateOne,
  partitionTokens,
  registerFunctions,
  sqliteAdapter,
  tokensToCss,
} from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website } from '@ketvietlab/ketsuite'

/**
 * `Site.tokens` was written, returned by `resolveSite`, and dropped: the scope
 * the storefront builds is `{ id, title, theme }`. So the field existed, the
 * contract accepted it, and no page ever looked different for it.
 *
 * It is rendered now, which makes it the one place a person's typing reaches a
 * stylesheet on every page of a site — so most of this file is about that.
 */

const SCOPE = { company: 'acme', branches: null }
const modules = [address, partner, website]
const manifest = compose([...modules, paperTheme])
const memory = { KET_LOG: 'null', KET_SQLITE: ':memory:', KET_COMPANY: 'acme' }

const app = defineDeployment({
  name: 'tokens_app',
  modules,
  theme: paperTheme,
  serve: {
    pages: {
      siteResolve: 'website.resolveSite',
      resolve: 'website.getEntryByPath',
      region: 'website.page',
    },
  },
})

const boot = async (): Promise<Adapter> => {
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, manifest)
  registerFunctions(modules)
  return db
}
const call = async (db: Adapter, name: string, input: Record<string, unknown>) =>
  (await callFn(name, input, { adapter: db, manifest, scope: SCOPE })).value

const site = (over: Record<string, unknown> = {}) => ({
  id: 'site1',
  name: 'moc',
  title: 'Moc',
  defaultLocale: 'vi',
  theme: 'theme_paper',
  active: true,
  ...over,
})

test('tokens: a value that would close the rule is refused', async () => {
  const db = await boot()
  const escaped = (await call(db, 'website.saveSite', {
    ...site(),
    tokens: { 'color-brand': '#0a7 } :root { display: none' },
  })) as { ok?: boolean; errors?: Array<{ message?: string }> }
  assert.equal(escaped.ok, false)
  assert.equal(escaped.errors?.[0]?.message, 'website.error.invalidTokenValue')

  // And a name that is not a name, since it becomes a custom property.
  const named = (await call(db, 'website.saveSite', {
    ...site(),
    tokens: { 'color: red; --x': 'blue' },
  })) as { ok?: boolean }
  assert.equal(named.ok, false)
})

test('tokens: a list is not an object of names and values', async () => {
  const db = await boot()
  const result = (await call(db, 'website.saveSite', { ...site(), tokens: ['#0a7'] })) as {
    ok?: boolean
    errors?: Array<{ message?: string }>
  }
  assert.equal(result.ok, false)
  assert.equal(result.errors?.[0]?.message, 'website.error.invalidTokens')
})

test('tokens: an ordinary palette is accepted, and the resolver hands it on', async () => {
  const db = await boot()
  const palette = { 'color-brand': '#0a7', 'space-lg': '2.5rem', 'font-body': 'Inter, sans-serif' }
  const ok = (await call(db, 'website.saveSite', { ...site(), tokens: palette })) as { ok?: boolean }
  assert.equal(ok.ok, true)
  await call(db, 'website.saveDomain', { id: 'd1', siteId: 'site1', host: 'moc.test', primary: true })

  // resolveSite has always answered with these; it is the storefront that
  // dropped them, so the resolver is where the round trip has to be checked.
  const resolved = (await call(db, 'website.resolveSite', { host: 'moc.test' })) as {
    tokens?: Record<string, string>
  } | null
  assert.deepEqual(resolved?.tokens, palette)
})

test('tokens: partitionTokens keeps the good and names the bad', () => {
  const { safe, rejected } = partitionTokens({
    'color-brand': '#0a7',
    'space-lg': '2.5rem',
    bad: 'red; } :root { display:none',
    'not a name': 'red',
  })
  assert.deepEqual(safe, { 'color-brand': '#0a7', 'space-lg': '2.5rem' })
  assert.deepEqual(rejected.sort(), ['bad', 'not a name'])
})

test('tokens: the site layer sits above the theme layer', () => {
  const css = tokensToCss({ 'color-brand': '#0a7' }, 'ket.app')
  assert.match(css, /@layer ket\.reset, ket\.theme, ket\.app, ket\.user;/u)
  assert.match(css, /@layer ket\.app \{/u)
  assert.match(css, /--ket-color-brand: #0a7;/u)
})

test('tokens: the stylesheet a site serves carries its own overrides', async () => {
  const booted = await bootDeployment(app, { env: memory, port: 0 })
  try {
    const db = booted.adapter!
    registerFunctions(modules)
    const at = async (name: string, input: Record<string, unknown>) =>
      (await callFn(name, input, { adapter: db, manifest: booted.manifest, scope: SCOPE })).value

    const plain = await (await fetch(`http://127.0.0.1:${booted.port}/_ket/tokens.css`)).text()
    assert.equal(plain.includes('--ket-color-brand'), false, 'nothing is overridden yet')

    await at('website.saveSite', { ...site(), tokens: { 'color-brand': '#0a7' } })
    await at('website.saveDomain', { id: 'd1', siteId: 'site1', host: '127.0.0.1', primary: true })

    const branded = await (await fetch(`http://127.0.0.1:${booted.port}/_ket/tokens.css`)).text()
    assert.match(branded, /@layer ket\.app \{[^}]*--ket-color-brand: #0a7;/su)
    // The theme's own tokens are still there: a site overrides, it does not replace.
    assert.ok(branded.length > plain.length)
    assert.ok(plain.length === 0 || branded.startsWith(plain.slice(0, 40)))
  } finally {
    await booted.close()
  }
})
