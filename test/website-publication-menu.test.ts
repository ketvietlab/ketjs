import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website, websiteMenu } from '@ketvietlab/ketsuite'

/**
 * A menu change used to reach visitors on its own schedule: a link could appear
 * before the page it points at, or a page arrive with no way to reach it. The
 * navigation now goes out with the pages it belongs to.
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

const layout = [{ type: 'website.rich_text', settings: { heading: 'H', body: 'B' } }]
type Item = { id: string; label: string; href: string }

const seed = async (db: Adapter) => {
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Mộc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
  await call(db, 'website.saveEntry', {
    id: 'story',
    siteId: 'site1',
    type: 'website.page',
    slug: 'chuyen',
    path: '/chuyen',
    title: 'Chuyện',
    layout,
  })
  await call(db, 'website_menu.addMenuItem', {
    id: 'home',
    siteId: 'site1',
    label: 'Trang chủ',
    href: '/',
    position: 10,
  })
}

const publish = async (db: Adapter, id: string, entryIds: string[]) => {
  const snapshot = (await call(db, 'website_menu.snapshotMenu', { siteId: 'site1' })) as {
    items: unknown[]
  }
  await call(db, 'website.preparePublication', {
    id,
    siteId: 'site1',
    entryIds,
    attachments: { website_menu: snapshot },
  })
  return call(db, 'website.activatePublication', { id })
}

const publicMenu = async (db: Adapter) =>
  (await call(db, 'website_menu.publicMenu', { siteId: 'site1' })) as Item[]

test('publication menu: a site that never published reads live rows', async () => {
  const db = await boot()
  await seed(db)
  assert.deepEqual(
    (await publicMenu(db)).map((i) => i.label),
    ['Trang chủ'],
  )
})

test('publication menu: an edit after publishing does not reach visitors on its own', async () => {
  const db = await boot()
  await seed(db)
  await publish(db, 'pub1', ['story'])

  // The editor adds a link to a page that is not published yet. Before, this
  // went live immediately and pointed at a 404.
  await call(db, 'website_menu.addMenuItem', {
    id: 'draft-link',
    siteId: 'site1',
    label: 'Sắp ra mắt',
    href: '/sap-ra-mat',
    position: 20,
  })

  assert.deepEqual(
    (await publicMenu(db)).map((i) => i.label),
    ['Trang chủ'],
    'the visitor still reads the navigation that went out with the pages',
  )
  // The editor's own view is unchanged: they see what they just saved.
  const editing = (await call(db, 'website_menu.listMenu', { siteId: 'site1' })) as Item[]
  assert.equal(editing.length, 2)
})

test('publication menu: the next publication carries the edit out with its pages', async () => {
  const db = await boot()
  await seed(db)
  await publish(db, 'pub1', ['story'])
  await call(db, 'website_menu.addMenuItem', {
    id: 'stories',
    siteId: 'site1',
    label: 'Chuyện',
    href: '/chuyen',
    position: 20,
  })
  await publish(db, 'pub2', ['story'])

  assert.deepEqual(
    (await publicMenu(db)).map((i) => i.label),
    ['Trang chủ', 'Chuyện'],
    'link and page arrive together',
  )
})

test('publication menu: the same pages with a different menu is a different publication', async () => {
  const db = await boot()
  await seed(db)
  const snapshot = (await call(db, 'website_menu.snapshotMenu', { siteId: 'site1' })) as {
    items: unknown[]
  }
  const first = (await call(db, 'website.preparePublication', {
    id: 'pub1',
    siteId: 'site1',
    entryIds: ['story'],
    attachments: { website_menu: snapshot },
  })) as { contentHash?: string }

  await call(db, 'website_menu.addMenuItem', {
    id: 'extra',
    siteId: 'site1',
    label: 'Thêm',
    href: '/them',
    position: 30,
  })
  const changed = (await call(db, 'website_menu.snapshotMenu', { siteId: 'site1' })) as {
    items: unknown[]
  }
  const clash = (await call(db, 'website.preparePublication', {
    id: 'pub1',
    siteId: 'site1',
    entryIds: ['story'],
    attachments: { website_menu: changed },
  })) as { ok?: boolean; errors?: Array<{ message: string }> }

  assert.equal(clash.ok, false)
  assert.equal(clash.errors?.[0]?.message, 'website.error.publicationConflict')
  assert.ok(first.contentHash)
})

test('publication menu: what is active is readable without a session', async () => {
  const db = await boot()
  await seed(db)
  await publish(db, 'pub1', ['story'])
  const active = (await call(db, 'website.activePublication', { siteId: 'site1' })) as {
    id: string
    attachments: { website_menu?: { items: Item[] } }
  }
  assert.equal(active.id, 'pub1')
  assert.deepEqual(
    active.attachments.website_menu?.items.map((i) => i.label),
    ['Trang chủ'],
  )
  assert.equal(manifest.functions['website.activePublication']?.anonymous, true)
})

test('publication menu: a site being prepared has no active publication to read', async () => {
  const db = await boot()
  await seed(db)
  await publish(db, 'pub1', ['story'])
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Mộc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
    active: false,
  })
  assert.equal(await call(db, 'website.activePublication', { siteId: 'site1' }), null)
  assert.deepEqual(await publicMenu(db), [], 'and no navigation either')
})
