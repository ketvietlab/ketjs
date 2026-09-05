import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, createTheme, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website, websiteMenu } from '@ketvietlab/ketsuite'

/**
 * The theme has always drawn `{% for item in menu %}`. Nothing ever put a menu
 * in scope, so every public page rendered an empty nav.
 */

const SCOPE = { company: 'acme', branches: null }
const modules = [address, partner, website, websiteMenu, paperTheme]
const manifest = compose(modules)

const boot = async (): Promise<Adapter> => {
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, manifest)
  registerFunctions(modules)
  return db
}
const call = async (db: Adapter, name: string, input: Record<string, unknown>) =>
  (await callFn(name, input, { adapter: db, manifest, scope: SCOPE })).value

const seed = async (db: Adapter, active = true) => {
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Mộc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
    active,
  })
  await call(db, 'website_menu.addMenuItem', {
    id: 'home',
    siteId: 'site1',
    label: 'Trang chủ',
    href: '/',
    position: 10,
  })
  await call(db, 'website_menu.addMenuItem', {
    id: 'stories',
    siteId: 'site1',
    label: 'Chuyện bên ấm trà',
    href: '/chuyen',
    position: 20,
  })
}

test('public menu: a visitor can read the navigation without a session', async () => {
  const db = await boot()
  await seed(db)
  const items = (await call(db, 'website_menu.publicMenu', { siteId: 'site1' })) as Array<{
    label: string
    href: string
  }>
  assert.deepEqual(
    items.map((i) => [i.label, i.href]),
    [
      ['Trang chủ', '/'],
      ['Chuyện bên ấm trà', '/chuyen'],
    ],
    'ordered by position',
  )
  assert.equal(manifest.functions['website_menu.publicMenu']?.anonymous, true)
})

test('public menu: a site that is not being served has no navigation', async () => {
  const db = await boot()
  await seed(db, false)
  assert.deepEqual(
    await call(db, 'website_menu.publicMenu', { siteId: 'site1' }),
    [],
    'the same gate the sitemap and public search apply',
  )
})

test('public menu: the theme draws what the resolver returns', () => {
  const nav = createTheme(manifest, modules, { theme: 'theme_paper' }).renderRegion('menu.primary', {
    menu: [
      { id: 'home', label: 'Trang chủ', href: '/' },
      { id: 'stories', label: 'Chuyện bên ấm trà', href: '/chuyen' },
    ],
  })
  assert.match(String(nav), /Trang chủ/)
  assert.match(String(nav), /\/chuyen/)
})

test('public menu: with nothing in scope the nav is empty rather than broken', () => {
  // This is what every public page rendered before the resolver existed.
  const nav = createTheme(manifest, modules, { theme: 'theme_paper' }).renderRegion('menu.primary', {})
  assert.match(String(nav), /<nav/, 'the nav element still renders')
  assert.ok(!/<li/.test(String(nav)), 'and it holds nothing')
})

test('public menu: the deployment names a resolver the composition provides', async () => {
  const { createKetsuiteDeployment } = await import('../packages/ketsuite/src/deployment.ts')
  const deployment = createKetsuiteDeployment()
  const pages = (deployment as { serve?: { pages?: { menuResolve?: string } } }).serve?.pages
  assert.equal(pages?.menuResolve, 'website_menu.publicMenu')
})
