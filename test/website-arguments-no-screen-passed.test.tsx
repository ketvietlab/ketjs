import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import backend from '@ketvietlab/ketsuite/backend'
import {
  address,
  company,
  paperTheme,
  partner,
  storage,
  website,
  websiteBackend,
  websiteForm,
  websiteMenu,
  websiteSeo,
} from '@ketvietlab/ketsuite'
import {
  type EntryRow,
  previewScreen,
  type PublicationRow,
  publicationsScreen,
  submissionsScreen,
  type SubmissionRow,
} from '../packages/ketsuite/src/modules/website_backend/screens/index.tsx'

const SCOPE = { company: 'acme', branches: null }
const modules = [
  address,
  partner,
  company,
  storage,
  backend,
  website,
  websiteMenu,
  websiteSeo,
  websiteForm,
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

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

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

const publication = (over: Partial<PublicationRow> = {}): PublicationRow => ({
  id: 'pub1',
  siteId: 'site1',
  state: 'prepared',
  entryCount: 1,
  contentHash: 'abc',
  preparedAt: '2026-09-05T00:00:00.000Z',
  ...over,
})

test('publications screen: activation carries what the site actually has live', () => {
  const html = renderToString(
    publicationsScreen(translate, [publication()], [], [], 'site1', {}, { activeId: 'pubLive' }),
  )
  assert.match(html, /name="expectedPublicationId" value="pubLive"/u)
})

test('publications screen: the guard survives a filter that hides the live row', () => {
  // Filtered to `prepared`, the live row is not in `rows` - reading the base
  // off the list would claim the site had nothing live and refuse every
  // activation.
  const html = renderToString(
    publicationsScreen(
      translate,
      [publication()],
      [],
      [],
      'site1',
      {},
      { state: 'prepared', activeId: 'pubLive' },
    ),
  )
  assert.match(html, /name="expectedPublicationId" value="pubLive"/u)
  assert.match(html, /name="state"/u)
})

test('publications screen: with nothing live the claim is empty, not absent', () => {
  const html = renderToString(
    publicationsScreen(translate, [publication()], [], [], 'site1', {}, { activeId: null }),
  )
  assert.match(html, /name="expectedPublicationId" value=""/u)
})

const entry: EntryRow = {
  id: 'p1',
  siteId: 'site1',
  type: 'website.page',
  slug: 'a',
  path: '/a',
  title: 'A',
  status: 'draft',
}

test('preview: the screen asks before it mints, with a lifetime and a one-time choice', () => {
  const fresh = renderToString(previewScreen(translate, entry, null, {}, '/admin/website/pages'))
  assert.match(fresh, /action="\/admin\/website\/pages\/p1\/preview"/u)
  assert.match(fresh, /name="ttlSeconds"/u)
  assert.match(fresh, /name="oneTime"/u)
  // Nothing minted yet, so there is no token pretending to be one.
  assert.equal(fresh.includes('preview.token'), false)
})

test('preview: a minted link is shown beside the form that made it', () => {
  const html = renderToString(
    previewScreen(
      translate,
      entry,
      { token: 'tok', expiresAt: '2026-09-05T00:15:00.000Z' },
      {},
      '/admin/website/pages',
    ),
  )
  assert.match(html, /value="tok"/u)
  assert.match(html, /name="ttlSeconds"/u)
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

test('submissions: the status filter comes back showing what was asked for', () => {
  const rows: SubmissionRow[] = [
    {
      id: 's1',
      formId: 'f1',
      summary: {},
      consent: true,
      status: 'new',
      createdAt: '2026-09-01T00:00:00.000Z',
      held: false,
    },
  ]
  const html = renderToString(submissionsScreen(translate, rows, {}, { formId: 'f1', status: 'purged' }))
  assert.match(html, /name="status"/u)
  assert.match(html, /action="\/admin\/website\/forms\/f1\/submissions"/u)
})
