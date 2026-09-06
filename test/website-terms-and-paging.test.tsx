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
  type EntryTermRow,
  previewScreen,
  submissionsScreen,
  type SubmissionRow,
  type TaxonomyRow,
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

const entry: EntryRow = {
  id: 'p1',
  siteId: 'site1',
  type: 'website.page',
  slug: 'gioi-thieu',
  path: '/gioi-thieu',
  title: 'Gioi thieu',
  status: 'draft',
}

const seed = async (db: Adapter) => {
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Moc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
  await call(db, 'website.saveEntry', {
    id: 'p1',
    siteId: 'site1',
    type: 'website.page',
    slug: 'gioi-thieu',
    path: '/gioi-thieu',
    title: 'Gioi thieu',
    layout: [{ type: 'website.rich_text', settings: { body: 'x' } }],
  })
  await call(db, 'website.saveTerm', {
    id: 't1',
    siteId: 'site1',
    taxonomy: 'website.category',
    slug: 'tin-tuc',
    name: 'Tin tuc',
  })
}

/**
 * assignTerm shipped able to file a page under a term, with nothing that could
 * read the assignment back and nothing that could take it off - so the round
 * trip, not the assignment, is what has to hold.
 */
test('terms: a term can be assigned, listed back and taken off again', async () => {
  const db = await boot()
  await seed(db)

  assert.deepEqual(await call(db, 'website.listEntryTerms', { entryId: 'p1' }), [])

  await call(db, 'website.assignTerm', { id: 'a1', entryId: 'p1', termId: 't1' })
  const listed = (await call(db, 'website.listEntryTerms', { entryId: 'p1' })) as EntryTermRow[]
  assert.equal(listed.length, 1)
  assert.deepEqual(
    { termId: listed[0]?.termId, taxonomy: listed[0]?.taxonomy, name: listed[0]?.name },
    { termId: 't1', taxonomy: 'website.category', name: 'Tin tuc' },
  )

  await call(db, 'website.unassignTerm', { entryId: 'p1', termId: 't1' })
  assert.deepEqual(await call(db, 'website.listEntryTerms', { entryId: 'p1' }), [])
})

test('terms: the term is deletable again once nothing is filed under it', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.assignTerm', { id: 'a1', entryId: 'p1', termId: 't1' })

  // deleteTerm refuses while an assignment exists. Before unassignTerm that
  // made the term permanent, because no caller could clear the assignment.
  const blocked = (await call(db, 'website.deleteTerm', { id: 't1' })) as { ok?: boolean }
  assert.equal(blocked.ok, false)

  await call(db, 'website.unassignTerm', { entryId: 'p1', termId: 't1' })
  const freed = (await call(db, 'website.deleteTerm', { id: 't1' })) as { ok?: boolean }
  assert.equal(freed.ok, true)
})

test('terms: removing one that was never assigned is the state the caller asked for', async () => {
  const db = await boot()
  await seed(db)
  const result = (await call(db, 'website.unassignTerm', { entryId: 'p1', termId: 't1' })) as {
    ok?: boolean
  }
  assert.equal(result.ok, true)
})

const term = (over: Partial<TaxonomyRow> = {}): TaxonomyRow => ({
  id: 't1',
  siteId: 'site1',
  taxonomy: 'website.category',
  slug: 'tin-tuc',
  name: 'Tin tuc',
  ...over,
})

const form = (assigned: EntryTermRow[], available: TaxonomyRow[]) =>
  renderToString(
    entryFormScreen(
      translate,
      { entry, revision: null },
      'site1',
      { basePath: '/admin/website/pages', titleKey: 'pages' },
      {},
      { terms: { assigned, available } },
    ),
  )

test('terms: the entry form lists what is filed and offers what is not', () => {
  const html = form([], [term(), term({ id: 't2', slug: 'su-kien', name: 'Su kien' })])
  assert.match(html, /terms\.empty/u)
  assert.match(html, /action="\/admin\/website\/content\/p1\/terms"/u)
  assert.match(html, /Su kien/u)
})

test('terms: an assigned term shows a way to take it off', () => {
  const html = form(
    [{ id: 'a1', termId: 't1', taxonomy: 'website.category', slug: 'tin-tuc', name: 'Tin tuc' }],
    [term()],
  )
  assert.match(html, /action="\/admin\/website\/content\/p1\/terms\/t1\/remove"/u)
  // Nothing left to offer, so the add control is gone rather than empty.
  assert.match(html, /terms\.none/u)
  assert.equal(html.includes('action="/admin/website/content/p1/terms"'), false)
})

test('terms: a page not saved yet has no entry to file anything against', () => {
  const fresh = renderToString(
    entryFormScreen(
      translate,
      null,
      'site1',
      { basePath: '/admin/website/pages', titleKey: 'pages' },
      {},
      { terms: { assigned: [], available: [term()] } },
    ),
  )
  assert.equal(fresh.includes('terms.title'), false)
})

/**
 * Every visit to the preview screen mints another token, so the links pile up
 * and outlive the reason they were shared. revokePreviewTokens could always
 * call them back; nothing asked it to.
 */
test('preview: the screen offers to withdraw every link, on the entry’s own path', () => {
  const html = renderToString(
    previewScreen(
      translate,
      entry,
      { token: 'tok', expiresAt: '2026-09-05T00:15:00.000Z' },
      {},
      '/admin/website/posts',
    ),
  )
  assert.match(html, /action="\/admin\/website\/posts\/p1\/preview\/revoke"/u)
  assert.match(html, /action\.revokePreviews/u)
})

const rows = (count: number): EntryRow[] =>
  Array.from({ length: count }, (_, index) => ({ ...entry, id: `p${index}`, path: `/p${index}` }))

test('paging: a list longer than one page carries a pager, one that fits does not', () => {
  const paged = renderToString(
    contentScreen(
      translate,
      rows(30),
      [],
      'site1',
      {},
      '',
      { basePath: '/admin/website/pages', titleKey: 'pages' },
      { from: 1, to: 30, total: 31, prev: null, next: '/admin/website/pages?page=2' },
    ),
  )
  assert.match(paged, /data-ui="pager"/u)
  assert.match(paged, /1-30 \/ 31/u)
  assert.match(paged, /\/admin\/website\/pages\?page=2/u)

  const short = renderToString(contentScreen(translate, rows(3), [], 'site1', {}, ''))
  assert.equal(short.includes('data-ui="pager"'), false)
})

test('paging: a form’s submissions page the same way', () => {
  const submissions: SubmissionRow[] = [
    {
      id: 's1',
      formId: 'f1',
      summary: {},
      consent: true,
      status: 'received',
      createdAt: '2026-09-01T00:00:00.000Z',
      held: false,
    },
  ]
  const html = renderToString(
    submissionsScreen(
      translate,
      submissions,
      {},
      {
        formId: 'f1',
        pager: { from: 31, to: 31, total: 40, prev: '/x?page=1', next: null },
      },
    ),
  )
  assert.match(html, /31-31 \/ 40/u)
})

/**
 * Five routes change state, and a GET must not be one of the ways to reach
 * them: a link prefetcher, a link scanner or "open all in tabs" was enough to
 * activate a publication or drop a site member.
 */
const getStatus = async (key: string, params: Record<string, string>): Promise<number | undefined> => {
  const entry = manifest.routes[key]
  if (!entry) throw new Error(`${key} is not composed`)
  const route = entry.make({} as unknown as ServeContext)
  const req = { method: 'GET', headers: { host: 'moc.example' } }
  const result = await route(new URL(`http://moc.example${key}`), req as never, params)
  return result.status
}

test('routes: nothing that changes state answers a GET', async () => {
  for (const [key, params] of [
    ['/admin/website/publications/{id}/activate', { id: 'pub1' }],
    ['/admin/website/publications/{id}/rollback', { id: 'pub1' }],
    ['/admin/website/sites/{id}/members/{memberId}/remove', { id: 'site1', memberId: 'm1' }],
    ['/admin/website/pages/{id}/revisions/{revisionId}/restore', { id: 'p1', revisionId: 'r1' }],
    ['/admin/website/pages/{id}/preview/revoke', { id: 'p1' }],
    ['/admin/website/content/{id}/terms', { id: 'p1' }],
    ['/admin/website/content/{id}/terms/{termId}/remove', { id: 'p1', termId: 't1' }],
  ] as const)
    assert.equal(await getStatus(key, params), 405, `${key} must refuse a GET`)
})

test('routes: every screen in this wave has a route composed for it', () => {
  for (const route of [
    '/admin/website/content/{id}/terms',
    '/admin/website/content/{id}/terms/{termId}/remove',
    '/admin/website/pages/{id}/preview/revoke',
    '/admin/website/posts/{id}/preview/revoke',
  ])
    assert.ok(manifest.routes[route], `${route} must be composed`)
})
