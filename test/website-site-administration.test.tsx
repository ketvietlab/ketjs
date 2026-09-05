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
  type DomainRow,
  type IndexState,
  type MemberRow,
  type RedirectRow,
  redirectsScreen,
  searchIndexScreen,
  siteDomainsScreen,
  siteFormScreen,
  siteMembersScreen,
} from '../packages/ketsuite/src/modules/website_backend/screens/index.tsx'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

const site = { id: 'site1', name: 'moc', title: 'Moc', active: true } as never

const members = (rows: MemberRow[] = []) => renderToString(siteMembersScreen(translate, site, rows, {}))
const domains = (rows: DomainRow[] = []) => renderToString(siteDomainsScreen(translate, site, rows, {}))
const redirects = (rows: RedirectRow[] = [], siteId: string | null = 'site1') =>
  renderToString(redirectsScreen(translate, rows, [], siteId, {}))
const index = (status: Partial<IndexState> = {}, built: { written: number; done: boolean } | null = null) =>
  renderToString(
    searchIndexScreen(
      translate,
      site,
      { state: 'ready', current: true, documentCount: 12, ...status },
      {},
      { built },
    ),
  )

/**
 * Membership decided every authorization in the module and had no screen, so a
 * grant could be made by an agent and then never reviewed by anyone.
 */
test('members: an empty site says what that means rather than showing an empty table', () => {
  const html = members()
  assert.match(html, /members\.emptyHint/u)
})

test('members: each member shows the role, which is what decides what they may change', () => {
  const html = members([{ id: 'm1', siteId: 'site1', userId: 'mai', role: 'editor' }])
  assert.match(html, /mai/u)
  assert.match(html, /role\.editor/u)
  assert.match(html, /\/admin\/website\/sites\/site1\/members\/m1\/remove/u)
})

test('domains: the primary is marked, because canonical and the sitemap publish it', () => {
  const html = domains([
    { id: 'd1', siteId: 'site1', host: 'moc.test', primary: true, redirectToPrimary: false },
  ])
  assert.match(html, /moc\.test/u)
  assert.match(html, /state\.yes/u)
})

test('domains: no domain at all is stated, not left blank', () => {
  assert.match(domains(), /domains\.emptyHint/u)
})

test('redirects: without a site chosen the form is not offered', () => {
  const html = redirects([], null)
  assert.equal(html.includes('redirects.add'), false)
  assert.match(html, /content\.noSite/u)
})

test('redirects: a permanent redirect is named 301 and a temporary one 302', () => {
  const permanent = redirects([
    { id: 'r1', siteId: 'site1', fromPath: '/cu', toPath: '/moi', permanent: true, active: true },
  ])
  assert.match(permanent, /301/u)
  const temporary = redirects([
    { id: 'r2', siteId: 'site1', fromPath: '/cu', toPath: '/moi', permanent: false, active: true },
  ])
  assert.match(temporary, /302/u)
})

test('redirects: an empty list says every old path answers 404', () => {
  assert.match(redirects(), /redirects\.emptyHint/u)
})

/**
 * The index rebuilds itself when a reader notices it is behind, so this screen
 * is not a chore. It exists because "found nothing" and "not caught up yet"
 * look identical from outside and only one is a content problem.
 */
test('index: a stale index is called stale rather than shown as a number', () => {
  assert.match(index({ current: false, state: 'building' }), /index\.stale/u)
  assert.match(index({ current: true }), /index\.current/u)
})

test('index: a rebuild that did not finish says so instead of claiming it did', () => {
  assert.match(index({}, { written: 200, done: false }), /index\.rebuilding/u)
  assert.match(index({}, { written: 12, done: true }), /index\.rebuilt/u)
})

test('site form: the sub-screens appear only once the site exists', () => {
  const existing = renderToString(siteFormScreen(translate, site, [], {}))
  for (const key of ['members.title', 'domains.title', 'index.title'])
    assert.match(existing, new RegExp(key.replace('.', '\\.'), 'u'))

  // Offering to configure membership of a site that is not created yet would
  // be offering to configure a thing that does not exist.
  const fresh = renderToString(siteFormScreen(translate, {} as never, [], {}))
  assert.equal(fresh.includes('members.title'), false)
})

test('site administration: every screen has a route composed for it', () => {
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
    '/admin/website/sites/{id}/members',
    '/admin/website/sites/{id}/members/{memberId}/remove',
    '/admin/website/sites/{id}/domains',
    '/admin/website/sites/{id}/index',
    '/admin/website/redirects',
  ])
    assert.ok(manifest.routes[route], `${route} must be composed`)
  assert.equal(manifest.menus['website.redirects']?.path, '/admin/website/redirects')
})
