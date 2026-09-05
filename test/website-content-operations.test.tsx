import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, type Translator } from '@ketvietlab/ketjs'
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
  websiteSearch,
  websiteSeo,
} from '@ketvietlab/ketsuite'
import {
  type EntryRow,
  entryFormScreen,
  type PublicationRow,
  publicationsScreen,
  revisionsScreen,
  type RevisionRow,
  type SeoValues,
} from '../packages/ketsuite/src/modules/website_backend/screens/index.tsx'

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
  status: 'published',
}

const publication = (over: Partial<PublicationRow> = {}): PublicationRow => ({
  id: 'pub1',
  siteId: 'site1',
  state: 'prepared',
  entryCount: 3,
  contentHash: 'abc',
  preparedAt: '2026-09-05T00:00:00.000Z',
  ...over,
})

const publications = (rows: PublicationRow[], siteId: string | null = 'site1', entries = [entry]) =>
  renderToString(publicationsScreen(translate, rows, entries, [], siteId, {}))

const form = (seo: SeoValues | null) =>
  renderToString(
    entryFormScreen(
      translate,
      { entry, revision: null },
      'site1',
      { basePath: '/admin/website/pages', titleKey: 'pages' },
      {},
      { seo },
    ),
  )

const revisions = (rows: RevisionRow[]) =>
  renderToString(revisionsScreen(translate, entry, rows, {}, '', '/admin/website/pages'))

/**
 * preparePublication and activatePublication are the machinery that stops a
 * menu link reaching visitors before the page it points at, and they were
 * reachable only by an agent - so the atomic path existed and a person could
 * only take the one-page-at-a-time one.
 */
test('publications: a prepared set offers activation, a live one offers rollback', () => {
  assert.match(publications([publication()]), /action\.activate/u)

  const live = publications([publication({ state: 'active' })])
  assert.match(live, /action\.rollback/u)
  assert.equal(live.includes('action.activate'), false, 'what is already live is not activated again')
})

test('publications: a superseded set offers neither', () => {
  const old = publications([publication({ state: 'superseded' })])
  assert.equal(old.includes('action.activate'), false)
  assert.equal(old.includes('action.rollback'), false)
})

test('publications: the prepare form is filled with the site’s published pages', () => {
  assert.match(publications([], 'site1'), /p1/u)
})

test('publications: with no site chosen there is nothing to prepare', () => {
  const none = publications([], null)
  assert.equal(none.includes('publications.prepare'), false)
  assert.match(none, /content\.noSite/u)
})

test('publications: an empty list says the per-page path still works', () => {
  assert.match(publications([]), /publications\.emptyHint/u)
})

/**
 * saveEntrySeo existed since the SEO module and no screen wrote to it, so the
 * four head fields could only be set by an agent.
 */
test('seo: the four head fields are on the page that owns them', () => {
  const html = form({ metaDescription: 'Mo ta', canonical: '/gioi-thieu', noindex: false })
  for (const name of ['metaDescription', 'canonical', 'ogImage', 'noindex'])
    assert.match(html, new RegExp(`name="${name}"`, 'u'))
  assert.match(html, /Mo ta/u)
})

test('seo: noindex says it does not wait for the next publication', () => {
  // The other three freeze with the revision; this one delists at once, and a
  // person deciding to delist a page should not be told to publish first.
  assert.match(form({}), /seo\.noindexHint/u)
})

test('seo: a page not saved yet has no head tags to set', () => {
  const fresh = renderToString(
    entryFormScreen(
      translate,
      null,
      'site1',
      { basePath: '/admin/website/pages', titleKey: 'pages' },
      {},
      { seo: { metaDescription: 'x' } },
    ),
  )
  assert.equal(fresh.includes('seo.title'), false)
})

test('revisions: every row offers a restore, including one that may not render', () => {
  const html = revisions([
    { id: 'r2', version: 2, kind: 'revision', createdAt: '2026-09-02T00:00:00.000Z' },
    { id: 'r1', version: 1, kind: 'revision', createdAt: '2026-09-01T00:00:00.000Z' },
  ])
  // A restore makes a draft and does not change what a visitor reads, so it is
  // offered on every row - getting old content back is how it gets repaired.
  assert.match(html, /\/admin\/website\/pages\/p1\/revisions\/r1\/restore/u)
  assert.match(html, /\/admin\/website\/pages\/p1\/revisions\/r2\/restore/u)
})

test('content operations: every screen has a route composed for it', () => {
  const manifest = compose([
    address,
    partner,
    company,
    storage,
    backend,
    website,
    websiteMenu,
    websiteSeo,
    websiteSearch,
    websiteForm,
    websiteBackend,
    paperTheme,
  ])
  for (const route of [
    '/admin/website/pages/{id}/revisions/{revisionId}/restore',
    '/admin/website/content/{id}/seo',
    '/admin/website/publications',
    '/admin/website/publications/{id}/activate',
    '/admin/website/publications/{id}/rollback',
  ])
    assert.ok(manifest.routes[route], `${route} must be composed`)
  assert.equal(manifest.menus['website.publications']?.path, '/admin/website/publications')
})
