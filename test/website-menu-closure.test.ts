import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website, websiteMenu, websiteSeo } from '@ketvietlab/ketsuite'

const SCOPE = { company: 'acme', branches: null }
const modules = [address, partner, website, websiteMenu, websiteSeo, paperTheme]
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

type Preflight = {
  ok: boolean
  checked: number
  dangling: Array<{ id: string; label: string; href: string }>
}

const seedSite = (db: Adapter) =>
  call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Moc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })

const page = async (db: Adapter, id: string, path: string, publish = true) => {
  await call(db, 'website.saveEntry', {
    id,
    siteId: 'site1',
    type: 'website.page',
    slug: path.slice(1) || 'trang-chu',
    path,
    title: `Trang ${id}`,
    layout: [{ type: 'website.rich_text', settings: { body: 'Noi dung' } }],
    fields: {},
  })
  if (publish) await call(db, 'website.publishEntry', { id })
}

const link = (db: Adapter, id: string, label: string, href: string, position: number) =>
  call(db, 'website_menu.addMenuItem', { id, siteId: 'site1', label, href, position })

const preflight = async (db: Adapter): Promise<Preflight> =>
  (await call(db, 'website_menu.preflightMenu', { siteId: 'site1' })) as Preflight

test('menu: a link to a published page resolves', async () => {
  const db = await boot()
  await seedSite(db)
  await page(db, 'p1', '/gioi-thieu')
  await link(db, 'm1', 'Gioi thieu', '/gioi-thieu', 1)

  const answer = await preflight(db)
  assert.equal(answer.ok, true)
  assert.equal(answer.checked, 1)
  assert.deepEqual(answer.dangling, [])
})

test('menu: a link to a page that does not exist is reported', async () => {
  const db = await boot()
  await seedSite(db)
  await link(db, 'm1', 'Bang gia', '/bang-gia', 1)

  const answer = await preflight(db)
  assert.equal(answer.ok, false)
  assert.equal(answer.dangling.length, 1)
  assert.equal(answer.dangling[0]?.href, '/bang-gia')
  // The label is what the visitor clicks, so it is what the report names.
  assert.equal(answer.dangling[0]?.label, 'Bang gia')
})

test('menu: a link to a page that exists but is not published is reported', async () => {
  const db = await boot()
  await seedSite(db)
  await page(db, 'p1', '/sap-ra-mat', false)
  await link(db, 'm1', 'Sap ra mat', '/sap-ra-mat', 1)

  // The harder one to notice: it answers for the editor, who is logged in and
  // can see the draft, and four-oh-fours for everybody else.
  const answer = await preflight(db)
  assert.equal(answer.ok, false)
  assert.deepEqual(
    answer.dangling.map((item) => item.href),
    ['/sap-ra-mat'],
  )
})

test('menu: a link to a route the deployment serves is not a dangling link', async () => {
  const db = await boot()
  await seedSite(db)
  await link(db, 'm1', 'Sitemap', '/sitemap.xml', 1)
  await link(db, 'm2', 'Robots', '/robots.txt', 2)

  // Neither is an entry, and a menu may legitimately carry both.
  const answer = await preflight(db)
  assert.equal(answer.ok, true, JSON.stringify(answer.dangling))
})

test('menu: an external link is left alone', async () => {
  const db = await boot()
  await seedSite(db)
  await link(db, 'm1', 'Facebook', 'https://facebook.example/moc', 1)

  // Whether another site answers is not a question this can ask, and
  // pretending to answer it would be worse than saying nothing.
  const answer = await preflight(db)
  assert.equal(answer.ok, true)
  assert.equal(answer.checked, 1)
})

test('menu: a trailing slash, a query and a fragment all name the same page', async () => {
  const db = await boot()
  await seedSite(db)
  await page(db, 'p1', '/lien-he')
  await link(db, 'm1', 'Lien he', '/lien-he/', 1)
  await link(db, 'm2', 'Lien he ngay', '/lien-he?nguon=menu', 2)
  await link(db, 'm3', 'Bieu mau', '/lien-he#bieu-mau', 3)

  const answer = await preflight(db)
  assert.equal(answer.ok, true, JSON.stringify(answer.dangling))
  assert.equal(answer.checked, 3)
})

test('menu: the report names every broken link, not the first one', async () => {
  const db = await boot()
  await seedSite(db)
  await page(db, 'p1', '/co-that')
  await link(db, 'm1', 'Co that', '/co-that', 1)
  await link(db, 'm2', 'Mat roi', '/mat-roi', 2)
  await link(db, 'm3', 'Cung mat', '/cung-mat', 3)

  const answer = await preflight(db)
  assert.equal(answer.checked, 3)
  assert.deepEqual(
    answer.dangling.map((item) => item.href).sort(),
    ['/cung-mat', '/mat-roi'],
    'someone fixing navigation wants the whole list, not one round trip per link',
  )
})

test('menu: a stranger gets nothing rather than a map of the site', async () => {
  const db = await boot()
  await seedSite(db)
  await link(db, 'm1', 'Mat roi', '/mat-roi', 1)

  const answer = (await callFn(
    'website_menu.preflightMenu',
    { siteId: 'site1' },
    { adapter: db, manifest, scope: SCOPE, actor: 'stranger' },
  )) as { value: Preflight }
  assert.deepEqual(answer.value.dangling, [])
  assert.equal(answer.value.checked, 0)
})
