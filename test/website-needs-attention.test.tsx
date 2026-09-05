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
  concernsOf,
  type SiteHealth,
  siteHealthScreen,
} from '../packages/ketsuite/src/modules/website_backend/screens/index.tsx'

/**
 * Every other Website screen is scoped to one site, because every contract
 * behind them takes a `siteId`. That makes "is anything wrong" a question you
 * can only answer by opening each site in turn and remembering.
 */

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

const healthy = (over: Partial<SiteHealth> = {}): SiteHealth => ({
  siteId: 'site1',
  title: 'Moc',
  active: true,
  primaryHost: 'moc.vn',
  domainCount: 1,
  indexState: 'ready',
  indexCurrent: true,
  preparedCount: 0,
  hasActivePublication: true,
  ...over,
})

const keys = (health: SiteHealth) => concernsOf(translate, health).map((concern) => concern.key)

test('health: a site with nothing wrong raises nothing', () => {
  assert.deepEqual(keys(healthy()), [])
})

test('health: no host at all outranks having the wrong one', () => {
  // A site nothing points at answers nowhere; that is not a canonical problem.
  assert.deepEqual(keys(healthy({ domainCount: 0, primaryHost: null })), ['noDomain'])
  assert.deepEqual(keys(healthy({ domainCount: 2, primaryHost: null })), ['noPrimary'])
})

test('health: a publication left prepared is worth saying out loud', () => {
  // preparePublication freezes a set and somebody still has to activate it;
  // one prepared last week and forgotten looks like nothing at all.
  assert.deepEqual(keys(healthy({ preparedCount: 1 })), ['prepared'])
})

test('health: an index that never existed is not an index that fell behind', () => {
  // A site nobody has searched has no index and needs none, so saying it is
  // stale would be a warning about a thing working as intended.
  assert.deepEqual(keys(healthy({ indexState: 'absent', indexCurrent: false })), [])
  assert.deepEqual(keys(healthy({ indexState: 'ready', indexCurrent: false })), ['staleIndex'])
})

test('health: several things at once come back in the order to act on them', () => {
  const bad = healthy({ domainCount: 0, primaryHost: null, active: false, preparedCount: 2 })
  assert.deepEqual(keys(bad), ['noDomain', 'suspended', 'prepared'])
})

test('health screen: only the troubled sites are listed, and the count says how many were read', () => {
  const html = renderToString(
    siteHealthScreen(
      translate,
      [healthy(), healthy({ siteId: 'site2', title: 'Hai', primaryHost: null, domainCount: 3 })],
      {},
    ),
  )
  assert.match(html, /Hai/u)
  assert.match(html, /health\.noPrimary/u)
  // A list that only ever holds problems cannot tell "nothing is wrong" from
  // "nothing was checked", so the number read is on the screen either way.
  assert.match(html, /health\.checked/u)
  assert.equal(html.includes('>Moc<'), false, 'a site with nothing wrong is not a row')
})

test('health screen: all quiet says so rather than showing an empty table', () => {
  const html = renderToString(siteHealthScreen(translate, [healthy()], {}))
  assert.match(html, /health\.allWell/u)
  assert.match(html, /health\.checked/u)
})

test('health: the screen has a route and a menu composed for it', () => {
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
  assert.ok(manifest.routes['/admin/website/health'])
  assert.equal(manifest.menus['website.health']?.path, '/admin/website/health')
})
