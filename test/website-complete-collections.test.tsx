import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  callFn,
  compose,
  defineFn,
  defineModule,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { Adapter, Row, ServeContext, Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import address from '../packages/ketsuite/src/modules/address/index.ts'
import partner from '../packages/ketsuite/src/modules/partner/index.ts'
import paperTheme from '../packages/ketsuite/src/themes/paper/index.ts'
import website from '../packages/ketsuite/src/modules/website/index.ts'
import { readWebsiteCollection } from '../packages/ketsuite/src/modules/website_backend/collection.ts'
import { collectionSearchFrame } from '../packages/ketsuite/src/modules/backend/collection-search.ts'
import {
  mediaScreen,
  publicationsScreen,
  redirectsScreen,
  revisionsScreen,
  taxonomyScreen,
} from '../packages/ketsuite/src/modules/website_backend/screens/index.tsx'
import type {
  EntryRow,
  MediaRow,
  PublicationRow,
  RedirectRow,
  RevisionRow,
  TaxonomyRow,
} from '../packages/ketsuite/src/modules/website_backend/screens/index.tsx'

const fixture = defineModule({
  name: 'website_collection_fixture',
  functions: {
    insert: defineFn({
      input: { model: 'text', rows: 'json' },
      effects: [
        'write:website.Site',
        'write:website.SiteMember',
        'write:website.Entry',
        'write:website.EntryRevision',
        'write:website.TaxonomyTerm',
        'write:website.MediaMetadata',
        'write:website.Redirect',
        'write:website.Publication',
      ],
      handler: async (ctx, args) => {
        for (const row of args.rows as Row[]) await ctx.db.insert(String(args.model), row)
      },
    }),
  },
})
const modules = [address, partner, website, paperTheme, fixture]
const manifest = compose(modules)
const scope = { company: 'acme', branches: null }
const translate = ((key: string) => key) as Translator
translate.locale = 'vi'
translate.has = () => true
translate.resolves = () => true

const call = async (db: Adapter, name: string, input: Record<string, unknown>, actor?: string) =>
  (await callFn(name, input, { adapter: db, manifest, scope, actor })).value
const seed = (db: Adapter, model: string, rows: Row[]) =>
  call(db, 'website_collection_fixture.insert', { model, rows })
const key = (index: number) => String(index).padStart(3, '0')
const entry: EntryRow = {
  id: 'entry',
  siteId: 'site',
  type: 'website.page',
  title: 'Home',
  slug: 'home',
  path: '/',
  status: 'draft',
}

/** Uses isolated in-memory SQLite only; no application database or server. */
test('Website metadata readers exhaust all API batches, enforce site access, then paginate the full filtered collection', async () => {
  const db = sqliteAdapter()
  await db.open()
  try {
    await migrateOne(db, manifest)
    registerFunctions(modules)
    await seed(
      db,
      'website.Site',
      ['site', 'foreign'].map((id) => ({
        id,
        name: id,
        title: id,
        defaultLocale: 'vi',
        theme: 'theme_paper',
        active: true,
      })),
    )
    await seed(db, 'website.SiteMember', [{ id: 'member', siteId: 'site', userId: 'editor', role: 'editor' }])
    await seed(db, 'website.Entry', [{ ...entry, authorId: 'author' }])
    const revisions = Array.from({ length: 205 }, (_, index) => ({
      id: `revision-${key(index)}`,
      entryId: 'entry',
      version: index + 1,
      kind: 'draft',
      title: 'Home',
      layout: [],
      fields: {},
      createdAt: '2026-09-19T00:00:00.000Z',
    }))
    const terms = Array.from({ length: 205 }, (_, index) => ({
      id: `term-${key(index)}`,
      siteId: 'site',
      taxonomy: 'website.category',
      slug: `term-${key(index)}`,
      name: 'Same name',
    }))
    const media = Array.from({ length: 205 }, (_, index) => ({
      id: `media-${key(index)}`,
      siteId: 'site',
      attachmentId: `asset-${key(index)}`,
      alt: `Image ${key(index)}`,
    }))
    const redirects = Array.from({ length: 205 }, (_, index) => ({
      id: `redirect-${key(index)}`,
      siteId: 'site',
      fromPath: `/old-${key(index)}`,
      toPath: `/new-${key(index)}`,
      permanent: true,
      active: true,
    }))
    const publications = Array.from({ length: 205 }, (_, index) => ({
      id: `publication-${key(index)}`,
      siteId: 'site',
      state: 'superseded',
      entries: [{ privateSnapshot: 'not needed by the list' }],
      entryCount: 1,
      contentHash: key(index),
      preparedAt: '2026-09-19T00:00:00.000Z',
    }))
    for (const [model, rows] of [
      ['website.EntryRevision', revisions],
      ['website.TaxonomyTerm', terms],
      ['website.MediaMetadata', media],
      ['website.Redirect', redirects],
      ['website.Publication', publications],
    ] as const)
      await seed(db, model, [...rows])
    await seed(db, 'website.Publication', [
      { ...publications[0]!, id: 'prepared', state: 'prepared' },
      { ...publications[0]!, id: 'foreign-publication', siteId: 'foreign' },
    ])
    await seed(db, 'website.Redirect', [
      { ...redirects[0]!, id: 'inactive', fromPath: '/inactive', active: false },
    ])
    const calls: Array<{ name: string; input: Record<string, unknown> }> = []
    const ctx = {
      call: async (name: string, input: Record<string, unknown>) => {
        calls.push({ name, input })
        return call(db, name, input, 'editor')
      },
    } as unknown as ServeContext
    const url = new URL(
      'https://example.test/admin/website/media?site=site&lang=vi&page=7&columns=attachment,alt',
    )
    const req = { method: 'GET', headers: {} } as never
    const cases = [
      ['website.listRevisions', { entryId: 'entry' }],
      ['website.listTaxonomyTerms', { siteId: 'site', taxonomy: 'website.category' }],
      ['website.listMedia', { siteId: 'site' }],
      ['website.listRedirects', { siteId: 'site', active: true }],
      ['website.listPublications', { siteId: 'site', state: 'superseded' }],
    ] as const
    const loaded = new Map<string, Row[]>()
    for (const [reader, filter] of cases) {
      calls.length = 0
      const result = await readWebsiteCollection<Row>(ctx, url, req, reader, filter)
      assert.equal(result.length, 205, reader)
      assert.equal(new Set(result.map((row) => row.id)).size, 205, `${reader} must not repeat tied rows`)
      assert.deepEqual(
        calls.map((item) => item.input.offset),
        [0, 100, 200],
      )
      for (const item of calls)
        for (const [name, value] of Object.entries(filter)) assert.equal(item.input[name], value)
      loaded.set(reader, result)
    }
    assert.equal('layout' in loaded.get('website.listRevisions')![0]!, false)
    assert.equal('entries' in loaded.get('website.listPublications')![0]!, false)
    assert.deepEqual(
      await call(db, 'website.listPublications', { siteId: 'foreign', limit: 100, offset: 0 }, 'editor'),
      [],
    )
    assert.deepEqual(
      await call(db, 'website.listRevisions', { entryId: 'entry', limit: 100 }, 'outsider'),
      [],
    )
    assert.equal(
      ((await call(db, 'website.listPublications', { siteId: 'site' }, 'editor')) as Row[]).length,
      50,
      'the legacy default page remains bounded',
    )
    const frame = collectionSearchFrame(url, {}, 'Media')
    const mediaHtml = renderToString(
      mediaScreen(
        translate,
        loaded.get('website.listMedia') as MediaRow[],
        [{ value: 'site', label: 'Site' }],
        'site',
        frame,
        '?lang=vi',
      ),
    )
    assert.match(mediaHtml, /181-205 \/ 205/)
    assert.match(mediaHtml, /data-row="media-204"/)
    assert.doesNotMatch(mediaHtml, /data-row="media-179"/)
    const prev = [...mediaHtml.matchAll(/href="([^"]+)"/g)]
      .map((match) => match[1]!.replaceAll('&amp;', '&'))
      .find((href) => href.includes('page=6'))
    assert.ok(prev)
    const previousQuery = new URL(prev, url).searchParams
    assert.equal(previousQuery.get('site'), 'site')
    assert.equal(previousQuery.get('lang'), 'vi')
    assert.equal(previousQuery.get('columns'), 'attachment,alt')
    const filtered = collectionSearchFrame(
      new URL('https://example.test/admin/website/media?site=site&lang=vi&q=Image%20204&page=7'),
      {},
      'Media',
    )
    assert.match(
      renderToString(
        mediaScreen(translate, loaded.get('website.listMedia') as MediaRow[], [], 'site', filtered),
      ),
      /1-1 \/ 1/,
    )
    const listFrame = (path: string) =>
      collectionSearchFrame(new URL(`https://example.test${path}?site=site&lang=vi&page=7`), {}, 'List')
    const revisionHtml = renderToString(
      revisionsScreen(
        translate,
        entry,
        loaded.get('website.listRevisions') as RevisionRow[],
        collectionSearchFrame(
          new URL(
            'https://example.test/admin/website/pages/entry/revisions?site=site&lang=vi&page=7&columns=version,kind&from=revision-000&to=revision-204',
          ),
          {},
          'Revisions',
        ),
        '?lang=vi',
        '/admin/website/pages',
        { fromVersion: 1, toVersion: 205, identified: true, changes: [] },
      ),
    )
    assert.match(revisionHtml, /181-205 \/ 205/)
    assert.match(revisionHtml, /value="revision-204"[^>]*selected/)
    assert.match(revisionHtml, /value="revision-000"[^>]*selected/)
    assert.match(revisionHtml, /name="columns"[^>]*value="version,kind"/)
    assert.match(revisionHtml, /name="lang"[^>]*value="vi"/)
    assert.doesNotMatch(revisionHtml, /data-row="revision-204"/)
    assert.match(
      renderToString(
        taxonomyScreen(
          translate,
          loaded.get('website.listTaxonomyTerms') as TaxonomyRow[],
          [],
          'site',
          listFrame('/admin/website/taxonomies'),
        ),
      ),
      /181-205 \/ 205/,
    )
    const redirectHtml = renderToString(
      redirectsScreen(
        translate,
        loaded.get('website.listRedirects') as RedirectRow[],
        [],
        'site',
        listFrame('/admin/website/redirects'),
        { editing: redirects[0], values: { toPath: '/kept-draft' }, errors: ['Refused'] },
      ),
    )
    assert.match(redirectHtml, /181-205 \/ 205/)
    assert.match(redirectHtml, /value="\/kept-draft"/)
    assert.match(redirectHtml, /Refused/)
    assert.match(
      renderToString(
        publicationsScreen(
          translate,
          loaded.get('website.listPublications') as PublicationRow[],
          [],
          [],
          'site',
          listFrame('/admin/website/publications'),
          { state: 'superseded', activeId: 'live-elsewhere' },
        ),
      ),
      /181-205 \/ 205/,
    )
  } finally {
    await db.close()
  }
})

for (const [path, reader, filter] of [
  ['/admin/website/pages/{id}/revisions', 'website.listRevisions', { entryId: 'entry' }],
  ['/admin/website/content/{id}/revisions', 'website.listRevisions', { entryId: 'entry' }],
  ['/admin/website/taxonomies', 'website.listTaxonomyTerms', { siteId: 'site' }],
  ['/admin/website/media', 'website.listMedia', { siteId: 'site' }],
  ['/admin/website/redirects', 'website.listRedirects', { siteId: 'site', active: true }],
  ['/admin/website/publications', 'website.listPublications', { siteId: 'site', state: 'active' }],
] as const) {
  test(`${path} reads beyond the old cap with the same request and domain filter`, async () => {
    const { routes } = await import('../packages/ketsuite/src/modules/website_backend/routes.ts')
    const stop = new Error('Observed the third metadata batch')
    const url = new URL(
      `https://example.test${path.replace('{id}', 'entry')}?site=site&state=active&q=needle&page=7&lang=vi`,
    )
    const req = { method: 'GET', headers: {} } as Parameters<import('@ketvietlab/ketjs').Route>[1]
    const calls: Array<Record<string, unknown>> = []
    const ctx = {
      localeOf: () => 'vi',
      translate: () => translate,
      call: async (name: string, input: Record<string, unknown>, calledUrl: URL, calledReq: unknown) => {
        if (name === 'website.listSites') return [{ id: 'site', name: 'Site', title: 'Site', active: true }]
        if (name === 'website.getEntry') return { entry }
        if (name === reader) {
          assert.equal(calledUrl, url)
          assert.equal(calledReq, req)
          calls.push(input)
          if (Number(input.offset) >= 200) throw stop
          return Array.from({ length: Number(input.limit) }, (_, index) => ({
            id: `${input.offset}-${index}`,
          }))
        }
        return []
      },
    } as unknown as ServeContext
    const route = (routes[path] as (ctx: ServeContext) => import('@ketvietlab/ketjs').Route)(ctx)
    await assert.rejects(
      async () => await route(url, req, { id: 'entry' }),
      (error: unknown) => error === stop,
    )
    assert.deepEqual(
      calls.map((call) => call.offset),
      [0, 100, 200],
    )
    for (const call of calls) assert.deepEqual(call, { ...filter, limit: 100, offset: call.offset })
  })
}
