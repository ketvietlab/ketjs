import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  callFn,
  compose,
  createTheme,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
  validateLayout,
  formatLayoutErrors,
  agentDescriptor,
  compositionSchema,
} from 'ketjs'
import type { Adapter, Manifest } from 'ketjs'
import { website, websiteMenu, websiteSeo, websiteSearch, paperTheme } from 'ketsuite'

/** Every request acts as some company; these tests act as one. */
const SCOPE = { company: 'c1', branches: null }

const mods = [website, websiteMenu, websiteSeo, websiteSearch, paperTheme]
const manifest = compose(mods)

async function boot(): Promise<{ db: Adapter; manifest: Manifest }> {
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, manifest)
  registerFunctions(mods)
  return { db, manifest }
}

const homeLayout = [
  {
    type: 'website.hero',
    settings: {
      heading: 'Xin chào',
      subheading: 'Trang chủ',
      ctaLabel: 'Xem thêm',
      ctaHref: '/ve-chung-toi',
    },
  },
  { type: 'website.rich_text', settings: { heading: 'Giới thiệu', body: 'Nội dung trang chủ.' } },
]

test('website: seo adds typed fields to a page it does not own', () => {
  const fields = manifest.models['website.Page']!.fields
  assert.equal(fields.title!.by, 'website')
  assert.equal(fields.metaDescription!.by, 'website_seo')
  assert.equal(fields.noindex!.optional, true, 'a field added to another module model must be optional')
})

test('website: sections from three modules land in one registry', () => {
  assert.deepEqual(Object.keys(manifest.sections).sort(), [
    'menu.primary',
    'website.hero',
    'website.rich_text',
  ])
  assert.equal(manifest.sections['menu.primary']!.by, 'website_menu')
})

test('layout: a page is validated against the sections that actually exist', () => {
  assert.equal(validateLayout(manifest, homeLayout).ok, true)

  const bad = validateLayout(manifest, [
    { type: 'website.ghost', settings: {} },
    { type: 'website.hero', settings: { subheading: 'thiếu heading' } },
    { type: 'website.rich_text', settings: { body: 'ok', colour: 'đỏ' } },
    { type: 'website.hero', settings: { heading: 42 } },
  ])
  assert.equal(bad.ok, false)
  const text = formatLayoutErrors(bad.errors)
  assert.match(text, /\[0\] website\.ghost no installed module provides this section/)
  assert.match(text, /\[1\] website\.hero\.heading is required/)
  assert.match(text, /\[2\] website\.rich_text\.colour is not a setting/)
  assert.match(text, /\[3\] website\.hero\.heading expects text, got number/)
})

test('agent: the composition schema tells an agent what a page may contain', () => {
  const cs = compositionSchema(manifest)
  assert.deepEqual(cs.sections['website.hero'], {
    by: 'website',
    title: 'Ảnh bìa lớn',
    settings: { heading: 'text', subheading: 'text?', image: 'text?', ctaLabel: 'text?', ctaHref: 'text?' },
  })
  const d = agentDescriptor(manifest)
  assert.ok(d.tools.some((t) => t.name === 'website__savePage'))
})

test('agent: savePage refuses a bad layout as data, not as an exception', async () => {
  const { db, manifest: m } = await boot()
  const r = await callFn(
    'website.savePage',
    {
      id: 'p-bad',
      path: '/x',
      title: 'X',
      layout: [{ type: 'website.nope', settings: {} }],
    },
    { adapter: db, manifest: m, scope: SCOPE },
  )
  const value = r.value as { ok: boolean; errors: Array<{ type: string }> }
  assert.equal(value.ok, false)
  assert.equal(value.errors[0]!.type, 'website.nope')
  assert.equal((await db.all('SELECT * FROM website_page', [])).length, 0, 'nothing was stored')
  await db.close()
})

test('agent: a page round-trips through save, publish and fetch', async () => {
  const { db, manifest: m } = await boot()
  const saved = await callFn(
    'website.savePage',
    { id: 'home', path: '/', title: 'Trang chủ', layout: homeLayout },
    { adapter: db, manifest: m, scope: SCOPE },
  )
  assert.deepEqual(saved.value, { ok: true, id: 'home', sections: 2 })

  assert.equal(
    (await callFn('website.getPageByPath', { path: '/' }, { adapter: db, manifest: m, scope: SCOPE })).value,
    null,
    'a new page starts unpublished',
  )

  await callFn(
    'website.publishPage',
    { id: 'home', published: true },
    { adapter: db, manifest: m, scope: SCOPE },
  )
  const page = (
    await callFn('website.getPageByPath', { path: '/' }, { adapter: db, manifest: m, scope: SCOPE })
  ).value as { title: string; layout: string }
  assert.equal(page.title, 'Trang chủ')
  await db.close()
})

test('theme: a page renders from its layout, in order, through the theme', async () => {
  const { db, manifest: m } = await boot()
  await callFn(
    'website.savePage',
    { id: 'home', path: '/', title: 'Trang chủ', layout: homeLayout },
    { adapter: db, manifest: m, scope: SCOPE },
  )

  const rt = createTheme(m, mods)
  const html = rt.renderRegion('website.page', {
    page: { id: 'home', path: '/', title: 'Trang chủ' },
    sections: homeLayout,
  })
  assert.match(html, /<h1>Xin chào<\/h1>/)
  assert.match(html, /<a class="cta" href="\/ve-chung-toi">Xem thêm<\/a>/)
  assert.match(html, /<h2>Giới thiệu<\/h2>/)
  assert.ok(html.indexOf('Xin chào') < html.indexOf('Giới thiệu'), 'order comes from the data')
  await db.close()
})

test('theme: the full page carries what seo filled into the head joint', () => {
  const rt = createTheme(manifest, mods)
  const html = rt.renderRegion('layout', {
    page: { id: 'home', path: '/', title: 'Trang chủ' },
    meta: { metaDescription: 'Mô tả trang', noindex: true, canonical: null, ogImage: null },
    sections: homeLayout,
  })
  assert.match(html, /<meta name="description" content="Mô tả trang">/)
  assert.match(html, /<meta name="robots" content="noindex">/)
  assert.ok(!html.includes('canonical'), 'an absent value contributes nothing')
})

test('theme: placing a section nobody provides fails loudly', () => {
  const rt = createTheme(manifest, mods)
  assert.throws(
    () => rt.renderRegion('website.page', { page: {}, sections: [{ type: 'ghost.section', settings: {} }] }),
    /places section "ghost.section", which no installed module provides/,
  )
})

test('theme: the search box is placed by the theme and written by a module', () => {
  const rt = createTheme(manifest, mods)
  const withSearch = rt.renderRegion('menu.primary', {
    showSearch: true,
    menu: [{ href: '/', label: 'Trang chủ' }],
  })
  assert.match(withSearch, /<ket-island data-island="website.search"/)
  assert.ok(!withSearch.includes('on:'), 'the handler never reaches the HTML')

  const without = rt.renderRegion('menu.primary', { showSearch: false, menu: [] })
  assert.ok(!without.includes('ket-island'))
})

test('menu: items are validated and ordered', async () => {
  const { db, manifest: m } = await boot()
  await callFn(
    'website_menu.addMenuItem',
    { id: 'm1', label: 'Trang chủ', href: '/', position: 1 },
    { adapter: db, manifest: m, scope: SCOPE },
  )
  await callFn(
    'website_menu.addMenuItem',
    { id: 'm2', label: 'Giới thiệu', href: '/gioi-thieu', position: 0 },
    { adapter: db, manifest: m, scope: SCOPE },
  )
  const bad = await callFn(
    'website_menu.addMenuItem',
    { id: 'm3', label: 'Sai', href: 'javascript:alert(1)' },
    { adapter: db, manifest: m, scope: SCOPE },
  )
  assert.equal((bad.value as { ok: boolean }).ok, false)

  const items = (await callFn('website_menu.listMenu', {}, { adapter: db, manifest: m, scope: SCOPE }))
    .value as Array<{ label: string }>
  assert.deepEqual(
    items.map((i) => i.label),
    ['Giới thiệu', 'Trang chủ'],
  )
  await db.close()
})
