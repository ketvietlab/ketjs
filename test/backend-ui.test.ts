import { test } from 'node:test'
import assert from 'node:assert/strict'
import { globSync, readFileSync } from 'node:fs'
import { html as html2, renderToString } from '@ketvietlab/ketjs-view'
import { buildMenu, compose, document as ketDocument, translator } from '@ketvietlab/ketjs'
import { LAYER_ORDER_CSS } from '@ketvietlab/ketjs/theme'
import type { MenuNode, Route, ServeContext } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import backend from '@ketvietlab/ketsuite/backend'
import {
  actionGroup,
  attachmentPanel,
  activityContractCases,
  calendarContractCases,
  backendPage,
  badge,
  breadcrumbs,
  button,
  cardGrid,
  cataloguePage,
  CASES,
  contentCard,
  countBadge,
  dataTable,
  datePicker,
  definitionList,
  gantt,
  columns,
  chart,
  barChart,
  delta,
  progressBar,
  emptyState,
  errorState,
  formCluster,
  Framed,
  HOOKS,
  hasIcon,
  icon,
  iconButton,
  inline,
  kanbanCard,
  thumbnail,
  docTree,
  kanbanGrid,
  linkButton,
  loadingState,
  loginScreen,
  mailContractCases,
  metric,
  modalSheet,
  mediaPanel,
  notice,
  pagesScreen,
  person,
  recordList,
  recordActions,
  recordFieldGrid,
  recordForm,
  recordHeaderActions,
  recordRail,
  readonlyField,
  qrCode,
  recordToggle,
  recordWorkspace,
  scheduleBoard,
  section,
  shell,
  stack,
  surface,
  tabs,
  tag,
} from '@ketvietlab/ketsuite/backend'
import type { ListChrome, PageRow } from '@ketvietlab/ketsuite/backend'

/**
 * The design team writes CSS against these attributes.
 *
 * The list used to live here, maintained by hand, and drifted four times in one
 * afternoon. It now comes from the kit: each file declares the hooks it emits
 * beside the markup that emits them, so forgetting one turns this red in the file
 * you just edited.
 */
const CONTRACT = HOOKS

const page = (over: Partial<PageRow> = {}): PageRow => ({
  id: 'p',
  path: '/',
  title: 'T',
  published: true,
  ...over,
})

/** A tree with every shape the shell draws: a root, a section, and a plain link. */
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
      node('admin.apps', { icon: 'layout-grid', path: '/admin', active: true }),
      node('admin.content', {
        icon: 'file-text',
        children: [node('admin.pages', { path: '/admin/pages' })],
      }),
    ],
  }),
  // An icon this build does not carry: the entry keeps its row and falls back to
  // a monogram, which is the case that has to be styled.
  node('other', { icon: 'no-such-glyph' }),
]

/** Every control at once — the contract test only sees what is rendered. */
const CHROME: ListChrome = {
  create: { label: 'Mới', path: '/admin/pages/new' },
  selection: {
    formId: 'page-bulk',
    action: '/admin/pages/bulk',
    hidden: { returnTo: '/admin/pages' },
    actions: [
      { id: 'archive', label: 'Archive' },
      { id: 'delete', label: 'Delete', tone: 'danger' },
    ],
  },
  search: {
    name: 'q',
    value: 'x',
    placeholder: 'Tìm',
    facets: [{ label: 'Tìm: x', without: '/admin/pages' }],
    menus: [
      {
        id: 'filters',
        label: 'Bộ lọc',
        items: [{ id: 'active', label: 'Đang hoạt động', path: '?preset=active', active: true }],
        customFilter: {
          fields: [{ value: 'name', label: 'Tên' }],
          operators: [{ value: 'contains', label: 'chứa' }],
          fieldLabel: 'Trường',
          operatorLabel: 'Điều kiện',
          valueLabel: 'Giá trị',
          applyLabel: 'Áp dụng',
        },
      },
    ],
  },
  pager: { from: 1, to: 30, total: 84, prev: null, next: '/admin/pages?page=2' },
  views: [
    { id: 'list', label: 'Danh sách', icon: 'list', path: '?view=list', active: true },
    { id: 'kanban', label: 'Thẻ', icon: 'layout-grid', path: '?view=kanban', active: false },
  ],
}

const _ = translator(compose([backend], { headless: true }), 'vi')

const componentContract = [
  qrCode([[true]], 'QR code'),
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
  recordWorkspace({
    kicker: 'Product',
    title: 'Linen shirt',
    subtitle: 'LINEN-01 · Unit',
    status: badge('Active', 'positive'),
    image: null,
    imageFallback: icon('package'),
    badges: [
      badge('Goods', 'neutral'),
      recordToggle({ name: 'saleOk', label: 'Can be sold', checked: true, form: 'product-form' }),
    ],
    summary: [
      { id: 'variants', label: 'Variants', value: 6, href: '?tab=variants' },
      { id: 'tracking', label: 'Tracking', value: 'Lots' },
    ],
    navigation: tabs({
      label: 'Product sections',
      items: [{ id: 'general', label: 'General', href: '?tab=general', active: true }],
    }),
    controller: notice({ title: 'Saved', message: 'Product updated', tone: 'positive' }),
    body: surface({ body: 'Product form', padding: 'compact' }),
    aside: surface({ body: 'Collaboration', padding: 'compact' }),
    asideLabel: 'Collaboration',
  }),
  recordFieldGrid({
    fields: [readonlyField({ id: 'future-code', label: 'Future code', future: true })],
  }),
  recordHeaderActions({
    label: 'Record actions',
    form: 'product-form',
    moreLabel: 'More',
    more: recordForm({
      action: '/admin/products/archive',
      fields: [],
      submit: 'Archive',
      submitVariant: 'destructive',
      layout: 'inline',
    }),
    noteLabel: 'Internal note',
    saveLabel: 'Save & close',
    saveOptionsLabel: 'Save options',
  }),
  recordRail({
    system: {
      title: 'System information',
      facts: [{ id: 'id', label: 'ID', value: 'record-1', divider: true }],
    },
    switches: {
      title: 'Channels',
      items: [{ id: 'web', label: 'Website', icon: 'globe', future: true }],
      actionLabel: 'Manage channels',
    },
    activity: {
      title: 'Activity',
      items: [{ id: 'created', label: 'Created', detail: 'Today', icon: 'package' }],
      actionLabel: 'View all',
    },
  }),
  modalSheet({
    title: 'Follow-up',
    closeHref: '/admin/crm/followups',
    closeLabel: 'Close',
    body: surface({ body: 'Follow-up workspace', padding: 'compact' }),
  }),
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
  datePicker({
    action: '/calendar',
    label: 'Stay dates',
    submit: 'Apply',
    clearHref: '/calendar',
    clearLabel: 'Clear',
    hidden: { property: 'hotel-1' },
    fields: [
      { name: 'from', label: 'From', value: '2026-08-20', required: true, help: 'Property timezone' },
      { name: 'to', label: 'To', value: '2026-08-18', error: 'Must be after from' },
    ],
  }),
  recordForm({
    action: '/records',
    submit: 'Save',
    submitVariant: 'primary',
    errors: ['Invalid value'],
    fields: [
      { name: 'name', label: 'Name', required: true, help: 'Required', error: 'Enter a name' },
      { name: 'kind', label: 'Kind', type: 'select', options: [{ value: 'a', label: 'A' }] },
      {
        name: 'type',
        label: 'Product type',
        type: 'radio',
        value: 'goods',
        options: [
          { value: 'goods', label: 'Goods' },
          { value: 'service', label: 'Service' },
        ],
      },
    ],
  }),
  formCluster({
    label: 'Activity actions',
    forms: [
      recordForm({
        action: '/activities/1',
        submit: 'Complete',
        submitVariant: 'primary',
        layout: 'inline',
        hidden: { id: '1', action: 'complete' },
        fields: [{ name: 'feedback', label: 'Feedback' }],
      }),
      recordForm({
        action: '/activities/1',
        submit: 'Reschedule',
        submitVariant: 'secondary',
        layout: 'inline',
        hidden: { id: '1', action: 'reschedule' },
        fields: [{ name: 'dueDate', label: 'New due date', type: 'date' }],
      }),
      recordForm({
        action: '/activities/1',
        submit: 'Cancel',
        submitVariant: 'destructive',
        layout: 'inline',
        hidden: { id: '1', action: 'cancel' },
        fields: [],
      }),
    ],
  }),
  recordActions({
    action: '/records/1',
    actions: [
      { value: 'confirm', label: 'Confirm', variant: 'primary' },
      { value: 'cancel', label: 'Cancel', variant: 'destructive' },
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
        href: `/k/${row.id}`,
        media: thumbnail({ src: '/files/x', alt: 'Card', size: 'card' }),
        meta: badge('Draft'),
        note: 'Note',
        actions: linkButton({ label: 'Open', href: '/k' }),
      }),
  }),
  thumbnail({ src: '/files/x', alt: 'Record' }),
  thumbnail({ fallback: icon('package') }),
  // Two levels, so the nested branch and its rail are rendered and not only
  // the root list — the stylesheet targets both.
  docTree<{
    id: string
    parent: string | null
    title: string
    summary: string
    count: string | null
  }>({
    rows: [
      { id: 'root', parent: null, title: 'Handbook', summary: 'How we work', count: '2 children' },
      { id: 'child', parent: 'root', title: 'Onboarding', summary: 'First week', count: null },
    ],
    id: (row) => row.id,
    parent: (row) => row.parent,
    title: (row) => row.title,
    href: (row) => `/docs/${row.id}`,
    summary: (row) => row.summary,
    count: (row) => row.count,
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
    rowHref: (row) => `/r/${row.id}`,
    selection: {
      formId: 'page-bulk',
      action: '/admin/pages/bulk',
      actions: [{ id: 'archive', label: 'Archive' }],
    },
    columns: [
      {
        key: 'name',
        label: 'Name',
        cell: (row) => row.name,
        sort: { href: '?sort=name', direction: 'asc', label: 'Sort by name' },
      },
    ],
    groups: [
      {
        id: 'goods',
        label: 'Goods',
        count: 1,
        depth: 0,
        open: true,
        href: '?open=goods',
        rows: [{ id: 'r', name: 'Record' }],
        pager: { label: '1-1 / 2', next: '?groupPage=goods:2' },
      },
    ],
  }),
  scheduleBoard({
    corner: 'Room / day',
    days: [{ key: '2026-08-20', label: 'Thu', detail: '20/08', today: true }],
    rows: [{ id: '101', label: 'Room 101', detail: 'Deluxe', state: 'occupied' }],
    events: [
      {
        id: 'stay-1',
        rowId: '101',
        start: 0,
        span: 1,
        label: 'Nguyễn An',
        detail: 'Direct',
        tone: 'positive',
        state: 'checked_in',
      },
    ],
  }),
  attachmentPanel({
    items: [
      {
        id: 'attachment',
        name: 'customer-note.pdf',
        href: '/files/attachment',
        size: 1024,
        mimetype: 'application/pdf',
      },
    ],
    uploadAction: '/records/r/attachments',
    emptyTitle: 'No attachments',
    emptyHint: 'Upload a supporting file.',
    chooseLabel: 'Choose file',
    uploadLabel: 'Upload',
  }),
]

const everything = [
  shell(_, 'Standalone title', surface({ body: 'Standalone body' })),
  pagesScreen(_, [page(), page({ id: 'viewer', title: 'Viewer' })], {
    menu: MENU,
    viewer: {
      name: 'Nguyễn Quản Trị',
      company: 'acme',
      companies: ['acme', 'globex'],
      companyName: 'Công ty Kết Việt',
      branch: 'root:acme',
      branches: ['root:acme'],
      branchName: 'Trụ sở chính',
      contextPath: '/admin/context',
    },
    indicators: [{ id: 'activity', icon: 'bell', label: 'Việc', count: 3, path: '/a' }],
  }),
  pagesScreen(
    _,
    [page(), page({ id: 'q', published: false })],
    { menu: MENU, chrome: CHROME },
    // With the column menu open: the hooks inside it only exist when it can be used.
    { shown: ['id'], colsHref: (keys) => `/admin/pages?cols=${keys.join(',')}` },
  ),
  person('Nguyễn Quản Trị'),
  // A sidebar whose search matched nothing: the label goes, a note takes its place.
  pagesScreen(_, [page()], { menu: [], menuFilter: 'zzz' }),
  // How far along a record is. A value, because the empty case draws nothing at
  // all — which is the point of it, and would show none of the parts.
  progressBar({ value: 62, label: 'Tiến độ' }),
  // A bar, a point and a start nobody chose, which is every shape a row takes.
  gantt({
    items: [
      { id: 'g1', title: 'Bar', href: '/a', startsOn: '2026-08-01', endsOn: '2026-09-20', progress: 40 },
      { id: 'g2', title: 'Point', href: '/b', startsOn: '2026-08-10' },
      {
        id: 'g3',
        title: 'Inferred',
        href: '/c',
        startsOn: '2026-08-05',
        endsOn: '2026-08-09',
        inferredStart: true,
      },
    ],
    today: '2026-08-15',
    labels: { today: 'Hôm nay', empty: 'Trống' },
  }),
  gantt({ items: [], labels: { today: 'Hôm nay', empty: 'Trống' } }),
  // Two things read against each other. Equal columns above a threshold, one
  // below it, decided by the space rather than by the device.
  columns([surface({ body: 'Cơ cấu doanh thu' }), surface({ body: 'Chi phí theo tài khoản' })], 'loose'),
  // A filter row: every choice visible, wrapping rather than scrolling past the edge.
  tabs({
    label: 'Kỳ báo cáo',
    wrap: true,
    items: [
      { id: 'today', label: 'Hôm nay', href: '?period=today' },
      { id: 'last30', label: '30 ngày qua', href: '?period=last30', active: true },
    ],
  }),
  // A chart is two halves: the canvas the island mounts, and the legend that
  // carries the same numbers as text. Rendered here with a stand-in for the
  // plot, because the island needs a request and this contract needs neither.
  chart({
    plot: surface({ body: 'canvas' }),
    kind: 'line',
    keys: [
      { id: 'now', label: 'Kỳ này', series: 1, value: '2.450.680 ₫' },
      { id: 'was', label: 'Kỳ trước', series: 'comparison', value: '2.073.620 ₫' },
    ],
  }),
  // And the case a deployment without the admin gets: no canvas, legend only.
  chart({ plot: null, kind: 'doughnut', keys: [{ id: 'a', label: 'Bán hàng hoá', series: 1 }] }),
  chart({ plot: null, kind: 'line', keys: [], empty: 'Chưa có số liệu' }),
  barChart({
    bars: [
      { id: 'cogs', label: '632 · Giá vốn hàng bán', value: 1_320_000_000, href: '/admin/accounting' },
      { id: 'admin', label: '642 · Chi phí quản lý', value: 160_000_000 },
    ],
    value: (bar) => String(bar.value),
    scale: ['0', '1.5 tỷ'],
  }),
  barChart({ bars: [], value: () => '', empty: 'Chưa có chi phí' }),
  // Both halves of a change: which way it went, and whether that is good news.
  delta({ label: '+18,2%', direction: 'up', sentiment: 'good' }),
  delta({ label: '-6,3%', direction: 'down', sentiment: 'good' }),
  delta({ label: '0%', direction: 'flat', sentiment: 'neutral' }),
  metric({ label: 'Doanh thu thuần', value: '2.450.680 ₫', trend: 'x', detail: 'so với kỳ trước' }),
  // The token list, which no admin screen renders any more now that the design-token
  // dump has left /admin/settings. Modules still reach for it on record detail.
  definitionList({
    title: 'Design token',
    items: [{ key: 'color-accent', term: '--ket-color-accent', value: 'x' }],
  }),
  errorState('E_X', 'msg', 'hint'),
  // The sign-in screen, in the one state that shows every hook it owns at once.
  loginScreen(_, {
    next: '/admin/companies',
    failed: true,
    providers: [{ code: 'google', name: 'Google', href: '/oauth/google' }],
    locales: ['vi', 'en'],
    locale: 'vi',
  }),
  ...componentContract,
  ...mailContractCases(),
  ...activityContractCases(),
  ...calendarContractCases(),
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
  assert.deepEqual(undocumented, [], 'a new hook needs a baseline rule before it ships')
})

const ADMIN_STYLESHEETS = [
  'packages/ketsuite/src/modules/backend/design/foundation.css',
  'packages/ketsuite/src/modules/backend/design/lists.css',
  'packages/ketsuite/src/modules/backend/design/responsive.css',
  'packages/ketsuite/src/modules/backend/design/auth.css',
  'packages/ketsuite/src/modules/backend/design/controls.css',
  'packages/ketsuite/src/modules/backend/design/record.css',
  'packages/ketsuite/src/modules/backend/design/forms.css',
  'packages/ketsuite/src/modules/backend/design/content.css',
  'packages/ketsuite/src/modules/backend/design/charts.css',
]

/** Every stylesheet the kit's hooks are styled by. */
const STYLESHEETS = [
  ...ADMIN_STYLESHEETS,
  'packages/ketsuite/src/ui/client/mail.css',
  'packages/ketsuite/src/ui/client/activity.css',
  'packages/ketsuite/src/ui/client/calendar.css',
]

const ADMIN_CSS = ADMIN_STYLESHEETS.map((path) => readFileSync(path, 'utf8')).join('\n')

/** And the ones a module owns for its own island. */
const MODULE_STYLESHEETS = [
  'packages/ketsuite/src/modules/backend/design/tokens.css',
  'packages/ketsuite/src/modules/crm_backend/client/crm.css',
  'packages/ketsuite/src/modules/partner_backend/client/address.css',
  'packages/ketsuite/src/ui/client/flow-app.css',
]

test('ui contract: every documented hook has an explicit CSS rule', () => {
  const css = STYLESHEETS.map((path) => readFileSync(path, 'utf8')).join('\n')
  const missing = CONTRACT.filter((name) => !css.includes(`[data-ui="${name}"]`))
  assert.deepEqual(missing, [], 'a component hook needs a concrete baseline rule before it ships')
})

test('ui contract: the stylesheet targets no hook nothing emits', () => {
  // The contract runs both ways. The existing test catches a rule with no hook;
  // this catches a hook with no markup — `[data-ui="crumb"]` outlived the component
  // that emitted it and sat there being maintained.
  //
  // Two sources beyond the kit are legitimate. `nav-item` belongs to whatever a
  // third party hangs off `backend:nav.items`, so the kit never emits it. The login
  // screen and the design catalogue still write their own markup — they are on
  // ui-audit's pending list — so their hooks are read from the source that emits
  // them, and stop being read from there the day that markup moves into the kit.
  const RESERVED_FOR_FILLS = ['nav-item']
  // An island's markup is behaviour, so it lives in the browser file rather than in
  // the kit; the login screen and the design catalogue are on ui-audit's pending
  // list. Both are read from the source that emits them, so the day that markup
  // moves into the kit this stops reading them and nothing has to be remembered.
  const OTHER_SOURCES = [
    'packages/ketsuite/src/modules/user/login.ts',
    'packages/ketsuite/src/modules/backend/catalogue.ts',
    ...globSync('packages/ketsuite/src/**/client/*.mjs'),
    ...globSync('packages/ketsuite/src/ui/client/*.tsx'),
  ]
  const emitted = new Set<string>([
    ...HOOKS,
    ...RESERVED_FOR_FILLS,
    ...OTHER_SOURCES.flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(/data-ui=(?:"|\{?')([a-z0-9-]+)/g)].map((m) => m[1] as string),
    ),
  ])
  const css = STYLESHEETS.map((path) => readFileSync(path, 'utf8')).join('\n')
  const targeted = new Set([...css.matchAll(/\[data-ui="([a-z0-9-]+)"/g)].map((m) => m[1] as string))
  const orphans = [...targeted].filter((name) => !emitted.has(name)).sort()
  assert.deepEqual(orphans, [], 'a rule outlived the component that emitted its hook')
})

test('design tokens: the cascade order is declared before the first stylesheet', () => {
  // `@layer a, b, c;` is what fixes precedence; without it the order is whatever
  // first-appearance across the loaded stylesheets happens to be, and `ket.theme`
  // outranked `ket.app` on every backend page purely because its stylesheet linked first.
  const rendered = renderToString(
    ketDocument({
      lang: 'vi',
      title: 'x',
      head: html2`<link rel="stylesheet" href="/a.css">`,
      body: html2``,
    }),
  )
  const order = rendered.indexOf(LAYER_ORDER_CSS)
  assert.ok(order > 0, 'every document declares the layer order')
  assert.ok(order < rendered.indexOf('/a.css'), 'before any stylesheet can define a layer')
  assert.equal(LAYER_ORDER_CSS, '@layer ket.reset, ket.theme, ket.app, ket.user;')
})

test('design tokens: no rule sits outside a cascade layer, where it outranks ket.user', () => {
  // Unlayered CSS beats every layer, including the one the design handoff promises
  // always wins. Seventy-nine lines of mobile shell rules used to sit out here.
  for (const path of [...STYLESHEETS, ...MODULE_STYLESHEETS]) {
    const source = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    let depth = 0
    for (const [index, line] of source.split('\n').entries()) {
      const text = line.trim()
      if (depth === 0 && text && !text.startsWith('@layer '))
        assert.fail(`${path}:${index + 1} is outside a cascade layer, so it outranks ket.user\n  ${text}`)
      depth += (line.match(/{/g)?.length ?? 0) - (line.match(/}/g)?.length ?? 0)
    }
  }
})

test('routes: the segment after /admin names the section, so a path says where it lives', () => {
  // Two conventions used to run side by side: /admin/crm/cases said which app it
  // belonged to, /admin/transfers and /admin/accounts did not — and website_backend
  // used both, with pages and posts namespaced and forms, media, menus, sites and
  // taxonomies flat. A reader could not tell what owned a screen from its URL, and
  // /admin/pages and /admin/website/pages were two page lists in two apps.
  const APPS = new Set([
    // one per root menu entry
    'accounting',
    'activities',
    'attendance',
    'calendar',
    'crm',
    'flow',
    'hospitality',
    'hr',
    'inbound-email',
    'inbox',
    'loyalty',
    'manufacturing',
    'oauth',
    'outbox',
    'partner',
    'pos',
    'pricing',
    'product',
    'purchase',
    'reports',
    'sales',
    'stock',
    'website',
    // and the administration section's own screens, which sit directly under /admin
    'apps',
    'settings',
    'profile',
    'context',
    'addresses',
    'companies',
    'users',
    'roles',
    'permission-presets',
  ])
  const manifest = compose(ketsuite.modules, { headless: true })
  const stray = Object.keys(manifest.routes)
    .filter((path) => path === '/admin' || path.startsWith('/admin/'))
    .filter((path) => {
      const app = path.split('/')[2]
      return app !== undefined && !APPS.has(app)
    })
    .sort()
  assert.deepEqual(stray, [], 'a backend path must start with the section it belongs to')
})

test('routes: every path a screen builds is a path some module serves', () => {
  // A link is only as good as the route behind it, and nothing checked that the two
  // agreed: renaming `/admin/taxes` to `/admin/accounting/taxes` left twenty form
  // actions and redirects on the old one, every last of them written as
  // `` `/admin/taxes${localeQuery(url)}` `` — a template hole away from the search
  // that found the rest. The route table is the answer; this asks it.
  const routes = Object.keys(compose(ketsuite.modules, { headless: true }).routes).map((route) =>
    route.split('/'),
  )
  const served = (path: string): boolean => {
    const parts = path.split('/')
    return routes.some(
      (route) =>
        route.length === parts.length &&
        route.every((segment, index) => segment.startsWith('{') || segment === parts[index]),
    )
  }

  /**
   * The literal, with its holes read the way a router would.
   *
   * A hole filling a whole segment is a path parameter. A hole anywhere else is an
   * id glued to the segment before it or the `?lang=` suffix every link carries, and
   * neither says anything about the shape of the path — so the path ends there.
   * Holes nest (`${a ? `?x=${b}` : ''}`), which is why this counts braces.
   */
  const shape = (literal: string): string => {
    let out = ''
    for (let i = 0; i < literal.length; ) {
      if (literal[i] === '$' && literal[i + 1] === '{') {
        if (!out.endsWith('/')) return out
        let depth = 1
        i += 2
        while (i < literal.length && depth > 0) {
          if (literal[i] === '{') depth++
          if (literal[i] === '}') depth--
          i++
        }
        out += '{}'
        continue
      }
      if (literal[i] === '?' || literal[i] === '#') break
      out += literal[i]
      i++
    }
    return out
  }

  const stray: string[] = []
  for (const file of globSync('packages/ketsuite/src/**/*.{ts,tsx}')) {
    // the design harness names paths for screens it renders without a server
    if (file.includes('/backend/catalogue')) continue
    const source = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    for (const match of source.matchAll(/[`'](\/admin\/[^`'\n]*)[`']/g)) {
      const path = shape(match[1] as string).replace(/\/$/, '')
      if (!path.startsWith('/admin/') || served(path)) continue
      stray.push(`${file.split('/src/')[1]}: ${path}`)
    }
  }
  assert.deepEqual([...new Set(stray)].sort(), [], 'a screen links somewhere no route answers')
})

test('sidebar: every menu entry says where it goes in the list', () => {
  // Without `sequence` an entry falls to 100 and ties with every other one, and the
  // tie-break is the label — so a Vietnamese menu came out in the order its English
  // message keys happened to sort in. Purchasing read Đơn mua · RFQ · Bảng giá,
  // which is the workflow backwards.
  const manifest = compose(ketsuite.modules, { headless: true })
  const entries = Object.entries(manifest.menus)
  assert.deepEqual(
    entries
      .filter(([, entry]) => entry.sequence === undefined)
      .map(([id]) => id)
      .sort(),
    [],
    'an entry with no sequence is an entry nobody decided the position of',
  )

  const bySibling = new Map<string, Map<number, string[]>>()
  for (const [id, entry] of entries) {
    const siblings = bySibling.get(entry.parent ?? '') ?? new Map()
    siblings.set(entry.sequence as number, [...(siblings.get(entry.sequence as number) ?? []), id])
    bySibling.set(entry.parent ?? '', siblings)
  }
  const tied = [...bySibling.values()]
    .flatMap((siblings) => [...siblings.values()])
    .filter((ids) => ids.length > 1)
  assert.deepEqual(tied, [], 'two entries at one position leave the order to registration order')
})

test('sidebar: equal sequences fall back to the language being read, not the message key', () => {
  const manifest = compose(ketsuite.modules, { headless: true })
  const order = (locale: string) =>
    buildMenu(manifest, {
      translate: (key) => translator(manifest, locale)(key),
      locale,
    }).map((node) => node.label)
  // Vietnamese and English disagree about where "Bán hàng"/"Sales" sits relative to
  // its neighbours, which is the whole point: the reader's alphabet decides.
  assert.notDeepEqual(order('vi'), order('en'))
  assert.ok(order('vi').every((label) => !label.startsWith('menu.')))
})

test('sidebar: every KetSuite root declares a glyph carried by the design system', () => {
  const manifest = compose(ketsuite.modules, { headless: true })
  const missing = Object.entries(manifest.menus)
    .filter(([, entry]) => !entry.parent)
    .filter(([, entry]) => !entry.icon || !hasIcon(entry.icon))
    .map(([id]) => id)
    .sort()
  assert.deepEqual(missing, [], 'a root menu must choose a supported semantic icon in its own module')
})

test('sidebar footer: legacy systray order keeps settings and sign-out functional', () => {
  const html = renderToString(
    pagesScreen(_, [page()], {
      menu: MENU,
      viewer: {
        name: 'Nguyễn Quản Trị',
        company: 'acme',
        companies: ['acme', 'globex'],
        contextPath: '/admin/context',
      },
      indicators: [
        { id: 'message', icon: 'mail', label: 'Thông báo', count: 2, path: '/admin/inbox' },
        { id: 'activity', icon: 'bell', label: 'Hoạt động', count: 2, path: '/admin/activities' },
      ],
    }),
  )
  assert.match(html, /data-ui="sidebar-tools"[\s\S]*data-kind="message"[\s\S]*data-kind="activity"/)
  assert.match(html, /<details data-ui="viewer">[\s\S]*<summary data-ui="viewer-trigger"/)
  assert.match(html, /data-ui="viewer-presence"/)
  assert.match(html, /data-ui="viewer-context-switcher" href="\/admin\/context"/)
  assert.match(html, /Chuyển công ty/)
  assert.doesNotMatch(html, /data-ui="context-switcher"|data-ui="viewer-company-indicator"/)
  assert.match(html, /<form data-ui="signout" method="post" action="\/logout">/)
})

test('backend shell: fragment navigation emits only replaceable slots', () => {
  const html = renderToString(
    pagesScreen(_, [page()], {
      navigation: true,
      menu: MENU,
      extras: { 'sidebar.foot': 'persistent foot' },
      indicators: [{ id: 'activity', icon: 'bell', label: 'Hoạt động', count: 2, path: '/admin/activities' }],
    }),
  )
  assert.match(html, /^<ket-fragments data-title=/)
  assert.deepEqual(
    [...html.matchAll(/<template data-ket-slot="([^"]+)"/g)].map((match) => match[1]),
    ['backend.sidebar-main', 'backend.topbar', 'backend.content'],
  )
  assert.doesNotMatch(html, /data-ui="sidebar-foot"|persistent foot|data-ui="indicator"/)
})

test('backend layout: framed list and form screens share the accounting workspace', () => {
  const list = renderToString(pagesScreen(_, [page()], {}))
  assert.match(list, /data-ui="record-workspace" data-page-frame="true"/)
  assert.match(list, /data-ui="record-heading"[\s\S]*Trang/)

  const rich = renderToString(
    Framed({
      translator: _,
      title: 'Record',
      frame: {},
      body: recordWorkspace({
        title: 'Record identity',
        imageFallback: icon('package'),
        body: surface({ body: 'Record body' }),
      }),
    }),
  )
  assert.equal(rich.match(/data-ui="record-workspace"/g)?.length, 2)
  assert.equal(rich.match(/data-page-frame="true"/g)?.length, 1)

  const css = ADMIN_CSS
  assert.match(css, /data-page-frame="true"\]:has/)
  assert.ok(
    css.includes('> [data-ui="record-body"] [data-ui="record-workspace"]'),
    'the generic frame also flattens a rich workspace wrapped by feedback or a stack',
  )
})

test('record workspace: collaboration aligns with the sheet when the topbar collapses', () => {
  const css = ADMIN_CSS
  assert.match(css, /\[data-ui="record-aside"\][\s\S]*?inset-block-start: 0/)
  assert.match(
    css,
    /\[data-ui="main"\]:has\(> \[data-ui="topbar"\] > \*\) \[data-ui="record-aside"\][\s\S]*?max-block-size: calc\(100dvh - var\(--admin-topbar-height\)/,
  )
})

test('record workspace: breadcrumbs and actions share the global record header', () => {
  const html = renderToString(
    recordWorkspace({
      kicker: 'Products',
      title: 'Linen shirt',
      imageFallback: icon('package'),
      controller: button({ label: 'Save', type: 'submit', form: 'product-form', variant: 'primary' }),
      body: surface({ body: 'Product form' }),
    }),
  )

  assert.match(
    html,
    /data-ui="record-top"[\s\S]*data-ui="record-header"[\s\S]*data-ui="breadcrumbs"[\s\S]*Products[\s\S]*Linen shirt[\s\S]*data-ui="record-controller"[\s\S]*form="product-form"/,
  )
  assert.doesNotMatch(html, /data-ui="record-navigation"[\s\S]*data-ui="record-controller"/)
})

test('record workspace: floating form controls can extend beyond the sheet', () => {
  const css = ADMIN_CSS
  assert.match(css, /\[data-ui="record-sheet"\][\s\S]*?overflow: visible/)
  assert.match(css, /\[data-ui="relation-menu"\][\s\S]*?position: absolute/)
})

test('backend responder: a fragment request never renders document infrastructure', async () => {
  let styles = 0
  let documents = 0
  const result = await backendPage(
    {
      styles: async () => {
        styles++
        throw new Error('fragment navigation must not resolve styles')
      },
      document: () => {
        documents++
        throw new Error('fragment navigation must not render a document')
      },
    } as never,
    { headers: { 'x-ket-navigation': 'fragment-v1' } } as never,
    {
      lang: 'vi',
      title: 'Ứng dụng',
      body: pagesScreen(_, [page()], { navigation: true, menu: MENU }),
    },
  )
  assert.equal(result.type, 'text/vnd.ket.fragments+html')
  assert.deepEqual({ styles, documents }, { styles: 0, documents: 0 })
})

test('design tokens: every admin role used by components is declared', () => {
  const css = STYLESHEETS.map((path) => readFileSync(path, 'utf8')).join('\n')
  const tokens = readFileSync('packages/ketsuite/src/modules/backend/design/tokens.css', 'utf8')
  const declared = new Set([...tokens.matchAll(/(--admin-[\w-]+)\s*:/g)].map((match) => match[1]))
  const referenced = new Set([...css.matchAll(/var\((--admin-[\w-]+)/g)].map((match) => match[1]))
  assert.deepEqual(
    [...referenced].filter((name) => !declared.has(name)).sort(),
    [],
    'a visual role must exist before a component can consume it',
  )
})

test('design tokens: status surfaces stay fixed across light and dark themes', () => {
  const tokens = readFileSync('packages/ketsuite/src/modules/backend/design/tokens.css', 'utf8')
  for (const name of [
    '--admin-neutral-soft',
    '--admin-success-soft',
    '--admin-warning-soft',
    '--admin-danger-soft',
  ]) {
    assert.equal(
      [...tokens.matchAll(new RegExp(`${name}\\s*:`, 'g'))].length,
      1,
      `${name} is a self-contained status surface, not a theme role`,
    )
  }
})

test('ui kit: every PascalCase export takes the one props object JSX hands it', async () => {
  // A positional helper exported under a JSX name is a trap: `<Stack items={…} />`
  // would hand `stack(items, gap)` a props object where it wants a list, and the
  // page renders empty rather than failing. So the entry rule for the PascalCase
  // block is arity one.
  const kit = (await import('@ketvietlab/ketsuite/ui')) as unknown as Record<string, unknown>
  const wrong = Object.entries(kit)
    .filter(([name]) => /^[A-Z][a-zA-Z]*$/.test(name))
    .filter(([, value]) => typeof value === 'function')
    .filter(([, value]) => (value as (...args: unknown[]) => unknown).length !== 1)
    .map(([name]) => name)
    .sort()
  assert.deepEqual(wrong, [], 'a JSX component takes props, not a positional argument list')
})

test('ui contract: an island control carries the same hook a form control does', () => {
  // An island's markup is behaviour, so it lives in a browser file rather than in
  // the kit — but the control inside it is still a control. Three of them wrote
  // their own: a heavier border, and no focus ring, no disabled state, no invalid
  // state. `<input type="datetime-local">` with no `data-ui` at all got whatever a
  // descendant selector two files away happened to say.
  const bare: string[] = []
  for (const path of globSync('packages/ketsuite/src/**/client/*.mjs')) {
    // the storefront search island is on ui-audit's pending list, markup and all
    if (path.includes('website_search')) continue
    for (const [index, line] of readFileSync(path, 'utf8').split('\n').entries()) {
      for (const match of line.matchAll(/<(input|select|textarea)\s[^>]*>/g)) {
        if (match[0].includes('data-ui=') || match[0].includes('type="hidden"')) continue
        bare.push(`${path}:${index + 1} ${match[0].slice(0, 60)}`)
      }
    }
  }
  assert.deepEqual(bare, [], 'an island control needs data-ui="form-control", like every other control')
})

test('design tokens: the native date picker glyph follows the theme', () => {
  // The browser draws the calendar and clock marks itself, in its own colour, which
  // on a dark canvas is a dark mark on a dark field. It is a bitmap: invertible,
  // not recolourable.
  const css = ADMIN_CSS
  const tokens = readFileSync('packages/ketsuite/src/modules/backend/design/tokens.css', 'utf8')
  assert.match(css, /::-webkit-calendar-picker-indicator[\s\S]*?filter: invert\(var\(--admin-picker-invert/)
  assert.match(tokens, /--admin-picker-invert: light-dark\(0, 1\);/)
})

test('backend layout: a framed screen names itself once, and not with a placeholder', () => {
  const manifest = compose(ketsuite.modules, { headless: true })
  const vi = translator(manifest, 'vi')
  const menu = buildMenu(manifest, {
    translate: (key) => vi(key),
    locale: 'vi',
    active: '/admin/stock/transfers',
  })
  const framed = renderToString(
    Framed({ translator: vi, title: 'Điều chuyển', frame: { menu }, body: surface({ body: 'x' }) }),
  )
  // The title was printed twice — once in the bar, once in the heading a line below.
  assert.equal(framed.match(/data-ui="title"/g), null, 'the bar does not repeat the heading')
  assert.equal(framed.match(/data-ui="record-heading"/g)?.length, 1)
  // And the header was a title beside a placeholder grid icon and nothing else.
  assert.match(framed, /data-ui="record-kicker"[^>]*>(?:<!--k\[-->)?Kho/)

  // A list keeps its toolbar; it just stops naming the page twice.
  const listed = renderToString(
    Framed({
      translator: vi,
      title: 'Điều chuyển',
      frame: { menu, chrome: { create: { label: 'Mới', path: '/x' } } },
      body: surface({ body: 'x' }),
    }),
  )
  assert.match(listed, /data-ui="chrome-create"/)
  assert.equal(listed.match(/data-ui="title"/g), null)
})

test('sidebar: the footer is pinned to the window, not to the end of the page', () => {
  // As a plain grid item the sidebar stretched to the shell's row — the content's
  // height — so on a long list the systray, the message and activity counts and the
  // settings link sat hundreds of pixels below the fold. It is the window's height
  // and it sticks; `sidebar-nav` takes the overflow inside it.
  const css = ADMIN_CSS
  const rule = css.match(/\[data-ui="sidebar"\] \{[^}]*\}/)?.[0] ?? ''
  assert.match(rule, /position:\s*sticky;/)
  assert.match(rule, /inset-block-start:\s*0;/)
  assert.match(rule, /block-size:\s*100dvh;/)
  assert.match(rule, /align-self:\s*start;/, 'or the grid stretches it back to the page height')
  assert.match(css, /\[data-ui="sidebar-nav"\] \{[^}]*overflow-y:\s*auto;/)
})

test('design density: controls and fields follow the canonical component dimensions', () => {
  const tokens = readFileSync('packages/ketsuite/src/modules/backend/design/tokens.css', 'utf8')
  const css = ADMIN_CSS
  assert.match(tokens, /--admin-control-height:\s*var\(--kv-control-height-md\);/)
  assert.match(tokens, /--admin-field-height:\s*var\(--kv-control-height-md\);/)
  assert.match(css, /:where\(\[data-ui="action"\],[\s\S]*?min-block-size:\s*var\(--admin-control-height\);/)
  assert.match(css, /\[data-ui="field-input"\][\s\S]*?min-block-size:\s*var\(--admin-field-height\);/)
  assert.match(css, /\[data-ui="form-control"\][\s\S]*?min-block-size:\s*var\(--admin-field-height\);/)
})

test('style safety: hidden content has no box and adjacent record controls use a real gap', () => {
  const css = ADMIN_CSS
  assert.match(css, /:where\(\[hidden\]\)\s*{\s*display:\s*none !important;/)
  assert.match(css, /\[data-ui="record-badges"\][\s\S]*?gap:\s*var\(--admin-gap\);/)
  assert.match(css, /\[data-ui="tab"\][\s\S]*?padding-block-start:\s*0\.25rem;/)
  assert.match(css, /\[data-ui="form-field"\]\s*{[\s\S]*?min-block-size:\s*var\(--admin-field-height\);/)
  assert.match(
    css,
    /@media \(min-width: 96rem\)[\s\S]*?grid-template-columns:\s*minmax\(0, 2fr\) minmax\(32rem, 1fr\);/,
  )
})

test('form: required, help and error states are visible and semantically connected', () => {
  const html = renderToString(
    recordForm({
      action: '/records',
      submit: 'Save',
      submitVariant: 'primary',
      fields: [
        {
          name: 'name',
          label: 'Name',
          required: true,
          help: 'Public label',
          error: 'Enter a name',
        },
        { name: 'active', label: 'Active', type: 'checkbox', value: true },
        { name: 'checkIn', label: 'Check-in', type: 'time', value: '14:00', step: '60' },
        { name: 'identityColor', label: 'Colour', type: 'color', value: '#2563eb' },
      ],
    }),
  )
  assert.match(html, /data-ui="form-required" aria-hidden="true"/)
  assert.match(
    html,
    /aria-invalid="true" aria-describedby="field--records-name-help field--records-name-error"/,
  )
  assert.match(html, /data-ui="form-help" id="field--records-name-help"/)
  assert.match(html, /data-ui="form-error" id="field--records-name-error"/)
  assert.match(html, /data-kind="checkbox"[\s\S]*type="checkbox"[\s\S]*data-ui="form-label"/)
  assert.match(html, /data-kind="time"[\s\S]*type="time"[\s\S]*value="14:00"[\s\S]*step="60"/)
  assert.match(html, /data-kind="color"[\s\S]*type="color"[\s\S]*value="#2563eb"/)
})

test('form: a record action bar can submit a form without duplicating its action', () => {
  const html = renderToString(
    recordForm({
      id: 'partner-identity-form',
      action: '/partners/one',
      submit: 'Save',
      submitVariant: 'primary',
      submitPlacement: 'external',
      fields: [{ name: 'name', label: 'Name', value: 'ACME' }],
    }),
  )
  assert.match(html, /<form id="partner-identity-form"/)
  assert.doesNotMatch(html, /data-ui="form-actions"/)
  assert.match(
    renderToString(
      button({ label: 'Save', type: 'submit', form: 'partner-identity-form', variant: 'primary' }),
    ),
    /type="submit"[^>]*form="partner-identity-form"/,
  )
})

test('form: related inline actions keep valid flow layout and explicit hierarchy', () => {
  const html = renderToString(
    formCluster({
      forms: [
        recordForm({
          action: '/activities',
          submit: 'Complete',
          submitVariant: 'primary',
          layout: 'inline',
          hidden: { id: 'one', action: 'complete' },
          fields: [{ name: 'feedback', label: 'Feedback' }],
        }),
        recordForm({
          action: '/activities',
          submit: 'Cancel',
          submitVariant: 'destructive',
          layout: 'inline',
          hidden: { id: 'one', action: 'cancel' },
          fields: [],
        }),
      ],
    }),
  )
  assert.match(html, /^<div data-ui="form-cluster"/)
  assert.match(html, /data-layout="inline" data-has-fields="true" data-submit-variant="primary"/)
  assert.match(html, /data-layout="inline" data-has-fields="false" data-submit-variant="destructive"/)
  assert.doesNotMatch(html, /^<span/, 'a form cluster must never use a phrasing root')
  assert.match(html, /id="field--activities-one-complete-feedback"/)
})

test('actions: one decision cluster cannot declare two primary actions', () => {
  assert.throws(
    () =>
      recordActions({
        action: '/records/1',
        actions: [
          { value: 'confirm', label: 'Confirm', variant: 'primary' },
          { value: 'approve', label: 'Approve', variant: 'primary' },
        ],
      }),
    /declares 2 primary actions/,
  )
})

test('islands: every business button declares the shared action role and hierarchy', () => {
  for (const path of [
    'packages/ketsuite/src/ui/client/mail-view.mjs',
    'packages/ketsuite/src/ui/client/activity-view.mjs',
    'packages/ketsuite/src/ui/client/calendar-view.mjs',
  ]) {
    const source = readFileSync(path, 'utf8')
    for (const [index, match] of [...source.matchAll(/<button\b[\s\S]*?>/g)].entries()) {
      assert.match(
        match[0],
        /(?:data-ui="action"|data-control="action")/,
        `${path} button ${index + 1} bypasses the shared action control`,
      )
      assert.match(match[0], /data-variant="(?:primary|secondary|tertiary|destructive)"/)
    }
  }
})

test('date picker: range remains a native, accessible and URL-driven form', () => {
  const html = renderToString(
    datePicker({
      action: '/calendar',
      label: 'Stay dates',
      submit: 'Apply',
      clearHref: '/calendar',
      clearLabel: 'Clear',
      hidden: { property: 'hotel-1' },
      fields: [
        { name: 'from', label: 'From', value: '2026-08-20', min: '2026-01-01', required: true },
        { name: 'to', label: 'To', value: '2026-08-18', error: 'Must be after from' },
      ],
    }),
  )
  assert.match(html, /data-ui="date-picker" method="get" action="\/calendar" data-range="true"/)
  assert.match(html, /type="hidden" name="property" value="hotel-1"/)
  assert.match(html, /type="date" name="from" autocomplete="off" value="2026-08-20" min="2026-01-01"/)
  assert.match(html, /aria-invalid="true" aria-describedby="date-picker--calendar-to-error"/)
  assert.match(html, /data-ui="date-picker-error" id="date-picker--calendar-to-error"/)
  assert.match(html, /href="\/calendar"/)

  const single = renderToString(
    datePicker({
      action: '/day',
      label: 'Business date',
      submit: 'Open',
      method: 'post',
      fields: [{ name: 'date', label: 'Date', disabled: true }],
    }),
  )
  assert.match(single, /method="post" action="\/day" data-range="false"/)
  assert.match(single, /type="date" name="date" autocomplete="off" value="" disabled/)
  assert.doesNotMatch(single, /href=/)
})

test('media: primary state has a label and image actions keep accessible icon controls', () => {
  const html = renderToString(
    mediaPanel({
      status: 'ready',
      images: [
        { id: 'main', src: '/main.png', alt: 'Main', primary: true },
        {
          id: 'other',
          src: '/other.png',
          alt: 'Other',
          actions: { primary: '/primary', moveUp: '/up', remove: '/remove' },
        },
      ],
    }),
  )
  assert.match(html, /data-ui="media-item" data-primary="true"/)
  assert.match(html, /data-value="primary"/)
  assert.match(html, /data-icon-only="true"[\s\S]*aria-label="Set as primary"/)
  assert.match(html, /data-variant="destructive"[\s\S]*aria-label="Remove image"/)
})

test('schedule: every declared status tone has a concrete visual state', () => {
  const css = ADMIN_CSS
  for (const tone of ['neutral', 'positive', 'info', 'warning', 'danger'])
    assert.ok(
      css.includes(`[data-ui="schedule-event"][data-tone="${tone}"]`),
      `schedule tone ${tone} needs an explicit design-system rule`,
    )
})

test('ui contract: the states a stylesheet branches on are present', () => {
  assert.match(everything, /data-tone="positive"/)
  assert.match(everything, /data-tone="neutral"/)
  assert.match(everything, /data-active="true"/)
  assert.match(everything, /disabled="true"/)
})

test('ui contract: markup carries no class attribute at all', () => {
  assert.ok(
    !everything.includes('class='),
    "a class is a decision about looks, and that decision is the design team's",
  )
})

test('ui contract: every input disables browser autocomplete', () => {
  const missing: string[] = []
  for (const file of globSync('packages/ketsuite/src/**/*.{ts,tsx,mjs}')) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/<input\b[^>]*>/g)) {
      if (/\bautocomplete="off"/.test(match[0])) continue
      const line = source.slice(0, match.index).split('\n').length
      missing.push(`${file}:${line}`)
    }
  }
  assert.deepEqual(missing, [], 'new inputs must not restore browser autocomplete')
})

test('table selection: the checkbox cell is a navigation dead zone', () => {
  const source = readFileSync('packages/ketsuite/src/ui/client/table-selection-view.tsx', 'utf8')
  const selectionGuard = source.indexOf('[data-ui="select-cell"]')
  const linkedRowNavigation = source.indexOf('[data-ui="row"][data-row-href]')
  assert.ok(selectionGuard >= 0, 'the selection-cell guard must remain declared')
  assert.ok(linkedRowNavigation >= 0, 'linked-row navigation must remain declared')
  assert.ok(
    selectionGuard < linkedRowNavigation,
    'the selection-cell guard must run before linked-row navigation',
  )
})

test('catalogue: covers empty, long, blocked and error, not just the happy path', () => {
  const ids = CASES.map((c) => c.id)
  for (const needed of ['pages-empty', 'pages-long', 'kit-form', 'state-error']) {
    assert.ok(
      ids.includes(needed),
      `the catalogue must show "${needed}" — a design that skips it gets built twice`,
    )
  }
  const html = renderToString(cataloguePage(_))
  assert.equal([...html.matchAll(/data-ui="catalogue-case"/g)].length, CASES.length)
  for (const entry of CASES) {
    assert.match(html, new RegExp(`href="#${entry.id}"`))
  }
  assert.ok(
    CASES.every((c) => c.note.length > 10),
    'every case says what it is testing',
  )
})

test('backend root opens the first screen contributed by this deployment', async () => {
  const factory = backend.routes['/admin'] as (ctx: ServeContext) => Route
  const menu: MenuNode[] = [
    {
      id: 'business',
      label: 'Business',
      path: null,
      icon: null,
      active: false,
      children: [
        {
          id: 'partners',
          label: 'Partners',
          path: '/admin/partners',
          icon: null,
          active: false,
          children: [],
        },
      ],
    },
  ]
  const route = factory({ menu: async () => menu } as unknown as ServeContext)
  const result = await route(new URL('http://ket.local/admin'), { headers: {} } as never, {})

  assert.equal(result.status, 303)
  assert.equal(result.headers?.location, '/admin/partners')
})
