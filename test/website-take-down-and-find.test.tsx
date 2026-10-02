import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, ServeContext } from '@ketvietlab/ketjs'
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
  await call(db, 'website.saveEntry', {
    id: 'p1',
    siteId: 'site1',
    type: 'website.page',
    slug: 'gioi-thieu',
    path: '/gioi-thieu',
    title: 'Gioi thieu',
    layout,
  })
}

const entryOf = async (db: Adapter) =>
  ((await call(db, 'website.getEntry', { id: 'p1' })) as { entry: Record<string, unknown> }).entry

/**
 * publishEntry had no inverse. Nothing set `status` back and nothing cleared
 * `publishedRevisionId`, which is what the public resolver's per-entry
 * fallback reads - so a page published by mistake stayed readable for ever.
 */
test('unpublish: a published page comes back down, and the visitor path with it', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.publishEntry', { id: 'p1' })

  const live = await entryOf(db)
  assert.equal(live.status, 'published')
  assert.ok(live.publishedRevisionId, 'publishing sets the pointer the resolver reads')
  assert.ok(await call(db, 'website.getEntryByPath', { siteId: 'site1', path: '/gioi-thieu' }))

  await call(db, 'website.unpublishEntry', { id: 'p1' })
  const down = await entryOf(db)
  assert.equal(down.status, 'draft')
  assert.equal(down.publishedRevisionId, null)
  assert.equal(await call(db, 'website.getEntryByPath', { siteId: 'site1', path: '/gioi-thieu' }), null)
})

test('unpublish: when it was last live is kept', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.publishEntry', { id: 'p1' })
  await call(db, 'website.unpublishEntry', { id: 'p1' })
  // Clearing this would lose the record of when the page was live, to no
  // purpose: publishedRevisionId is what takes it down.
  assert.ok((await entryOf(db)).publishedAt)
})

test('unpublish: a page already down is the state the caller asked for', async () => {
  const db = await boot()
  await seed(db)
  const result = (await call(db, 'website.unpublishEntry', { id: 'p1' })) as { ok?: boolean }
  assert.equal(result.ok, true)
})

test('unpublish: it is also how a schedule is cancelled', async () => {
  const db = await boot()
  await seed(db)
  const later = new Date(Date.now() + 86_400_000).toISOString()
  const scheduled = (await call(db, 'website.publishEntry', { id: 'p1', publishAt: later })) as {
    status?: string
  }
  assert.equal(scheduled.status, 'scheduled')

  await call(db, 'website.unpublishEntry', { id: 'p1' })
  const cancelled = await entryOf(db)
  assert.equal(cancelled.status, 'draft')
  assert.equal(cancelled.scheduledRevisionId, null)
  assert.equal(cancelled.publishAt, null)

  // These three are exactly what `website.publishScheduled` re-reads before it
  // publishes, which is why the cancellation holds without anything having to
  // reach into the queue and withdraw the job.
})

test('routes: taking a page down does not answer a GET', async () => {
  const api = manifest.routes['/website/api/{operation}']
  assert.ok(api, 'the Studio API must be composed')
  const route = api.make({} as unknown as ServeContext)
  const result = await route(
    new URL('http://moc.example/website/api/website.unpublishEntry'),
    {
      method: 'GET',
      headers: {},
    } as never,
    { operation: 'website.unpublishEntry' },
  )
  assert.equal(result.status, 405, 'unpublishing must refuse a GET')
})
