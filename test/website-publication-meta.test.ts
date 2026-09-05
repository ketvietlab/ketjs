import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website, websiteSeo } from '@ketvietlab/ketsuite'

/**
 * A description belongs to the revision it describes. Saving a new one used to
 * rewrite what was public immediately, with no publication involved at all.
 */

const SCOPE = { company: 'acme', branches: null }
const modules = [address, partner, website, websiteSeo, paperTheme]
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

const seed = async (db: Adapter) => {
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Mộc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
  await call(db, 'website.saveEntry', {
    id: 'about',
    siteId: 'site1',
    type: 'website.page',
    slug: 'gioi-thieu',
    path: '/gioi-thieu',
    title: 'Giới thiệu',
    layout,
  })
  await call(db, 'website_seo.saveEntrySeo', {
    entryId: 'about',
    metaDescription: 'Trà và gốm thủ công.',
    canonical: '/gioi-thieu',
  })
}

const served = async (db: Adapter) =>
  (
    (await call(db, 'website.getEntryByPath', { siteId: 'site1', path: '/gioi-thieu' })) as {
      meta: Record<string, unknown>
    } | null
  )?.meta

const publish = async (db: Adapter, id: string) => {
  await call(db, 'website.preparePublication', { id, siteId: 'site1', entryIds: ['about'] })
  return call(db, 'website.activatePublication', { id })
}

test('publication meta: a site that never published reads everything live', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.publishEntry', { id: 'about' })
  assert.equal((await served(db))?.metaDescription, 'Trà và gốm thủ công.')

  await call(db, 'website_seo.saveEntrySeo', { entryId: 'about', metaDescription: 'Mô tả mới.' })
  assert.equal(
    (await served(db))?.metaDescription,
    'Mô tả mới.',
    'unchanged behaviour for a site that publishes one page at a time',
  )
})

test('publication meta: a description saved after publishing waits for the next one', async () => {
  const db = await boot()
  await seed(db)
  await publish(db, 'pub1')
  assert.equal((await served(db))?.metaDescription, 'Trà và gốm thủ công.')

  await call(db, 'website_seo.saveEntrySeo', { entryId: 'about', metaDescription: 'Mô tả mới.' })
  assert.equal(
    (await served(db))?.metaDescription,
    'Trà và gốm thủ công.',
    'a visitor still reads what went out with the page',
  )

  // The editor's own view is not frozen: they see what they saved.
  assert.equal(
    ((await call(db, 'website_seo.getEntrySeo', { entryId: 'about' })) as { metaDescription: string })
      .metaDescription,
    'Mô tả mới.',
  )

  await publish(db, 'pub2')
  assert.equal((await served(db))?.metaDescription, 'Mô tả mới.', 'and the next publication carries it')
})

test('publication meta: noindex takes effect at once, without waiting', async () => {
  const db = await boot()
  await seed(db)
  await publish(db, 'pub1')
  assert.equal((await served(db))?.noindex, undefined)

  // An instruction to stop showing a page is not a description of it. Making it
  // wait for the next publication would leave a page indexed after someone
  // asked for it to stop.
  await call(db, 'website_seo.saveEntrySeo', { entryId: 'about', noindex: true })
  assert.equal((await served(db))?.noindex, true, 'a delist does not wait')

  // And the frozen description is still the published one.
  assert.equal((await served(db))?.metaDescription, 'Trà và gốm thủ công.')
})

test('publication meta: the sitemap follows the live delist too', async () => {
  const db = await boot()
  await seed(db)
  await publish(db, 'pub1')
  assert.equal(((await call(db, 'website_seo.sitemapEntries', { siteId: 'site1' })) as unknown[]).length, 1)
  await call(db, 'website_seo.saveEntrySeo', { entryId: 'about', noindex: true })
  assert.deepEqual(
    await call(db, 'website_seo.sitemapEntries', { siteId: 'site1' }),
    [],
    'delisting is immediate everywhere, not only in the head',
  )
})

test('publication meta: a page outside the active publication reads live', async () => {
  const db = await boot()
  await seed(db)
  await publish(db, 'pub1')

  // A second page published the old way, not part of any publication.
  await call(db, 'website.saveEntry', {
    id: 'other',
    siteId: 'site1',
    type: 'website.page',
    slug: 'khac',
    path: '/khac',
    title: 'Khác',
    layout,
  })
  await call(db, 'website.publishEntry', { id: 'other' })
  await call(db, 'website_seo.saveEntrySeo', { entryId: 'other', metaDescription: 'Sống.' })

  const other = (await call(db, 'website.getEntryByPath', { siteId: 'site1', path: '/khac' })) as {
    meta: Record<string, unknown>
  }
  assert.equal(other.meta.metaDescription, 'Sống.', 'nothing froze it, so nothing holds it back')
})
