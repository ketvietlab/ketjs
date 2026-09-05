import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { address, company, paperTheme, partner, storage, website } from '@ketvietlab/ketsuite'
import { mediaFieldsOf, mediaIdsIn } from '../packages/ketsuite/src/modules/website/media-usage.ts'
import {
  mediaFormScreen,
  type MediaUsage,
} from '../packages/ketsuite/src/modules/website_backend/screens/index.tsx'

/**
 * `deleteMediaMetadata` removed a row with no question asked, so an image could
 * be deleted out from under every page placing it and those pages went on
 * naming an id that no longer resolved. `deleteTerm` has refused a term in use
 * since it was written; this is the same guard for the other library.
 */

const SCOPE = { company: 'acme', branches: null }
const modules = [address, partner, company, storage, website, paperTheme]
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

const seed = async (db: Adapter) => {
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Moc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
    active: true,
  })
  await call(db, 'website.saveMediaMetadata', {
    id: 'm1',
    siteId: 'site1',
    attachmentId: 'att1',
    alt: 'Anh bia',
  })
}

const withHero = (image: string) => [{ type: 'website.hero', settings: { heading: 'Xin chao', image } }]

test('media: a section says which of its settings names an image', () => {
  // Declared, not guessed: a theme that never says so is never scanned.
  assert.deepEqual(mediaFieldsOf(manifest).get('website.hero'), ['image'])
  assert.equal(mediaFieldsOf(manifest).has('website.rich_text'), false)
  assert.deepEqual([...mediaIdsIn(manifest, withHero('m1'))], ['m1'])
})

test('media: a reference nested inside a slot still counts', () => {
  const nested = [
    {
      type: 'website.columns',
      settings: {},
      slots: { left: withHero('m1'), right: [] },
    },
  ]
  assert.deepEqual([...mediaIdsIn(manifest, nested)], ['m1'])
})

test('media: an image nothing places can be deleted', async () => {
  const db = await boot()
  await seed(db)
  const usage = (await call(db, 'website.mediaUsage', { id: 'm1' })) as MediaUsage
  assert.equal(usage.used, false)
  assert.equal(usage.capped, false)
  assert.equal(((await call(db, 'website.deleteMediaMetadata', { id: 'm1' })) as { ok?: boolean }).ok, true)
})

test('media: an image a draft places cannot vanish from under it', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.saveEntry', {
    id: 'p1',
    siteId: 'site1',
    type: 'website.page',
    slug: 'trang',
    path: '/trang',
    title: 'Trang',
    layout: withHero('m1'),
  })

  const usage = (await call(db, 'website.mediaUsage', { id: 'm1' })) as MediaUsage
  assert.equal(usage.used, true)
  assert.deepEqual(
    usage.uses.map((use) => use.path),
    ['/trang'],
  )
  // A draft counts as much as a published page: taking the image away breaks
  // what an editor is working on just as surely.
  assert.equal(usage.uses[0]?.published, false)

  const refused = (await call(db, 'website.deleteMediaMetadata', { id: 'm1' })) as {
    ok?: boolean
    errors?: Array<{ message?: string }>
  }
  assert.equal(refused.ok, false)
  assert.equal(refused.errors?.[0]?.message, 'website.error.mediaInUse')
})

test('media: taking it off the page frees it again', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.saveEntry', {
    id: 'p1',
    siteId: 'site1',
    type: 'website.page',
    slug: 'trang',
    path: '/trang',
    title: 'Trang',
    layout: withHero('m1'),
  })
  const entry = (await call(db, 'website.getEntry', { id: 'p1' })) as {
    revision?: { id: string } | null
  }
  await call(db, 'website.saveEntry', {
    id: 'p1',
    siteId: 'site1',
    type: 'website.page',
    slug: 'trang',
    path: '/trang',
    title: 'Trang',
    layout: [{ type: 'website.rich_text', settings: { body: 'khong con anh' } }],
    expectedRevisionId: entry.revision?.id,
  })
  assert.equal(((await call(db, 'website.deleteMediaMetadata', { id: 'm1' })) as { ok?: boolean }).ok, true)
})

test('media screen: the pages that draw it are named, or the refusal is', () => {
  const used: MediaUsage = {
    used: true,
    capped: false,
    uses: [{ entryId: 'p1', path: '/trang', title: 'Trang', published: true }],
  }
  const html = renderToString(
    mediaFormScreen(translate, { id: 'm1', siteId: 'site1', attachmentId: 'att1' }, {}, { usage: used }),
  )
  assert.match(html, /\/admin\/website\/pages\/p1/u)
  assert.match(html, /\/trang/u)

  const unknown = renderToString(
    mediaFormScreen(
      translate,
      { id: 'm1', siteId: 'site1', attachmentId: 'att1' },
      {},
      { usage: { used: false, capped: true, uses: [] } },
    ),
  )
  // A scan that did not finish must not read as "safe to delete".
  assert.match(unknown, /media\.usageUnknown/u)
  assert.equal(unknown.includes('media.usageNone'), false)
})
