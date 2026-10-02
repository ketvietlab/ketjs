import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import backend from '@ketvietlab/ketsuite/backend'
import {
  address,
  company,
  paperTheme,
  partner,
  storage,
  website,
  livedoc,
  user,
  websiteBackend,
  websiteForm,
  websiteMenu,
  websiteSearch,
  websiteSeo,
} from '@ketvietlab/ketsuite'

const SCOPE = { company: 'acme', branches: null }
const modules = [
  address,
  partner,
  company,
  storage,
  backend,
  website,
  websiteMenu,
  websiteSearch,
  websiteSeo,
  websiteForm,
  livedoc,
  user,
  websiteBackend,
  paperTheme,
]
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

const layout = [{ type: 'website.rich_text', settings: { body: 'x' } }]

const seed = async (db: Adapter) => {
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Moc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
    active: true,
  })
  for (const id of ['p1', 'p2'])
    await call(db, 'website.saveEntry', {
      id,
      siteId: 'site1',
      type: 'website.page',
      slug: id,
      path: `/${id}`,
      title: id.toUpperCase(),
      layout,
    })
}

/**
 * The CAS inside activatePublication reads the site's pointer and then matches
 * against what it just read, so it cannot notice that the list a row came from
 * is stale. `expectedPublicationId` is the guard for that, and no caller ever
 * passed it.
 */
test('activation: a set prepared against a base that has moved is refused', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.preparePublication', { id: 'pubA', siteId: 'site1', entryIds: ['p1'] })
  await call(db, 'website.preparePublication', { id: 'pubB', siteId: 'site1', entryIds: ['p2'] })

  // Somebody else activates B while this screen still shows "nothing is live".
  assert.equal(((await call(db, 'website.activatePublication', { id: 'pubB' })) as { ok?: boolean }).ok, true)

  const stale = (await call(db, 'website.activatePublication', {
    id: 'pubA',
    expectedPublicationId: '',
  })) as { ok?: boolean; errors?: Array<{ message?: string }> }
  assert.equal(stale.ok, false)
  assert.equal(stale.errors?.[0]?.message, 'website.error.publicationStaleBase')

  // Without the guard the same call moves the site off B and discards it.
  assert.equal(((await call(db, 'website.activatePublication', { id: 'pubA' })) as { ok?: boolean }).ok, true)
})

test('activation: the first one, against a site with nothing live, goes through', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.preparePublication', { id: 'pubA', siteId: 'site1', entryIds: ['p1'] })
  // The screen sends an empty string for "there was nothing live", which is a
  // different claim from omitting the argument.
  const first = (await call(db, 'website.activatePublication', {
    id: 'pubA',
    expectedPublicationId: '',
  })) as { ok?: boolean }
  assert.equal(first.ok, true)
})

test('preview: the token honours the lifetime the contract has always accepted', async () => {
  const db = await boot()
  await seed(db)
  const short = (await call(db, 'website.createPreviewToken', {
    entryId: 'p1',
    ttlSeconds: 300,
  })) as { expiresAt: string }
  const long = (await call(db, 'website.createPreviewToken', {
    entryId: 'p1',
    ttlSeconds: 3600,
  })) as { expiresAt: string }
  assert.ok(new Date(long.expiresAt) > new Date(short.expiresAt))
})

test('preview: a one-time link is used up by the first reader', async () => {
  const db = await boot()
  await seed(db)
  const once = (await call(db, 'website.createPreviewToken', {
    entryId: 'p1',
    oneTime: true,
  })) as { token: string }
  assert.ok(await call(db, 'website.previewEntry', { token: once.token }))
  assert.equal(await call(db, 'website.previewEntry', { token: once.token }), null)
})
