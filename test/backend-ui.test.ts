import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString } from 'ketjs-view'
import { compose, translator } from 'ketjs'
import type { MenuNode } from 'ketjs'
import backend from 'ketsuite/backend'
import { appsScreen, pagesScreen, person, settingsScreen, emptyState, errorState, CASES, cataloguePage } from 'ketsuite/backend'
import type { AppRow, ListChrome, PageRow } from 'ketsuite/backend'

/**
 * The design team writes CSS against these attributes. Locking them here means a
 * careless rename shows up as a red test rather than as a stylesheet that quietly
 * stopped matching anything.
 *
 * Changing this list is allowed — it just has to be deliberate, and noted in
 * design/HANDOFF.md at the same time.
 */
const CONTRACT = [
  'shell', 'sidebar', 'main', 'topbar', 'title', 'content',
  'sidebar-foot', 'indicators', 'indicator', 'indicator-icon', 'indicator-count',
  'viewer', 'viewer-who', 'viewer-name', 'viewer-company', 'signout', 'signout-button',
  'sidebar-header', 'sidebar-brand', 'sidebar-brand-name', 'sidebar-brand-chevron',
  'sidebar-search', 'sidebar-search-icon', 'sidebar-search-input', 'sidebar-nav',
  'sidebar-section-label', 'sidebar-empty', 'app-list', 'app-entry', 'app-icon', 'app-monogram', 'app-name',
  'menu', 'menu-item-wrap', 'menu-item', 'menu-label', 'menu-dot',
  'menu-section', 'menu-section-title', 'menu-section-chevron', 'menu-section-text',
  'menu-section-children', 'icon', 'chrome-search-icon',
  'app-groups', 'app-group', 'group-title', 'app-grid', 'app-card', 'app-title',
  'app-summary', 'app-meta', 'app-depends', 'app-dependents', 'app-actions', 'app-action',
  'chrome-lead', 'chrome-tail', 'chrome-create',
  'chrome-search', 'chrome-search-input', 'facet', 'facet-label', 'facet-remove',
  'pager', 'pager-range', 'pager-step', 'view-switch', 'view-kind',
  'table-scroll', 'table', 'col', 'row', 'cell', 'col-actions', 'cell-actions',
  'col-config', 'col-config-open', 'col-config-menu', 'col-toggle', 'col-toggle-mark',
  'badge', 'person', 'person-name', 'avatar',
  'tokens', 'token-list', 'token', 'token-name', 'token-value',
  'empty', 'empty-message', 'empty-hint', 'error', 'error-code', 'error-message', 'error-hint',
]

const app = (over: Partial<AppRow> = {}): AppRow => ({
  name: 'website', title: 'Website', summary: 'x', category: 'Website',
  state: 'available', depends: [], dependents: [], ...over,
})
const page = (over: Partial<PageRow> = {}): PageRow => ({ id: 'p', path: '/', title: 'T', published: true, ...over })

/** A tree with every shape the shell draws: an app, a section, and a plain link. */
const node = (id: string, over: Partial<MenuNode> = {}): MenuNode =>
  ({ id, label: id, path: null, icon: null, active: false, children: [], ...over })
const MENU: MenuNode[] = [
  node('admin', { icon: 'settings', active: true, children: [
    node('admin.apps', { path: '/admin', active: true }),
    node('admin.content', { children: [node('admin.pages', { path: '/admin/pages' })] }),
  ] }),
    // An icon this build does not carry: the entry keeps its row and falls back to
  // a monogram, which is the case that has to be styled.
  node('other', { icon: 'no-such-glyph' }),
]

/** Every control at once — the contract test only sees what is rendered. */
const CHROME: ListChrome = {
  create: { label: 'Mới', path: '/admin/pages/new' },
  search: { name: 'q', value: 'x', placeholder: 'Tìm', facets: [{ label: 'Tìm: x', without: '/admin/pages' }] },
  pager: { from: 1, to: 30, total: 84, prev: null, next: '/admin/pages?page=2' },
  views: [
    { id: 'list', label: 'Danh sách', icon: 'list', path: '?view=list', active: true },
    { id: 'kanban', label: 'Thẻ', icon: 'layout-grid', path: '?view=kanban', active: false },
  ],
}

const _ = translator(compose([backend], { headless: true }), 'vi')

const everything = [
  appsScreen(_, [app({ state: 'installed', dependents: ['website_menu'] }), app({ name: 'b', depends: ['website'] })],
    { menu: MENU, viewer: { name: 'Nguyễn Quản Trị', company: 'acme', companies: ['acme', 'globex'] },
      indicators: [{ id: 'activity', icon: 'bell', label: 'Việc', count: 3, path: '/a' }] }),
  pagesScreen(_, [page(), page({ id: 'q', published: false })], { menu: MENU, chrome: CHROME },
    // With the column menu open: the hooks inside it only exist when it can be used.
    { shown: ['id'], colsHref: (keys) => `/admin/pages?cols=${keys.join(',')}` }),
  person('Nguyễn Quản Trị'),
  settingsScreen(_, { 'color-accent': 'x' }, { menu: MENU }),
  // A sidebar whose search matched nothing: the label goes, a note takes its place.
  settingsScreen(_, { 'color-accent': 'x' }, { menu: [], menuFilter: 'zzz' }),
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
  assert.match(everything, /data-tone="positive"/)
  assert.match(everything, /data-tone="neutral"/)
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
