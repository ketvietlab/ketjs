import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  address,
  paperTheme,
  partner,
  website,
  websiteMenu,
  websiteSearch,
  websiteSeo,
} from '@ketvietlab/ketsuite'
import {
  entryFormScreen,
  type EntryRow,
} from '../packages/ketsuite/src/modules/website_backend/screens/index.tsx'

/**
 * Twelve places read `status === 'trash'` — the public resolver, the sitemap,
 * the menu link validator, the search index, preflight, media usage,
 * preparePublication — and nothing ever wrote it. Every consumer of the
 * concept existed; the producer did not.
 */

const SCOPE = { company: 'acme', branches: null }
const modules = [address, partner, website, websiteMenu, websiteSeo, websiteSearch, paperTheme]
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

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

const layout = [{ type: 'website.rich_text', settings: { body: 'noi dung' } }]

const seed = async (db: Adapter) => {
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Moc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
    active: true,
  })
  await call(db, 'website.saveEntry', {
    id: 'p1',
    siteId: 'site1',
    type: 'website.page',
    slug: 'nham',
    path: '/nham',
    title: 'Trang tao nham',
    layout,
  })
}

const statusOf = async (db: Adapter) =>
  ((await call(db, 'website.getEntry', { id: 'p1' })) as { entry: Record<string, unknown> }).entry

test('trash: a page goes out of the way, and the visitor path with it', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.publishEntry', { id: 'p1' })
  assert.ok(await call(db, 'website.getEntryByPath', { siteId: 'site1', path: '/nham' }))

  await call(db, 'website.trashEntry', { id: 'p1' })
  const entry = await statusOf(db)
  assert.equal(entry.status, 'trash')
  assert.equal(entry.publishedRevisionId, null)
  assert.equal(await call(db, 'website.getEntryByPath', { siteId: 'site1', path: '/nham' }), null)
})

test('trash: the list leaves it out unless it is asked for by name', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.trashEntry', { id: 'p1' })

  const listed = (await call(db, 'website.listEntries', { siteId: 'site1' })) as EntryRow[]
  assert.deepEqual(listed, [], 'a list of what there is is not a list of what was thrown away')
  const counted = (await call(db, 'website.countEntries', { siteId: 'site1' })) as { count: number }
  // The pager and the list have to agree, or the last page comes back empty.
  assert.equal(counted.count, 0)

  const binned = (await call(db, 'website.listEntries', {
    siteId: 'site1',
    status: 'trash',
  })) as EntryRow[]
  assert.deepEqual(
    binned.map((row) => row.id),
    ['p1'],
  )
})

test('trash: the sitemap, the search index and preflight all stop counting it', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.publishEntry', { id: 'p1' })
  await call(db, 'website_search.reindexSite', { siteId: 'site1', passes: 50 })
  assert.equal(
    (
      (await call(db, 'website_search.searchIndexed', { siteId: 'site1', q: 'trang' })) as {
        total: number
      }
    ).total,
    1,
  )

  await call(db, 'website.trashEntry', { id: 'p1' })
  await call(db, 'website_search.reindexSite', { siteId: 'site1', passes: 50 })
  assert.equal(
    (
      (await call(db, 'website_search.searchIndexed', { siteId: 'site1', q: 'trang' })) as {
        total: number
      }
    ).total,
    0,
  )

  const checked = (await call(db, 'website.preflightPublication', { siteId: 'site1' })) as {
    checked?: number
  }
  assert.equal(checked.checked, 0, 'preflight has always skipped a trashed page')
})

test('trash: a set naming a trashed page is refused', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.publishEntry', { id: 'p1' })
  await call(db, 'website.trashEntry', { id: 'p1' })
  const refused = (await call(db, 'website.preparePublication', {
    id: 'pub1',
    siteId: 'site1',
    entryIds: ['p1'],
  })) as { ok?: boolean }
  // preparePublication has refused this since publications existed; nothing
  // could produce the state it refuses.
  assert.equal(refused.ok, false)
})

test('trash: taking it back makes a draft, not a published page again', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.publishEntry', { id: 'p1' })
  await call(db, 'website.trashEntry', { id: 'p1' })
  await call(db, 'website.untrashEntry', { id: 'p1' })

  const entry = await statusOf(db)
  assert.equal(entry.status, 'draft')
  // What it used to say may be the reason it was thrown away.
  assert.equal(entry.publishedRevisionId, null)
  assert.equal(await call(db, 'website.getEntryByPath', { siteId: 'site1', path: '/nham' }), null)
})

test('trash: both directions are the state the caller asked for on a repeat', async () => {
  const db = await boot()
  await seed(db)
  assert.equal(((await call(db, 'website.untrashEntry', { id: 'p1' })) as { ok?: boolean }).ok, true)
  await call(db, 'website.trashEntry', { id: 'p1' })
  assert.equal(((await call(db, 'website.trashEntry', { id: 'p1' })) as { ok?: boolean }).ok, true)
})

const entry = (over: Partial<EntryRow> = {}): EntryRow => ({
  id: 'p1',
  siteId: 'site1',
  type: 'website.page',
  slug: 'nham',
  path: '/nham',
  title: 'Trang',
  status: 'draft',
  ...over,
})

const form = (row: EntryRow) =>
  renderToString(
    entryFormScreen(
      translate,
      { entry: row, revision: null },
      'site1',
      { basePath: '/admin/website/pages', titleKey: 'pages' },
      {},
    ),
  )

test('trash screen: a live page offers the bin, a binned one offers the way back', () => {
  const live = form(entry({ status: 'published' }))
  assert.match(live, /action="\/admin\/website\/pages\/p1\/trash"/u)
  assert.equal(live.includes('/untrash"'), false)

  const binned = form(entry({ status: 'trash' }))
  assert.match(binned, /action="\/admin\/website\/pages\/p1\/untrash"/u)
  // Nothing to take down and nothing to throw away twice.
  assert.equal(binned.includes('/p1/trash"'), false)
  assert.equal(binned.includes('action.unpublish'), false)
})
