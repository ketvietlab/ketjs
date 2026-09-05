import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, ServeContext, Translator } from '@ketvietlab/ketjs'
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
  contentScreen,
  entryFormScreen,
  type EntryRow,
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

const entry = (over: Partial<EntryRow> = {}): EntryRow => ({
  id: 'p1',
  siteId: 'site1',
  type: 'website.page',
  slug: 'gioi-thieu',
  path: '/gioi-thieu',
  title: 'Gioi thieu',
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

test('publish screen: the schedule field the contract has always accepted is there', () => {
  assert.match(form(entry()), /name="publishAt"/u)
  assert.match(form(entry()), /publish\.atHint/u)
})

test('publish screen: a draft is offered no way down, a published page is', () => {
  assert.equal(form(entry()).includes('/unpublish'), false)
  assert.match(form(entry({ status: 'published' })), /action="\/admin\/website\/pages\/p1\/unpublish"/u)
  assert.match(form(entry({ status: 'published' })), /action\.unpublish/u)
})

test('publish screen: a scheduled page is offered a cancellation, not a takedown', () => {
  const html = form(entry({ status: 'scheduled', publishAt: '2026-10-01T09:00:00.000Z' }))
  assert.match(html, /action\.cancelSchedule/u)
  assert.equal(html.includes('action.unpublish'), false)
  // The pending time comes back into the field rather than reading as empty.
  assert.match(html, /value="2026-10-01T09:00"/u)
})

test('publish screen: the takedown says what it does not reach', () => {
  // A page frozen into the active publication is not affected, and an editor
  // pressing this should be told so rather than discovering it.
  assert.match(form(entry({ status: 'published' })), /publish\.downHint/u)
})

test('content list: search and status come back showing what was asked for', () => {
  const html = renderToString(
    contentScreen(
      translate,
      [entry()],
      [],
      'site1',
      {},
      '',
      { basePath: '/admin/website/pages', titleKey: 'pages' },
      null,
      { search: 'gioi', status: 'published' },
    ),
  )
  assert.match(html, /name="q"/u)
  assert.match(html, /value="gioi"/u)
  assert.match(html, /name="status"/u)
  // One GET form, so applying a status does not drop the site or the search.
  assert.match(html, /name="site"/u)
})

test('routes: taking a page down does not answer a GET', async () => {
  for (const key of ['/admin/website/pages/{id}/unpublish', '/admin/website/posts/{id}/unpublish']) {
    const composed = manifest.routes[key]
    assert.ok(composed, `${key} must be composed`)
    const route = composed.make({} as unknown as ServeContext)
    const result = await route(new URL(`http://moc.example${key}`), { method: 'GET', headers: {} } as never, {
      id: 'p1',
    })
    assert.equal(result.status, 405, `${key} must refuse a GET`)
  }
})
