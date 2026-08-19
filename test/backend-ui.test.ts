import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToString } from 'ketjs-view'
import { compose, translator } from 'ketjs'
import type { MenuNode } from 'ketjs'
import backend from 'ketsuite/backend'
import {
  actionGroup,
  appsScreen,
  badge,
  breadcrumbs,
  button,
  cardGrid,
  cataloguePage,
  CASES,
  contentCard,
  countBadge,
  dataTable,
  emptyState,
  errorState,
  HOOKS,
  icon,
  iconButton,
  inline,
  kanbanCard,
  kanbanGrid,
  linkButton,
  loadingState,
  metric,
  mediaPanel,
  notice,
  pagesScreen,
  person,
  recordList,
  recordForm,
  section,
  settingsScreen,
  stack,
  surface,
  tabs,
  tag,
} from 'ketsuite/backend'
import type { AppRow, ListChrome, PageRow } from 'ketsuite/backend'

/**
 * The design team writes CSS against these attributes.
 *
 * The list used to live here, maintained by hand, and drifted four times in one
 * afternoon. It now comes from the kit: each file declares the hooks it emits
 * beside the markup that emits them, so forgetting one turns this red in the file
 * you just edited.
 */
const CONTRACT = HOOKS

const app = (over: Partial<AppRow> = {}): AppRow => ({
  name: 'website',
  title: 'Website',
  summary: 'x',
  category: 'Website',
  state: 'available',
  depends: [],
  dependents: [],
  ...over,
})
const page = (over: Partial<PageRow> = {}): PageRow => ({
  id: 'p',
  path: '/',
  title: 'T',
  published: true,
  ...over,
})

/** A tree with every shape the shell draws: an app, a section, and a plain link. */
const node = (id: string, over: Partial<MenuNode> = {}): MenuNode => ({
  id,
  label: id,
  path: null,
  icon: null,
  active: false,
  children: [],
  ...over,
})
const MENU: MenuNode[] = [
  node('admin', {
    icon: 'settings',
    active: true,
    children: [
      node('admin.apps', { path: '/admin', active: true }),
      node('admin.content', { children: [node('admin.pages', { path: '/admin/pages' })] }),
    ],
  }),
  // An icon this build does not carry: the entry keeps its row and falls back to
  // a monogram, which is the case that has to be styled.
  node('other', { icon: 'no-such-glyph' }),
]

/** Every control at once — the contract test only sees what is rendered. */
const CHROME: ListChrome = {
  create: { label: 'Mới', path: '/admin/pages/new' },
  search: {
    name: 'q',
    value: 'x',
    placeholder: 'Tìm',
    facets: [{ label: 'Tìm: x', without: '/admin/pages' }],
  },
  pager: { from: 1, to: 30, total: 84, prev: null, next: '/admin/pages?page=2' },
  views: [
    { id: 'list', label: 'Danh sách', icon: 'list', path: '?view=list', active: true },
    { id: 'kanban', label: 'Thẻ', icon: 'layout-grid', path: '?view=kanban', active: false },
  ],
}

const _ = translator(compose([backend], { headless: true }), 'vi')

const componentContract = [
  actionGroup({
    label: 'Actions',
    actions: [
      button({ label: 'Save', variant: 'primary', icon: 'check' }),
      button({ label: 'Loading', loading: true }),
      linkButton({ label: 'Disabled link', href: '/x', disabled: true }),
      iconButton({ label: 'More', icon: 'settings' }),
    ],
  }),
  inline([
    badge('Ready', 'positive'),
    tag({ label: 'Filter', removeHref: '/clear' }),
    countBadge(3, '3 items'),
  ]),
  stack([
    notice({
      title: 'Heads up',
      message: 'Notice body',
      icon: icon('info'),
      actions: linkButton({ label: 'Review', href: '/review' }),
    }),
    emptyState('Empty', 'Nothing here', {
      icon: icon('package'),
      actions: linkButton({ label: 'Create', href: '/new' }),
    }),
    loadingState('Loading records', 2),
  ]),
  section({
    eyebrow: 'Operations',
    title: 'Section',
    description: 'Description',
    actions: linkButton({ label: 'Open', href: '/open' }),
    body: surface({
      body: contentCard({
        title: 'Card',
        href: '/card',
        summary: 'Summary',
        body: 'Body',
        meta: badge('Meta'),
        actions: linkButton({ label: 'Edit', href: '/edit' }),
      }),
    }),
  }),
  cardGrid({
    items: [{ id: 'card' }],
    id: (item) => item.id,
    card: () => contentCard({ title: 'Grid card' }),
  }),
  metric({ label: 'Orders', value: '42', detail: 'Today' }),
  recordForm({
    action: '/records',
    submit: 'Save',
    errors: ['Invalid value'],
    fields: [
      { name: 'name', label: 'Name', required: true, help: 'Required' },
      { name: 'kind', label: 'Kind', type: 'select', options: [{ value: 'a', label: 'A' }] },
    ],
  }),
  mediaPanel({ status: 'unavailable' }),
  mediaPanel({
    status: 'ready',
    uploadAction: '/media',
    images: [
      {
        id: 'main',
        src: '/fixture-main.png',
        alt: 'Main',
        primary: true,
        actions: { remove: '/media/main/remove' },
      },
      { id: 'other', src: '/fixture-other.png', alt: 'Other' },
    ],
    extension: 'Adapter slot',
  }),
  breadcrumbs({ label: 'Breadcrumb', items: [{ label: 'Home', href: '/' }, { label: 'Current' }] }),
  tabs({ label: 'Tabs', items: [{ id: 'all', label: 'All', href: '?tab=all', active: true, count: 3 }] }),
  kanbanGrid({
    rows: [{ id: 'k' }],
    id: (row) => row.id,
    card: (row) =>
      kanbanCard({
        key: row.id,
        title: 'Card',
        meta: badge('Draft'),
        note: 'Note',
        actions: linkButton({ label: 'Open', href: '/k' }),
      }),
  }),
  recordList({
    rows: [{ id: 'r', title: 'Record', summary: 'Summary', value: '12' }],
    id: (row) => row.id,
    title: (row) => row.title,
    href: (row) => `/r/${row.id}`,
    summary: (row) => row.summary,
    value: (row) => row.value,
  }),
  dataTable(_, {
    caption: 'Sortable records',
    rows: [{ id: 'r', name: 'Record' }],
    id: (row) => row.id,
    columns: [
      {
        key: 'name',
        label: 'Name',
        cell: (row) => row.name,
        sort: { href: '?sort=name', direction: 'asc', label: 'Sort by name' },
      },
    ],
  }),
]

const everything = [
  appsScreen(
    _,
    [app({ state: 'installed', dependents: ['website_menu'] }), app({ name: 'b', depends: ['website'] })],
    {
      menu: MENU,
      viewer: { name: 'Nguyễn Quản Trị', company: 'acme', companies: ['acme', 'globex'] },
      indicators: [{ id: 'activity', icon: 'bell', label: 'Việc', count: 3, path: '/a' }],
    },
  ),
  pagesScreen(
    _,
    [page(), page({ id: 'q', published: false })],
    { menu: MENU, chrome: CHROME },
    // With the column menu open: the hooks inside it only exist when it can be used.
    { shown: ['id'], colsHref: (keys) => `/admin/pages?cols=${keys.join(',')}` },
  ),
  person('Nguyễn Quản Trị'),
  settingsScreen(_, { 'color-accent': 'x' }, { menu: MENU }),
  // A sidebar whose search matched nothing: the label goes, a note takes its place.
  settingsScreen(_, { 'color-accent': 'x' }, { menu: [], menuFilter: 'zzz' }),
  errorState('E_X', 'msg', 'hint'),
  ...componentContract,
]
  .map((r) => renderToString(r))
  .join('')

test('ui contract: every documented data-ui hook is actually emitted', () => {
  const missing = CONTRACT.filter((name) => !everything.includes(`data-ui="${name}"`))
  assert.deepEqual(missing, [], 'a hook the stylesheet targets went missing')
})

test('ui contract: no hook is emitted that the contract does not list', () => {
  const emitted = new Set([...everything.matchAll(/data-ui="([^"]+)"/g)].map((m) => m[1] as string))
  const undocumented = [...emitted].filter((n) => !CONTRACT.includes(n)).sort()
  assert.deepEqual(undocumented, [], 'a new hook needs a line in admin.css before it ships')
})

test('ui contract: every documented hook has an explicit CSS rule', () => {
  const css = readFileSync('packages/ketsuite/src/modules/backend/design/admin.css', 'utf8')
  const missing = CONTRACT.filter((name) => !css.includes(`[data-ui="${name}"]`))
  assert.deepEqual(missing, [], 'a component hook needs a concrete baseline rule before it ships')
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
  assert.ok(
    !everything.includes('class='),
    "a class is a decision about looks, and that decision is the design team's",
  )
})

test('catalogue: covers empty, long, blocked and error, not just the happy path', () => {
  const ids = CASES.map((c) => c.id)
  for (const needed of [
    'apps-empty',
    'apps-long',
    'apps-blocked',
    'pages-empty',
    'pages-long',
    'state-error',
  ]) {
    assert.ok(
      ids.includes(needed),
      `the catalogue must show "${needed}" — a design that skips it gets built twice`,
    )
  }
  const html = renderToString(cataloguePage(_))
  assert.equal([...html.matchAll(/data-ui="catalogue-case"/g)].length, CASES.length)
  assert.ok(
    CASES.every((c) => c.note.length > 10),
    'every case says what it is testing',
  )
})
