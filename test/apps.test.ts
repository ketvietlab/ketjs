import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  callFn,
  compose,
  createAppRegistry,
  createTheme,
  defineModule,
  migrateOne,
  registerFunctions,
  restrictManifest,
  sqliteAdapter,
  validateLayout,
} from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import {
  address,
  partner,
  website,
  websiteMenu,
  websiteSeo,
  websiteSearch,
  paperTheme,
} from '@ketvietlab/ketsuite'

/** Every request acts as some company; these tests act as one. */
const SCOPE = { company: 'c1', branches: null }

const mods = [address, partner, website, websiteMenu, websiteSeo, websiteSearch, paperTheme]
const manifest = compose(mods)

async function boot(): Promise<{ db: Adapter; apps: Awaited<ReturnType<typeof createAppRegistry>> }> {
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, manifest)
  registerFunctions(mods)
  const apps = await createAppRegistry(manifest, db)
  return { db, apps }
}

test('apps: the list shows what this deployment ships, and what is on', async () => {
  const { db, apps } = await boot()
  const list = await apps.list()
  assert.deepEqual(list.map((a) => a.name).sort(), [
    'address',
    'partner',
    'theme_paper',
    'website',
    'website_menu',
    'website_search',
    'website_seo',
  ])
  assert.ok(
    list.every((a) => a.state === 'available'),
    'nothing is installed on a fresh database',
  )
  const site = list.find((a) => a.name === 'website')!
  assert.equal(site.title, 'Website')
  assert.equal(site.category, 'Website')
  await db.close()
})

test('apps: installing pulls in what the app depends on', async () => {
  const { db, apps } = await boot()
  const changed = await apps.install('website_menu')
  assert.ok(changed.includes('website'), 'the dependency came along')
  assert.ok(changed.includes('website_menu'))
  const on = await apps.enabled()
  assert.equal(on.has('website'), true)
  await db.close()
})

test('apps: an auto-install app arrives once its dependencies are there', async () => {
  const { db, apps } = await boot()
  const changed = await apps.install('website')
  assert.ok(changed.includes('website_seo'), 'seo asked to come along and its dependency is now present')
  assert.equal((await apps.list()).find((a) => a.name === 'website_seo')!.state, 'installed')
  await db.close()
})

test('apps: removing one that others depend on is refused, by name', async () => {
  const { db, apps } = await boot()
  await apps.install('website_menu')
  await assert.rejects(
    () => apps.uninstall('website'),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_APP_IN_USE')
      assert.match((e as Error).message, /website_menu/)
      return true
    },
  )
  assert.deepEqual(await apps.uninstall('website_menu'), ['website_menu'])
  await db.close()
})

test('apps: uninstalling deletes nothing — the data is still there on re-install', async () => {
  const { db, apps } = await boot()
  await apps.install('website_menu')
  await callFn(
    'website_menu.addMenuItem',
    { id: 'm1', label: 'Trang chủ', href: '/', position: 0 },
    { adapter: db, manifest, scope: SCOPE },
  )
  assert.equal((await db.all('SELECT * FROM website_menu_menu_item', [])).length, 1)

  await apps.uninstall('website_menu')
  assert.equal(
    (await db.all('SELECT * FROM website_menu_menu_item', [])).length,
    1,
    'turning an app off must never be a way to lose rows',
  )

  await apps.install('website_menu')
  const items = (await callFn('website_menu.listMenu', {}, { adapter: db, manifest, scope: SCOPE }))
    .value as unknown[]
  assert.equal(items.length, 1, 'and the data is right where it was')
  await db.close()
})

test('apps: the schema is the same whether an app is on or off', async () => {
  const { db, apps } = await boot()
  const before = Object.keys(await db.introspect()).sort()
  await apps.install('website')
  await apps.uninstall('website_seo')
  const after = Object.keys(await db.introspect()).sort()
  assert.deepEqual(
    after,
    before,
    'installing changes behaviour, never shape — this is what keeps a fleet upgradeable',
  )
  await db.close()
})

test('restrict: a disabled app answers nothing, and says why', async () => {
  const { db, apps } = await boot()
  await apps.install('website')
  const restricted = restrictManifest(manifest, await apps.enabled())

  await assert.rejects(
    () => callFn('website_menu.listMenu', {}, { adapter: db, manifest: restricted, scope: SCOPE }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_APP_NOT_INSTALLED')
      assert.match((e as Error).message, /belongs to "website_menu", which is not installed/)
      return true
    },
  )
  assert.equal(
    (await callFn('website.listPages', {}, { adapter: db, manifest: restricted, scope: SCOPE })).ok,
    true,
  )
  await db.close()
})

test('restrict: a disabled app contributes no sections and no fills', async () => {
  const { db, apps } = await boot()
  await apps.install('website')
  await apps.install('theme_paper')
  await apps.uninstall('website_seo')
  const restricted = restrictManifest(manifest, await apps.enabled())

  assert.ok(!('menu.primary' in restricted.sections), 'website_menu is off, so its section is not placeable')
  assert.ok('website.hero' in restricted.sections)
  assert.equal(validateLayout(restricted, [{ type: 'menu.primary', settings: {} }]).ok, false)

  const rt = createTheme(restricted, mods)
  const head = rt.renderRegion('layout', {
    page: { title: 'T', path: '/' },
    meta: { metaDescription: 'mô tả' },
    sections: [],
  })
  assert.ok(!head.includes('name="description"'), 'seo is off, so its fill does not appear')
  await db.close()
})

test('restrict: models are never filtered, because rows outlive an install', async () => {
  const enabled = new Set(['website'])
  const restricted = restrictManifest(manifest, enabled)
  assert.ok('website_menu.MenuItem' in restricted.models, 'the table exists whatever the app state')
  assert.ok('metaDescription' in restricted.models['website.Page']!.fields, 'and so does every column')
  assert.deepEqual(restricted.disabledModules!.sort(), [
    'address',
    'partner',
    'theme_paper',
    'website_menu',
    'website_search',
    'website_seo',
  ])
})

test('apps: installing something this deployment does not ship says so', async () => {
  const { db, apps } = await boot()
  await assert.rejects(
    () => apps.install('accounting'),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_UNKNOWN_APP')
      assert.match((e as { hint: string }).hint, /has to be built in before it can be installed/)
      return true
    },
  )
  await db.close()
})

test('theme: a page keeps rendering when the app behind one of its sections is removed', async () => {
  const { db, apps } = await boot()
  await apps.install('website_menu')
  await apps.install('theme_paper')
  const layout = [
    { type: 'website.hero', settings: { heading: 'Xin chào' } },
    { type: 'menu.primary', settings: { showSearch: false } },
    { type: 'website.rich_text', settings: { body: 'Nội dung' } },
  ]

  const whole = createTheme(restrictManifest(manifest, await apps.enabled()), mods)
  const before = whole.renderRegion('website.page', { page: { path: '/' }, sections: layout, menu: [] })
  assert.match(before, /<nav class="primary"/)

  await apps.uninstall('website_menu')
  const after = createTheme(restrictManifest(manifest, await apps.enabled()), mods).renderRegion(
    'website.page',
    { page: { path: '/' }, sections: layout, menu: [] },
  )
  assert.ok(!after.includes('<nav class="primary"'), 'the removed app contributes nothing')
  assert.match(after, /Xin chào/)
  assert.match(after, /Nội dung/, 'and everything around it still renders')
  await db.close()
})

test('theme: a typo in a template is still a build error against the full manifest', () => {
  const bad = { ...paperTheme, templates: { ...paperTheme.templates, p: '{% island "website.ghost" %}' } }
  assert.throws(
    () =>
      createTheme(compose([address, partner, website, websiteSearch, bad as never]), [
        address,
        partner,
        website,
        websiteSearch,
        bad as never,
      ]),
    /places island "website.ghost", which no installed module provides/,
  )
})

test('edge: an explicit removal outlasts the next auto-install sweep', async () => {
  const { db, apps } = await boot()
  await apps.install('website')
  assert.equal((await apps.enabled()).has('website_seo'), true, 'it came along on its own')

  await apps.uninstall('website_seo')
  await apps.install('website_menu') // any later install runs the sweep again
  assert.equal(
    (await apps.enabled()).has('website_seo'),
    false,
    'an app the user removed must not walk back in the next time anything is installed',
  )
  await db.close()
})

test('edge: two auto-install apps depending on each other settle instead of looping', async () => {
  const a = defineModule({ name: 'aa', app: true, autoInstall: true })
  const b = defineModule({ name: 'bb', app: true, autoInstall: true, depends: ['aa'] })
  const m = compose([a, b], { headless: true })
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, m)
  const apps = await createAppRegistry(m, db)
  assert.deepEqual((await apps.install('aa')).sort(), ['aa', 'bb'])
  await db.close()
})

test('edge: a removed theme stops handing over its templates', async () => {
  const { db, apps } = await boot()
  await apps.install('website')
  await apps.install('theme_paper')
  const live = createTheme(restrictManifest(manifest, await apps.enabled()), mods)
  assert.match(
    live.renderRegion('website.page', { page: { path: '/' }, sections: [] }),
    /data-ket-section="page"/,
  )

  await apps.uninstall('theme_paper')
  const gone = createTheme(restrictManifest(manifest, await apps.enabled()), mods)
  assert.throws(() => gone.renderRegion('website.page', { page: {}, sections: [] }), /has no template/)
  await db.close()
})

test('edge: a theme is manageable like any other app', async () => {
  const { db, apps } = await boot()
  const theme = (await apps.list()).find((a) => a.name === 'theme_paper')
  assert.ok(theme, 'a theme nobody can switch on is a theme nobody can use')
  assert.equal(theme!.category, 'Giao diện')
  await db.close()
})

test('edge: a switched-off section is skipped, an unknown one is marked', async () => {
  const { db, apps } = await boot()
  await apps.install('website')
  await apps.install('theme_paper')
  const rt = createTheme(restrictManifest(manifest, await apps.enabled()), mods)
  const html = rt.renderRegion('website.page', {
    page: { path: '/' },
    sections: [
      { type: 'website.hero', settings: { heading: 'Còn đây' } },
      { type: 'menu.primary', settings: {} }, // shipped, switched off
      { type: 'accounting.invoice', settings: {} }, // never shipped at all
    ],
  })
  assert.match(html, /Còn đây/)
  assert.ok(!html.includes('<nav'), 'a switched-off app goes quietly')
  assert.match(
    html,
    /<!-- ket: unknown section "accounting.invoice" -->/,
    'but data naming something that never existed is not silently swallowed',
  )
  await db.close()
})

test('edge: a record for an app the deployment stopped shipping is reported', async () => {
  const { db, apps } = await boot()
  await apps.install('website_menu')
  const shrunk = await createAppRegistry(compose([address, partner, website, websiteSeo, paperTheme]), db)
  assert.deepEqual(await shrunk.orphans(), ['website_menu'])
  assert.ok(!(await shrunk.list()).some((a) => a.name === 'website_menu'))
  await db.close()
})

test('edge: two databases on one deployment keep their own install state', async () => {
  const a = sqliteAdapter()
  await a.open()
  await migrateOne(a, manifest)
  const b = sqliteAdapter()
  await b.open()
  await migrateOne(b, manifest)
  const ra = await createAppRegistry(manifest, a)
  const rb = await createAppRegistry(manifest, b)
  await ra.install('website_menu')
  assert.ok((await ra.enabled()).has('website_menu'))
  assert.equal((await rb.enabled()).size, 0, 'install state belongs to the database, not the deployment')
  await a.close()
  await b.close()
})

test('edge: rows of a removed app survive, and nothing can read them until it returns', async () => {
  const { db, apps } = await boot()
  await apps.install('website_menu')
  await callFn(
    'website_menu.addMenuItem',
    { id: 'm1', label: 'A', href: '/', position: 0 },
    { adapter: db, manifest, scope: SCOPE },
  )
  await apps.uninstall('website_menu')

  const restricted = restrictManifest(manifest, await apps.enabled())
  await assert.rejects(
    () => callFn('website_menu.listMenu', {}, { adapter: db, manifest: restricted, scope: SCOPE }),
    /E_APP_NOT_INSTALLED|not installed/,
  )
  assert.equal(
    (await db.all('SELECT * FROM website_menu_menu_item', [])).length,
    1,
    'the rows are simply unreachable, not gone',
  )
  await db.close()
})
