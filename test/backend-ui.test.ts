import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString } from 'ketjs-view'
import { compose, translator } from 'ketjs'
import backend from 'ketsuite/backend'
import { appsScreen, pagesScreen, settingsScreen, emptyState, errorState, CASES, cataloguePage } from 'ketsuite/backend'
import type { AppRow, PageRow } from 'ketsuite/backend'

/**
 * The design team writes CSS against these attributes. Locking them here means a
 * careless rename shows up as a red test rather than as a stylesheet that quietly
 * stopped matching anything.
 *
 * Changing this list is allowed — it just has to be deliberate, and noted in
 * design/HANDOFF.md at the same time.
 */
const CONTRACT = [
  'shell', 'sidebar', 'brand', 'nav', 'nav-item', 'main', 'topbar', 'title', 'content',
  'app-groups', 'app-group', 'group-title', 'app-grid', 'app-card', 'app-title',
  'app-summary', 'app-meta', 'app-depends', 'app-dependents', 'app-actions', 'app-action',
  'table', 'row', 'cell-path', 'cell-title', 'cell-state', 'badge',
  'tokens', 'token-list', 'token', 'token-name', 'token-value',
  'empty', 'empty-message', 'empty-hint', 'error', 'error-code', 'error-message', 'error-hint',
]

const app = (over: Partial<AppRow> = {}): AppRow => ({
  name: 'website', title: 'Website', summary: 'x', category: 'Website',
  state: 'available', depends: [], dependents: [], ...over,
})
const page = (over: Partial<PageRow> = {}): PageRow => ({ id: 'p', path: '/', title: 'T', published: true, ...over })

const _ = translator(compose([backend], { headless: true }), 'vi')

const everything = [
  appsScreen(_, [app({ state: 'installed', dependents: ['website_menu'] }), app({ name: 'b', depends: ['website'] })]),
  pagesScreen(_, [page(), page({ id: 'q', published: false })]),
  settingsScreen(_, { 'color-accent': 'x' }),
  emptyState('a', 'b'),
  errorState('E_X', 'msg', 'hint'),
].map(r => renderToString(r)).join('')

test('ui contract: every documented data-ui hook is actually emitted', () => {
  const missing = CONTRACT.filter(name => !everything.includes(`data-ui="${name}"`))
  assert.deepEqual(missing, [], 'a hook the stylesheet targets went missing')
})

test('ui contract: no hook is emitted that the contract does not list', () => {
  const emitted = new Set([...everything.matchAll(/data-ui="([^"]+)"/g)].map(m => m[1] as string))
  const undocumented = [...emitted].filter(n => !CONTRACT.includes(n)).sort()
  assert.deepEqual(undocumented, [], 'a new hook needs a line in admin.css before it ships')
})

test('ui contract: the states a stylesheet branches on are present', () => {
  assert.match(everything, /data-state="installed"/)
  assert.match(everything, /data-state="available"/)
  assert.match(everything, /data-published="true"/)
  assert.match(everything, /data-published="false"/)
  assert.match(everything, /data-active="true"/)
  assert.match(everything, /data-action="install"/)
  assert.match(everything, /data-action="uninstall"/)
  assert.match(everything, /disabled="true"/, 'an app that cannot be removed shows why')
})

test('ui contract: markup carries no class attribute at all', () => {
  assert.ok(!everything.includes('class='), 'a class is a decision about looks, and that decision is the design team\'s')
})

test('catalogue: covers empty, long, blocked and error, not just the happy path', () => {
  const ids = CASES.map(c => c.id)
  for (const needed of ['apps-empty', 'apps-long', 'apps-blocked', 'pages-empty', 'pages-long', 'state-error']) {
    assert.ok(ids.includes(needed), `the catalogue must show "${needed}" — a design that skips it gets built twice`)
  }
  const html = renderToString(cataloguePage(_))
  assert.equal([...html.matchAll(/data-ui="catalogue-case"/g)].length, CASES.length)
  assert.ok(CASES.every(c => c.note.length > 10), 'every case says what it is testing')
})
