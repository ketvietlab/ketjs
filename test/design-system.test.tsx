import assert from 'node:assert/strict'
import { globSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  AppShell,
  ActionMenu,
  Badge,
  BoardPage,
  Button,
  ConfirmDialog,
  Combobox,
  DatePicker,
  DateRangePicker,
  DateTimePicker,
  DashboardPage,
  DataTable,
  Disclosure,
  Field,
  FileUpload,
  FormPage,
  HOOKS,
  IconButton,
  LinkButton,
  Menu,
  MoneyField,
  MultiCombobox,
  ListChrome,
  ListPage,
  ModalSheet,
  NavList,
  Progress,
  Popover,
  RadioGroup,
  RelationPicker,
  RecordForm,
  RecordPage,
  Surface,
  Skeleton,
  Spinner,
  Switch,
  TagPicker,
  Tabs,
  TextArea,
  TextField,
  TimePicker,
  ToastRegion,
  Tooltip,
} from '@ketvietlab/design-system'
import {
  CataloguePage,
  InventoryPage,
  PageSurfacePreview,
  componentGroups,
  componentRegistry,
  designSystemInventory,
} from '@ketvietlab/design-system/catalogue'

const css = globSync('packages/design-system/src/**/*.css')
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')
const primitiveCss = [
  'packages/design-system/src/primitives/actions/styles.css',
  'packages/design-system/src/primitives/status/styles.css',
  'packages/design-system/src/primitives/feedback/styles.css',
  'packages/design-system/src/primitives/field/styles.css',
  'packages/design-system/src/primitives/navigation/styles.css',
  'packages/design-system/src/primitives/progress/styles.css',
]
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')
const layoutCss = globSync('packages/design-system/src/layouts/*/*.css')
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')
const patternCss = [
  'packages/design-system/src/patterns/list-page/styles.css',
  'packages/design-system/src/patterns/data-table/styles.css',
  'packages/design-system/src/patterns/list-chrome/styles.css',
  'packages/design-system/src/patterns/record-form/styles.css',
  'packages/design-system/src/patterns/modal-sheet/styles.css',
  'packages/design-system/src/patterns/list-page/responsive.css',
  'packages/design-system/src/patterns/pipeline/styles.css',
  'packages/design-system/src/patterns/board-page/styles.css',
  'packages/design-system/src/patterns/dashboard-page/styles.css',
  'packages/design-system/src/patterns/form-page/styles.css',
  'packages/design-system/src/patterns/record-page/styles.css',
  'packages/design-system/src/patterns/workspace-page/styles.css',
]
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')

test('design system: every required CSS token reference resolves', () => {
  const definitions = new Set([...css.matchAll(/(--kv-[\w-]+)\s*:/g)].map((match) => match[1]))
  const references = [...css.matchAll(/var\((--kv-[\w-]+)\)/g)].map((match) => match[1])
  assert.deepEqual([...new Set(references.filter((name) => !definitions.has(name)))], [])
})

test('design system: loading links cannot navigate and bulk actions submit their form', () => {
  const loading = renderToString(<LinkButton label="Opening" href="/record" loading />)
  assert.match(loading, /<button[^>]*disabled[^>]*aria-busy="true"/)
  assert.doesNotMatch(loading, /href=/)
  const bulk = renderToString(
    <ListChrome
      bulk={{
        form: 'orders',
        selectedCount: 1,
        actions: [{ id: 'approve', label: 'Approve', name: 'intent', value: 'approve' }],
      }}
    />,
  )
  assert.match(bulk, /type="submit"[^>]*name="intent"[^>]*value="approve"[^>]*form="orders"/)
})

test('design system: constrained fields and invalid nested groups preserve their semantics', () => {
  const field = renderToString(
    <Field id="limit" name="limit" label="Limit" type="decimal" min={0} max={100} readOnly value={42} />,
  )
  assert.match(field, /readonly[^>]*min="0"[^>]*max="100"/)
  const group = renderToString(
    <Field
      id="address"
      name="address"
      label="Address"
      error="Check address"
      fields={[{ id: 'street', name: 'street', label: 'Street' }]}
    />,
  )
  assert.match(group, /<details[^>]*open/)
  assert.match(group, /id="address-error"[^>]*>[\s\S]*?Check address/)
  const table = renderToString(
    <DataTable
      rows={[{ id: '1' }]}
      id={(row) => row.id}
      selection={{ form: 'bulk' }}
      columns={[{ key: 'id', label: 'ID', cell: (row) => row.id }]}
    />,
  )
  assert.match(table, /data-ui="row-select"[^>]*form="bulk"/)
})

test('design system: every component hook has an explicit stylesheet rule', () => {
  const missing = HOOKS.filter((hook) => !css.includes(`[data-ui="${hook}"]`))
  assert.deepEqual(missing, [])
})

test('design system: foundations expose reference, semantic and component tokens', () => {
  const tokens = readFileSync('packages/design-system/src/foundations/tokens.css', 'utf8')
  assert.match(tokens, /--kv-ref-bg-main: #1b1f24/)
  assert.match(tokens, /--kv-ref-primary: #5968df/)
  assert.match(tokens, /--kv-page-bg:/)
  assert.match(tokens, /--kv-panel-bg:/)
  assert.match(tokens, /--kv-accent:/)
  assert.match(tokens, /--kv-action-primary-bg:/)
  assert.match(tokens, /--kv-input-bg:/)
  assert.match(tokens, /--kv-table-header-height: 2\.625rem/)
  assert.match(tokens, /--kv-radius-md: 0\.4375rem/)
  assert.match(tokens, /--kv-radius-app-region: 0/)
  assert.match(tokens, /--kv-font-sans: "Inter"/)
  assert.match(tokens, /--kv-font-display: var\(--kv-font-sans\)/)
  assert.doesNotMatch(tokens, /Iowan Old Style|Palatino Linotype|ui-serif/)
})

test('design system: section headings are unframed across page patterns', () => {
  const layouts = layoutCss
  const patterns = patternCss
  const heading = layouts.match(/\[data-ui="section-head"\]\s*\{([^}]+)\}/)?.[1]
  assert.ok(heading)
  assert.match(heading, /align-items: flex-start/)
  assert.doesNotMatch(heading, /border|padding/)
  assert.doesNotMatch(patterns, /\[data-ui="section-head"\]/)
  assert.doesNotMatch(patterns, /\[data-ui="section"\]\s*\{[^}]*(?:border|padding)/)
})

test('design system: titled forms and tables own one surface with an internal heading', () => {
  const form = renderToString(
    <Surface title="Main information" body={<RecordForm action="/save" fields={[]} submitLabel="Save" />} />,
  )
  assert.match(
    form,
    /data-ui="surface-head"[\s\S]*data-ui="surface-title"[\s\S]*Main information[\s\S]*data-ui="record-form"/,
  )
  for (const rows of [[], [{ id: 'A' }]]) {
    const table = renderToString(
      <DataTable
        title="Orders"
        actions={<LinkButton label="View all" href="/orders" />}
        rows={rows}
        id={(row) => row.id}
        columns={[{ key: 'id', label: 'ID', cell: (row) => row.id }]}
      />,
    )
    assert.equal([...table.matchAll(/data-ui="surface"/g)].length, 1)
    assert.match(table, /data-ui="surface-title"[\s\S]*Orders/)
    assert.match(table, /data-ui="surface-actions"/)
    if (rows.length) {
      assert.match(table, /data-ui="table-scroll" data-framed="false"/)
      assert.match(table, /data-ui="table" aria-label="Orders"/)
    } else assert.match(table, /data-ui="empty"/)
  }
  const plain = renderToString(<DataTable rows={[{ id: 'A' }]} id={(row) => row.id} columns={[]} />)
  assert.doesNotMatch(plain, /data-ui="surface"|data-framed="false"/)
})

test('design system: catalogue titled forms and tables keep headings inside their surface', () => {
  const catalogue = renderToString(<CataloguePage theme="light" mode="all" />)
  const formPage = catalogue.slice(catalogue.indexOf('id="form-page"'), catalogue.indexOf('id="record-form"'))
  const formBody = formPage.slice(
    formPage.indexOf('data-ui="form-page-body"'),
    formPage.indexOf('data-ui="form-page-aside"'),
  )
  assert.match(formBody, /data-ui="surface-title"[^>]*>[\s\S]*Main information/)
  assert.doesNotMatch(formBody, /data-ui="section-title"/)
  const recordPage = catalogue.slice(
    catalogue.indexOf('id="record-page"'),
    catalogue.indexOf('id="workspace-flow"'),
  )
  assert.match(recordPage, /data-ui="surface-title"[^>]*>[\s\S]*Main information/)
  assert.match(recordPage, /data-ui="surface-title"[^>]*>[\s\S]*Recent orders/)
  assert.doesNotMatch(recordPage, /data-ui="section-title"/)
  const listPage = catalogue.slice(
    catalogue.indexOf('id="list-page"'),
    catalogue.indexOf('id="dashboard-page"'),
  )
  assert.match(listPage, /data-ui="surface-title"[^>]*>[\s\S]*Order list/)
  assert.doesNotMatch(listPage, /data-ui="list-page-footer"/)
})

test('design system: flat workspace is opt-in and keeps sidebar styling independent', () => {
  const flat = readFileSync('packages/design-system/src/layouts/flat/styles.css', 'utf8')
  assert.match(flat, /\[data-kv-design-system\]\[data-presentation="flat"\]/)
  assert.match(flat, /color-scheme: light/)
  assert.match(flat, /--kv-page-bg: var\(--kv-ref-white\)/)
  assert.match(flat, /border-radius: 0/)
  assert.doesNotMatch(flat, /\[data-ui="app-sidebar"\]/)
  const entry = readFileSync('packages/design-system/src/styles.css', 'utf8')
  assert.match(entry, /layouts\/flat\/styles\.css/)
})

test('design system: grouped workspace keeps a grey canvas and borderless context contents', () => {
  const grouped = readFileSync('packages/design-system/src/layouts/grouped/styles.css', 'utf8')
  assert.match(grouped, /\[data-kv-design-system\]\[data-presentation="grouped"\]/)
  assert.match(grouped, /color-scheme: light/)
  assert.match(grouped, /--kv-page-bg: light-dark\(#f6f6f7,/)
  assert.match(grouped, /--kv-sidebar-bg: light-dark\(#f7f5f5,/)
  assert.match(grouped, /--kv-sidebar-border: light-dark\(#e9e7e8,/)
  assert.match(grouped, /--kv-nav-selected: light-dark\(#eef0fb,/)
  assert.match(
    readFileSync('packages/design-system/src/foundations/tokens.css', 'utf8'),
    /--kv-ref-accent-100: #efe9e7/,
  )
  assert.match(grouped, /--kv-panel-border: light-dark\(#e2e4e8,/)
  assert.match(grouped, /background: var\(--kv-page-bg\)/)
  assert.match(grouped, /--kv-page-chrome-bg: var\(--kv-page-bg\)/)
  assert.match(grouped, /--kv-page-padding-x: var\(--kv-space-3\)/)
  assert.match(grouped, /gap: var\(--kv-space-2\)/)
  assert.match(grouped, /\[data-ui="surface-head"\] \{\s*padding: 0;\s*margin-bottom: var\(--kv-space-3\)/)
  assert.match(
    grouped,
    /\[data-ui="table-scroll"\]\[data-framed="false"\] \{\s*width: auto;\s*margin-inline: 0/,
  )
  assert.match(grouped, /padding: var\(--kv-space-3\) var\(--kv-page-padding-x\)/)
  assert.match(grouped, /\[data-ui="record-page-aside"\] \[data-ui="metric"\]/)
  assert.doesNotMatch(grouped, /\[data-ui="app-sidebar"\]/)
  assert.match(readFileSync('packages/design-system/src/styles.css', 'utf8'), /layouts\/grouped\/styles\.css/)
})

test('design system: titled tables use the demo card inset', () => {
  const layouts = layoutCss
  const patterns = patternCss
  assert.match(
    layouts,
    /\[data-ui="surface"\]\[data-padding="none"\]\[data-has-heading="true"\] \{\s*padding: var\(--kv-space-3\)/,
  )
  assert.match(
    layouts,
    /\[data-padding="none"\]\[data-has-heading="true"\]\s*>\s*\[data-ui="surface-head"\] \{\s*padding: 0;\s*margin-bottom: var\(--kv-space-3\)/,
  )
  assert.match(
    patterns,
    /\[data-ui="table-scroll"\]\[data-framed="false"\][\s\S]*?width: auto;\s*margin-inline: 0/,
  )
})

test('design system: card surfaces use the shared radius scale', () => {
  const layouts = layoutCss
  const metricRule = layouts.match(/\[data-ui="metric"\]\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? ''
  assert.match(metricRule, /border-radius: var\(--kv-radius-md\)/)
  assert.doesNotMatch(metricRule, /border-radius:\s*0/)
})

test('design system: application regions are square while independent objects are rounded', () => {
  const shellCss = readFileSync('packages/design-system/src/layouts/shell/styles.css', 'utf8')
  for (const hook of ['app-sidebar', 'app-main', 'app-right-rail']) {
    const rule = shellCss.match(new RegExp(`\\[data-ui="${hook}"\\]\\s*\\{(?<body>[^}]+)\\}`))?.groups?.body
    assert.match(rule ?? '', /border-radius: var\(--kv-radius-app-region\)/)
  }

  const shell = renderToString(<AppShell sidebar="Menu" main="Content" rightRail="Context" />)
  assert.match(shell, /data-has-right-rail="true"/)
  assert.match(shell, /data-ui="app-right-rail"/)
})

test('design system: a stacked FormPage rail keeps space above its content', () => {
  assert.match(
    css,
    /@media \(max-width: 63\.9375rem\)[\s\S]*?\[data-ui="form-page-aside"\][\s\S]*?padding-top: var\(--kv-space-5\)/,
  )
})

test('design system: an operational ListPage body keeps a dense header gap', () => {
  const patterns = patternCss
  const rule =
    patterns.match(
      /\[data-ui="list-page"\]\[data-variant="operational"\]\s*\[data-ui="list-page-body"\]\s*\{(?<body>[^}]+)\}/,
    )?.groups?.body ?? ''
  assert.match(rule, /padding-top: var\(--kv-space-2\)/)
})

test('design system: canonical page titles share one dense hierarchy', () => {
  const patterns = patternCss
  const kinds = ['list-page', 'record-page', 'form-page', 'dashboard-page', 'board-page']
  for (const kind of kinds) {
    const hook = `${kind}-title`
    const rule = patterns.match(new RegExp(`\\[data-ui="${hook}"\\]\\s*\\{(?<body>[^}]+)\\}`))?.groups?.body
    assert.match(rule ?? '', /font-size: var\(--kv-page-title-size\)/, hook)
    assert.match(rule ?? '', /margin: 0/, hook)
    assert.match(rule ?? '', /line-height: var\(--kv-leading-tight\)/, hook)

    const heading = patterns.match(new RegExp(`\\[data-ui="${kind}-heading"\\]\\s*\\{(?<body>[^}]+)\\}`))
      ?.groups?.body
    assert.match(heading ?? '', /gap: var\(--kv-space-1\)/, `${kind}-heading`)

    const description = patterns.match(
      new RegExp(`\\[data-ui="${kind}-description"\\]\\s*\\{(?<body>[^}]+)\\}`),
    )?.groups?.body
    assert.match(description ?? '', /margin: 0/, `${kind}-description`)
    assert.match(description ?? '', /line-height: var\(--kv-leading-normal\)/, `${kind}-description`)
  }
  assert.match(patterns, /--kv-page-title-size: 1\.5rem/)
  assert.equal((patterns.match(/font-size: var\(--kv-text-lg\)/g) ?? []).length >= 4, true)
})

test('design system: canonical page headers share compact responsive padding', () => {
  const patterns = patternCss
  const compactPadding = /padding: var\(--kv-space-4\) var\(--kv-space-4\) var\(--kv-space-3\)/g
  assert.equal((patterns.match(compactPadding) ?? []).length >= 4, true)
})

test('design system: light page surfaces use component roles without changing the palette', () => {
  const tokens = readFileSync('packages/design-system/src/foundations/tokens.css', 'utf8')
  const patterns = patternCss
  assert.match(tokens, /--kv-page-chrome-bg: light-dark\(var\(--kv-page-bg\), var\(--kv-panel-bg\)\)/)
  assert.match(tokens, /--kv-page-content-bg: var\(--kv-page-bg\)/)
  assert.match(tokens, /--kv-table-bg: light-dark\(var\(--kv-panel-bg\), transparent\)/)
  for (const kind of ['list-page', 'record-page', 'form-page', 'dashboard-page', 'board-page']) {
    for (const region of ['context', 'header']) {
      const rule = patterns.match(
        new RegExp(
          `\\[data-ui="${kind}"\\]\\[data-variant="operational"\\]\\s*\\[data-ui="${kind}-${region}"\\]\\s*\\{([^}]+)\\}`,
        ),
      )?.[1]
      assert.match(rule ?? '', /background: var\(--kv-page-chrome-bg\)/, `${kind}-${region}`)
    }
  }
  for (const kind of ['record-page', 'form-page']) {
    const rule = patterns.match(new RegExp(`\\[data-ui="${kind}-body"\\]\\s*\\{([^}]+)\\}`))?.[1]
    assert.match(rule ?? '', /background: var\(--kv-page-content-bg\)/, `${kind}-body`)
  }
  assert.match(patterns, /\[data-ui="form-page-aside"\]\s*\{[^}]*background: var\(--kv-panel-bg-subtle\)/)
  assert.doesNotMatch(
    patterns,
    /\[data-ui="form-page-body"\] \[data-ui="surface"\]\s*\{[^}]*background: transparent/,
  )
})

test('design system: workspace canvas stays grey between independent white surfaces', () => {
  const patterns = patternCss
  const layouts = layoutCss
  for (const hook of ['dashboard-page', 'dashboard-page-body', 'board-page']) {
    const rule = patterns.match(new RegExp(`\\[data-ui="${hook}"\\]\\s*\\{([^}]+)\\}`))?.[1]
    assert.match(rule ?? '', /background: var\(--kv-page-bg\)/, hook)
    assert.doesNotMatch(rule ?? '', /background: var\(--kv-page-content-bg\)/, hook)
  }
  for (const hook of ['surface', 'content-card', 'metric']) {
    const rule = layouts.match(new RegExp(`\\[data-ui="${hook}"\\]\\s*\\{([^}]+)\\}`))?.[1]
    assert.match(rule ?? '', /background: var\(--kv-panel-bg\)/, hook)
  }
})

test('design system: stacked tables own labels and release fixed desktop row heights', () => {
  const props = {
    columns: [{ key: 'name', label: 'Display name', cell: (row: { name: string }) => row.name }],
    rows: [{ name: 'Example' }],
    id: (row: { name: string }) => row.name,
  }
  const stacked = renderToString(<DataTable {...props} responsive="stack" />)
  const scrolling = renderToString(<DataTable {...props} />)
  assert.match(stacked, /data-responsive="stack"/)
  assert.match(stacked, /data-label="Display name"/)
  assert.match(scrolling, /data-responsive="scroll"/)
  assert.doesNotMatch(scrolling, /data-label=/)
  for (const hook of ['row', 'cell']) {
    assert.match(
      css,
      new RegExp(`\\[data-responsive="stack"\\] \\[data-ui="${hook}"\\]\\s*\\{[^}]*height: auto`),
    )
  }
})

test('design system: operational tables expose sort, selection, grouping and row navigation', () => {
  type Row = { id: string; customer: string; total: string; state: string }
  const rows: Row[] = [
    { id: 'SO-1042', customer: 'Công ty Ánh Dương', total: '18.450.000 ₫', state: 'Ready' },
    { id: 'SO-1041', customer: 'Khách sạn Mùa Hạ', total: '6.800.000 ₫', state: 'Review' },
  ]
  const table = renderToString(
    <DataTable
      caption="Orders"
      rows={[] as Row[]}
      id={(row) => row.id}
      responsive="stack"
      gutter="compact"
      rowHref={(row) => `#${row.id}`}
      selection={{ selectedIds: ['SO-1042'] }}
      groups={[
        {
          id: 'ready',
          label: 'Ready to invoice',
          count: 2,
          rows,
          pager: { label: '2 shown', nextHref: '#next' },
        },
      ]}
      columns={[
        {
          key: 'id',
          label: 'Order',
          cell: (row) => row.id,
          priority: 'primary',
          sort: { href: '#sort', direction: 'descending' },
        },
        { key: 'customer', label: 'Customer', cell: (row) => row.customer },
        { key: 'total', label: 'Total', cell: (row) => row.total, align: 'end', hidden: true },
      ]}
    />,
  )
  assert.match(table, /data-ui="select-all"/)
  assert.match(table, /data-ui="row-select"[^>]*value="SO-1042"[^>]*checked/)
  assert.match(table, /data-ui="sort-link"[^>]*href="#sort"/)
  assert.match(table, /aria-sort="descending"/)
  assert.match(table, /data-ui="group-row"[^>]*data-group="ready"/)
  assert.match(table, /data-ui="group-count"[^>]*>[\s\S]*2/)
  assert.match(table, /data-ui="group-pager"[\s\S]*2 shown/)
  assert.equal([...table.matchAll(/data-ui="row-link"/g)].length, rows.length)
  assert.doesNotMatch(table, /data-ui="(?:row-actions|cell-actions|col-config)"/)
  assert.doesNotMatch(table, /data-col="table-actions"/)
  assert.doesNotMatch(table, /data-col="total"/)

  const selectRule =
    [...patternCss.matchAll(/\[data-ui="select-cell"\]\s*\{(?<body>[^}]+)\}/g)]
      .map((match) => match.groups?.body ?? '')
      .find((body) => body.includes('padding:')) ?? ''
  assert.match(selectRule, /min-width: 3\.5rem/)
  assert.match(selectRule, /padding: 0\.4375rem var\(--kv-space-3\)/)
})

test('design system: ListChrome assembles URL-driven collection controls', () => {
  const chrome = renderToString(
    <ListChrome
      search={{ action: '/orders', value: 'Mùa Hạ', hidden: { state: 'ready' } }}
      facets={[
        { id: 'all', label: 'All', href: '/orders', active: true, count: 148 },
        { id: 'review', label: 'Review', href: '/orders?state=review', count: 7 },
      ]}
      views={[
        { id: 'table', label: 'Table', href: '/orders?view=table', active: true },
        { id: 'kanban', label: 'Kanban', href: '/orders?view=kanban' },
      ]}
      sort={{
        action: '/orders',
        choices: [
          { value: 'date-desc', label: 'Newest first', selected: true },
          { value: 'total-desc', label: 'Largest total' },
        ],
      }}
      status="148 orders"
      actions={<Button label="Create" variant="primary" />}
      bulk={{
        selectedCount: 2,
        summary: '2 selected',
        clearHref: '/orders',
        actions: [{ id: 'export', label: 'Export', name: 'intent', value: 'export' }],
      }}
      pager={{
        summary: 'Showing 1-25 of 148',
        nextHref: '/orders?page=2',
        pages: [{ label: '1', href: '/orders', active: true }],
      }}
    />,
  )
  assert.match(chrome, /data-ui="list-chrome"/)
  assert.match(chrome, /data-ui="list-search"[^>]*role="search"/)
  assert.match(chrome, /type="hidden" name="state" value="ready"/)
  assert.match(chrome, /data-ui="list-facet"[^>]*data-active="true"/)
  assert.match(chrome, /data-ui="list-view"[^>]*data-active="true"/)
  assert.match(chrome, /data-ui="list-sort-select"/)
  assert.match(chrome, /data-ui="bulk-actions"[^>]*data-has-selection="true"/)
  assert.match(chrome, /data-ui="pager-bar"/)
  assert.match(chrome, /data-ui="pager-link"[^>]*rel="next"/)
  assert.match(
    chrome,
    /data-row="query"[\s\S]*data-ui="list-search"[\s\S]*data-row="tail"[\s\S]*data-row="filters"[\s\S]*data-ui="list-facets"[\s\S]*data-ui="pager-bar"/,
  )
  assert.doesNotMatch(renderToString(<ListChrome />), /data-row="query"[\s\S]*data-ui="list-search"/)
  const patterns = patternCss
  assert.match(patterns, /\[data-row="query"\] \{\s*flex-wrap: nowrap;\s*align-items: center/)
  assert.match(patterns, /\[data-ui="list-search"\] \{\s*display: flex;\s*flex: 1 1 16rem/)
  assert.match(patterns, /max-width: 32rem/)
  assert.match(patterns, /\[data-row="filters"\] \{\s*flex: 0 1 auto;\s*min-width: 0/)
  assert.match(patterns, /\[data-row="tail"\] \{\s*flex: 0 1 auto/)
  assert.match(patterns, /\[data-row="meta"\] \{\s*flex: 0 0 auto/)
  assert.match(patterns, /\[data-ui="pager-bar"\] \{\s*display: flex;\s*flex-wrap: nowrap/)
  assert.match(patterns, /\[data-ui="bulk-actions"\]:not\(\[data-has-selection="true"\]\) \{\s*display: none/)
})

test('design system: FormPage does not nest a second main landmark inside AppShell', () => {
  const html = renderToString(
    <AppShell
      sidebar="Menu"
      main={<FormPage title="Supplier" body="Partner fields" aside="Record facts" />}
    />,
  )
  assert.equal([...html.matchAll(/<main\b/g)].length, 1)
  assert.match(html, /<div data-ui="form-page-body">[\s\S]*Partner fields[\s\S]*<\/div>/)
})

test('design system: RecordPage renders a record surface rather than the form compatibility hook', () => {
  const recordPage = renderToString(
    <RecordPage
      variant="operational"
      context="Customers / CUS-0042"
      title="Mùa Hạ Riverside"
      description="Customer record"
      actions={<Button label="Edit" />}
      body="Record fields"
      aside="Record facts"
      asideLabel="Customer context"
    />,
  )
  assert.match(recordPage, /<section data-ui="record-page"[^>]*data-pattern="record"/)
  assert.match(recordPage, /data-ui="record-page-title-row"[\s\S]*?data-ui="record-page-actions"/)
  assert.match(recordPage, /data-ui="record-page-layout"[\s\S]*?data-ui="record-page-aside"/)
  assert.doesNotMatch(recordPage, /data-ui="form-page"/)

  const preview = renderToString(
    <PageSurfacePreview
      kind="record"
      state="baseline"
      lang="vi"
      theme="light"
      tab="details"
      aside
      controls
    />,
  )
  assert.match(preview, /data-ui="record-page"/)
  assert.doesNotMatch(preview, /data-ui="form-page"/)
})

test('design system: form rows collapse while field pairs remain inline', () => {
  const primitives = primitiveCss
  assert.match(primitives, /grid-template-columns: minmax\(0, min\(35%, 9rem\)\) minmax\(0, 1fr\)/)
  const patterns = patternCss
  const compatibility = readFileSync('packages/ketsuite/src/modules/backend/design/forms.css', 'utf8')
  const partner = readFileSync('packages/ketsuite/src/modules/partner_backend/client/partner.css', 'utf8')
  for (const source of [patterns, compatibility]) {
    assert.match(source, /@media \(max-width: 47\.9375rem\)/)
    assert.match(source, /grid-template-columns: minmax\(0, 1fr\)/)
  }
  assert.doesNotMatch(patterns, /minmax\(5\.25rem, 6\.25rem\)/)
  assert.doesNotMatch(compatibility, /minmax\(5\.25rem, 6\.25rem\)/)
  assert.doesNotMatch(partner, /\[data-ui="form-field"\]/)
})

test('design system: controls preserve their native semantics and accessible state', () => {
  const button = renderToString(<Button label="Saving" variant="primary" loading />)
  assert.match(button, /^<button/)
  assert.match(button, /aria-busy="true"/)
  assert.match(button, /disabled/)
  assert.match(button, /data-ui="action-spinner"/)

  const field = renderToString(
    <Field
      id="slug"
      name="slug"
      label="Slug"
      value="Not valid"
      help="Lowercase only"
      error="Use lowercase letters"
    />,
  )
  assert.match(field, /for="slug"/)
  assert.match(field, /aria-invalid="true"/)
  assert.match(field, /aria-describedby="slug-help slug-error"/)

  const disclosure = renderToString(
    <Disclosure summary="Permission provenance" body="Managed template sales.viewer" open />,
  )
  assert.match(disclosure, /^<details/)
  assert.match(disclosure, / open/)
  assert.match(
    disclosure,
    /<summary data-ui="disclosure-summary">[\s\S]*?Permission provenance[\s\S]*?<\/summary>/,
  )
})

test('design system: fields cover operational form controls and nested groups', () => {
  const decimal = renderToString(
    <Field id="amount" name="amount" label="Amount" type="decimal" value="12.5" required />,
  )
  assert.match(decimal, /type="number"/)
  assert.match(decimal, /step="any"/)
  assert.match(decimal, /data-ui="field-required"/)

  const checkboxGroup = renderToString(
    <Field
      id="channels"
      name="channels"
      label="Channels"
      type="checkbox-group"
      options={[
        { value: 'email', label: 'Email', checked: true },
        { value: 'sms', label: 'SMS' },
      ]}
    />,
  )
  assert.match(checkboxGroup, /role="group" aria-labelledby="channels-label"/)
  assert.match(checkboxGroup, /data-ui="field-option-input"[^>]*type="checkbox"/)

  const grouped = renderToString(
    <Field
      id="schedule"
      name="schedule"
      label="Schedule"
      open
      fields={[
        { id: 'starts-at', name: 'startsAt', label: 'Starts at', type: 'datetime-local' },
        { id: 'accent', name: 'accent', label: 'Accent', type: 'color', value: '#5968df' },
      ]}
    />,
  )
  assert.match(grouped, /data-ui="field"[^>]*data-kind="group"/)
  assert.match(grouped, /data-ui="disclosure"/)
  assert.match(grouped, /type="datetime-local"/)
  assert.match(grouped, /type="color"/)

  const custom = renderToString(
    <Field
      id="partner"
      name="partner"
      label="Partner"
      control={<ket-relation-picker data-ui="field-control" name="partner" value="CUS-0042" />}
    />,
  )
  assert.match(custom, /<ket-relation-picker/)
  assert.match(custom, /for="partner"/)
})

test('design system: modal sheets expose route metadata and become fullscreen on mobile', () => {
  const modal = renderToString(
    <ModalSheet
      id="edit-order"
      title="Edit order"
      description="Review fields before saving."
      closeHref="/orders"
      closeLabel="Close"
      presentation="dialog"
      size="large"
      unsavedPrompt="Discard changes?"
      body="Order fields"
      actions={<Button label="Save" variant="primary" />}
    />,
  )
  assert.match(modal, /data-ui="modal-layer"[^>]*data-route-modal="true"/)
  assert.match(modal, /data-presentation="dialog"/)
  assert.match(modal, /data-unsaved-prompt="Discard changes\?"/)
  assert.match(modal, /data-ui="modal-sheet"[^>]*data-size="large"/)
  assert.match(modal, /role="dialog"/)
  assert.match(modal, /aria-modal="true"/)
  assert.match(modal, /aria-labelledby="edit-order-title"/)
  assert.match(modal, /aria-describedby="edit-order-description"/)
  assert.match(modal, /tabindex="-1"/)
  assert.match(modal, /data-ui="modal-description"/)
  assert.match(modal, /data-ui="modal-actions"[\s\S]*Save/)

  assert.match(
    css,
    /@media \(max-width: 47\.9375rem\)[\s\S]*?\[data-ui="modal-sheet"\]\[data-size\][\s\S]*?height: 100dvh/,
  )
  assert.match(
    css,
    /@media \(max-width: 47\.9375rem\)[\s\S]*?\[data-ui="modal-sheet"\]\[data-size\][\s\S]*?border-radius: 0/,
  )
})

test('design system: action labels leave room for Vietnamese diacritics while truncating', () => {
  const primitives = primitiveCss
  const rule = primitives.match(/\[data-ui="action-label"\]\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? ''
  assert.match(rule, /min-width: 0/)
  assert.match(rule, /overflow: hidden/)
  assert.match(rule, /line-height: var\(--kv-leading-normal\)/)
  assert.match(rule, /text-overflow: ellipsis/)
})

test('design system: generic patterns need no translator or KetSuite domain', () => {
  const listPage = renderToString(
    <ListPage
      eyebrow="Catalogue"
      title="Products"
      description="Manage the sellable catalogue."
      actions={<Button label="Create" variant="primary" />}
      controls="Search and filters"
      status="24 products"
      body="Product rows"
      footer="End of results"
    />,
  )
  assert.match(listPage, /<section data-ui="list-page"[^>]*data-pattern="list">/)
  assert.match(listPage, /data-ui="list-page-eyebrow"[^>]*>[\s\S]*?Catalogue/)
  assert.match(listPage, /data-ui="list-page-title"[^>]*>[\s\S]*?Products/)
  assert.match(listPage, /data-ui="list-page-title-row"[\s\S]*?data-ui="list-page-actions"/)
  assert.match(listPage, /data-ui="list-page-toolbar"/)
  assert.match(listPage, /data-ui="list-page-controls"[^>]*>[\s\S]*?Search and filters/)
  assert.match(listPage, /data-ui="list-page-status"[^>]*>[\s\S]*?24 products/)

  const operationalList = renderToString(
    <ListPage
      variant="operational"
      context="Sales / Sales orders"
      title="Sales orders"
      controls="Search orders"
      body="Order rows"
      status="148 orders"
    />,
  )
  assert.match(operationalList, /data-ui="list-page"[^>]*data-variant="operational"/)
  assert.match(
    operationalList,
    /data-ui="list-page-context"[^>]*>[\s\S]*?Sales \/ Sales orders[\s\S]*?data-ui="list-page-header"/,
  )
  assert.match(
    operationalList,
    /data-ui="list-page-body"[^>]*>[\s\S]*?Order rows[\s\S]*?data-ui="list-page-footer"[^>]*>[\s\S]*?148 orders/,
  )
  assert.match(operationalList, /data-ui="list-page-toolbar"[\s\S]*?Search orders/)
  assert.doesNotMatch(operationalList, /data-ui="list-page-status"/)

  const dashboardPage = renderToString(
    <DashboardPage
      variant="operational"
      context="Sales / Overview"
      eyebrow="Commercial workspace"
      title="Sales overview"
      description="Demand and confirmed revenue"
      actions={<Button label="Create quotation" variant="primary" />}
      body="Sales metrics"
    />,
  )
  assert.match(dashboardPage, /data-ui="dashboard-page"[^>]*data-variant="operational"/)
  assert.match(
    dashboardPage,
    /data-ui="dashboard-page-context"[^>]*>[\s\S]*?Sales \/ Overview[\s\S]*?data-ui="dashboard-page-header"/,
  )
  assert.match(dashboardPage, /data-ui="dashboard-page-title-row"[\s\S]*?data-ui="dashboard-page-actions"/)
  assert.match(dashboardPage, /data-ui="dashboard-page-body"[^>]*>[\s\S]*?Sales metrics/)

  const boardPage = renderToString(
    <BoardPage
      variant="operational"
      context="CRM / Pipeline"
      eyebrow="Pipeline"
      title="Sales opportunities"
      description="Move active opportunities"
      actions={<Button label="Create opportunity" variant="primary" />}
      controls="Team and owner filters"
      body="Opportunity columns"
    />,
  )
  assert.match(boardPage, /data-ui="board-page"[^>]*data-variant="operational"/)
  assert.match(
    boardPage,
    /data-ui="board-page-context"[^>]*>[\s\S]*?CRM \/ Pipeline[\s\S]*?data-ui="board-page-header"/,
  )
  assert.match(boardPage, /data-ui="board-page-title-row"[\s\S]*?data-ui="board-page-actions"/)
  assert.match(boardPage, /data-ui="board-page-toolbar"[\s\S]*?Team and owner filters/)
  assert.match(boardPage, /data-ui="board-page-body"[^>]*>[\s\S]*?Opportunity columns/)

  const formPage = renderToString(
    <FormPage
      title="ACME Distribution"
      description="Supplier · SUP-001"
      status={<Badge label="Active" tone="positive" />}
      actions={<Button label="Save" variant="primary" />}
      body="Partner fields"
      aside="Record facts"
      asideLabel="Partner context"
    />,
  )
  assert.match(formPage, /<section data-ui="form-page"[^>]*data-has-aside="true"[^>]*>/)
  assert.match(formPage, /data-ui="form-page-title-row"[\s\S]*?data-ui="form-page-actions"/)
  assert.match(formPage, /data-ui="form-page-layout"[\s\S]*?data-ui="form-page-aside"/)
  assert.match(formPage, /aria-label="Partner context"/)
  assert.doesNotMatch(formPage, /data-ui="(?:form-page-back|breadcrumbs)"/)

  const operationalForm = renderToString(
    <FormPage
      variant="operational"
      context="Purchasing / Vendor bill / BILL-0042"
      title="BILL-0042"
      description="Công ty Ánh Dương"
      actions={<Button label="Save" variant="primary" />}
      body="Vendor bill fields"
    />,
  )
  assert.match(operationalForm, /data-ui="form-page"[^>]*data-variant="operational"/)
  assert.match(
    operationalForm,
    /data-ui="form-page-context"[^>]*>[\s\S]*?Purchasing \/ Vendor bill \/ BILL-0042[\s\S]*?data-ui="form-page-header"/,
  )

  const formPageFragment = renderToString(
    <FormPage
      title="Updated product"
      body="Updated fields"
      slots={{
        header: 'product.record-header',
        body: 'product.record-body',
        fragmentTitle: 'Updated product',
      }}
    />,
  )
  assert.match(formPageFragment, /<ket-fragments data-title="Updated product">/)
  assert.deepEqual(
    [...formPageFragment.matchAll(/<template data-ket-slot="([^"]+)"/g)].map((match) => match[1]),
    ['product.record-header', 'product.record-body'],
  )
  assert.doesNotMatch(formPageFragment, /data-ui="form-page-(?:controller|aside)"/)

  const table = renderToString(
    <DataTable
      rows={[{ id: 'one', state: 'Ready' }]}
      id={(row) => row.id}
      columns={[
        { key: 'id', label: 'ID', cell: (row) => row.id },
        { key: 'state', label: 'State', cell: (row) => <Badge label={row.state} tone="positive" /> },
      ]}
    />,
  )
  assert.match(table, /<table data-ui="table">/)
  assert.match(table, /data-row="one"/)

  const selected = renderToString(
    <DataTable
      rows={[{ id: 'one' }]}
      id={(row) => row.id}
      selected={() => true}
      columns={[{ key: 'id', label: 'ID', cell: (row) => row.id }]}
    />,
  )
  assert.match(selected, /data-selected="true"/)

  const form = renderToString(
    <RecordForm
      action="/records"
      fields={[{ id: 'name', name: 'name', label: 'Name' }]}
      submitLabel="Save"
    />,
  )
  assert.match(form, /method="post"/)
  assert.match(form, /data-ui="field"/)
  assert.match(form, />Save</)
})

test('design system: every KetSuite ListPage consumer uses the operational workspace and page context', () => {
  let consumers = 0
  for (const path of globSync('packages/ketsuite/src/modules/**/*.tsx')) {
    const source = readFileSync(path, 'utf8')
    const calls = [...source.matchAll(/<ListPage\b/g)].length
    if (!calls) continue
    consumers += calls
    const operational = [...source.matchAll(/<ListPage\s+variant="operational"/g)].length
    assert.equal(operational, calls, path)
    const contextual = [...source.matchAll(/<ListPage\s+variant="operational"\s+(?:frame|context)=/g)].length
    assert.equal(contextual, calls, path)
  }
  assert.ok(consumers > 0)
})

test('design system: every KetSuite FormPage consumer uses the operational workspace and page context', () => {
  let consumers = 0
  for (const path of globSync('packages/ketsuite/src/modules/**/*.tsx')) {
    const source = readFileSync(path, 'utf8')
    const calls = [...source.matchAll(/<FormPage\b/g)].length
    if (!calls) continue
    consumers += calls
    const operational = [...source.matchAll(/<FormPage\s+variant="operational"/g)].length
    assert.equal(operational, calls, path)
    const contextual = [...source.matchAll(/<FormPage\s+variant="operational"\s+(?:frame|context)=/g)].length
    assert.equal(contextual, calls, path)
  }
  assert.ok(consumers > 0)
})

test('design system: every KetSuite DashboardPage consumer uses the operational workspace and page context', () => {
  let consumers = 0
  for (const path of globSync('packages/ketsuite/src/modules/**/*.tsx')) {
    const source = readFileSync(path, 'utf8')
    const calls = [...source.matchAll(/<DashboardPage\b/g)].length
    if (!calls) continue
    consumers += calls
    const operational = [...source.matchAll(/<DashboardPage\s+variant="operational"/g)].length
    assert.equal(operational, calls, path)
    const contextual = [...source.matchAll(/<DashboardPage\s+variant="operational"\s+(?:frame|context)=/g)]
      .length
    assert.equal(contextual, calls, path)
  }
  assert.equal(consumers, 5)
})

test('design system: every KetSuite BoardPage consumer uses the operational workspace and page context', () => {
  let consumers = 0
  for (const path of globSync('packages/ketsuite/src/modules/**/*.tsx')) {
    const source = readFileSync(path, 'utf8')
    const calls = [...source.matchAll(/<BoardPage\b/g)].length
    if (!calls) continue
    consumers += calls
    const operational = [...source.matchAll(/<BoardPage\s+variant="operational"/g)].length
    assert.equal(operational, calls, path)
    const contextual = [...source.matchAll(/<BoardPage\s+variant="operational"\s+(?:frame|context)=/g)].length
    assert.equal(contextual, calls, path)
  }
  assert.equal(consumers, 6)
})

test('design system: navigation and progress expose semantic state', () => {
  const nav = renderToString(
    <NavList label="Main" items={[{ label: 'Orders', href: '/orders', active: true, count: 7 }]} />,
  )
  assert.match(nav, /aria-current="page"/)
  assert.match(nav, /data-ui="nav-item-count"[^>]*>[\s\S]*7/)

  const tabs = renderToString(
    <Tabs label="Views" items={[{ id: 'all', label: 'All', href: '/all', active: true }]} />,
  )
  assert.match(tabs, /data-ui="tabs"/)
  assert.match(tabs, /aria-current="page"/)

  const progress = renderToString(<Progress label="Complete" value={118} tone="positive" />)
  assert.match(progress, /role="progressbar"/)
  assert.match(progress, /aria-valuenow="100"/)
  assert.match(progress, /width: 100%/)

  const iconAction = renderToString(<IconButton name="theme" label="Toggle theme" icon="moon" pressed />)
  assert.match(iconAction, /^<button/)
  assert.match(iconAction, /data-ui="action" data-icon-only="true"/)
  assert.match(iconAction, /type="button" name="theme"/)
  assert.match(iconAction, /aria-label="Toggle theme" aria-pressed="true"/)
  assert.doesNotMatch(iconAction, /data-ui="action-label"/)
})

test('design system: interaction essentials preserve native and accessible fallbacks', () => {
  const menu = renderToString(
    <Menu
      id="record-actions"
      label="Record actions"
      open
      items={[
        { id: 'open', label: 'Open', href: '/records/1' },
        { id: 'archive', label: 'Archive', value: 'archive', form: 'record', destructive: true },
        { id: 'locked', label: 'Locked', disabled: true },
      ]}
    />,
  )
  assert.match(menu, /^<details[^>]*data-ui="menu"[^>]*open/)
  assert.match(menu, /role="menu" aria-label="Record actions"/)
  assert.match(menu, /role="menuitem" href="\/records\/1"/)
  assert.match(menu, /type="submit" name="intent" value="archive" form="record"/)
  assert.match(menu, /role="menuitem" aria-disabled="true"/)
  assert.match(renderToString(<ActionMenu id="more" label="More" items={[]} />), /data-align="end"/)

  const closed = renderToString(
    <Popover
      id="owner"
      label="Owner"
      trigger="Owner"
      body="Ngọc Linh"
      open={false}
      openHref="?owner=open"
      closeHref="?owner="
      closeLabel="Close"
    />,
  )
  assert.match(closed, /data-ui="popover-trigger"[^>]*href="\?owner=open"/)
  assert.match(closed, /data-ui="popover-trigger"[^>]*aria-expanded="false"/)
  assert.doesNotMatch(closed, /role="dialog"/)
  const open = renderToString(
    <Popover
      id="owner"
      label="Owner"
      trigger="Owner"
      body="Ngọc Linh"
      open
      openHref="?owner=open"
      closeHref="?owner="
      closeLabel="Close"
      placement="top-end"
    />,
  )
  assert.match(open, /data-placement="top-end"/)
  assert.match(open, /role="dialog" aria-label="Owner" tabindex="-1"/)
  const tooltip = renderToString(<Tooltip id="tip" text="Synchronized" trigger="Status" placement="right" />)
  assert.match(tooltip, /data-placement="right"/)
  assert.match(tooltip, /role="tooltip"/)

  const confirm = renderToString(
    <ConfirmDialog
      id="archive"
      title="Archive?"
      message="This remains in history."
      closeHref="/record"
      closeLabel="Cancel"
      confirmLabel="Archive"
      confirmForm="archive-form"
    />,
  )
  assert.match(confirm, /role="dialog"[^>]*aria-modal="true"/)
  assert.match(confirm, /type="submit"[^>]*value="confirm"[^>]*form="archive-form"/)

  const feedback = renderToString(
    <ToastRegion
      label="Notifications"
      toasts={[{ id: 'failed', title: 'Save failed', message: 'Retry later.', tone: 'danger' }]}
    />,
  )
  assert.match(feedback, /aria-live="polite"/)
  assert.match(feedback, /data-ui="toast"[^>]*role="alert"/)
  assert.match(renderToString(<Spinner label="Saving" />), /role="status"/)
  assert.match(
    renderToString(<Skeleton label="Loading record" />),
    /role="status" aria-label="Loading record"/,
  )
})

test('design system: typed form controls preserve native values and controlled picker state', () => {
  const text = renderToString(
    <TextField
      id="customer"
      name="customer"
      label="Customer"
      value="what the user typed"
      issues={[{ path: 'customer', message: 'Choose a customer.' }]}
      required
    />,
  )
  assert.match(text, /value="what the user typed"/)
  assert.match(text, /aria-invalid="true"/)
  assert.match(text, /Choose a customer\./)
  assert.match(
    renderToString(<TextArea id="note" name="note" label="Note" value="preserved" />),
    />preserved<\/textarea>/,
  )
  assert.match(
    renderToString(<MoneyField id="total" name="total" label="Total" value="12.30" />),
    /step="0.01"/,
  )
  assert.match(
    renderToString(<Switch id="notify" name="notify" label="Notify" checked />),
    /role="switch"[^>]*checked/,
  )
  assert.match(
    renderToString(
      <RadioGroup
        id="speed"
        name="speed"
        label="Speed"
        value="fast"
        options={[{ value: 'fast', label: 'Fast' }]}
      />,
    ),
    /role="radiogroup"/,
  )

  const options = [{ value: 'linh', label: 'Ngọc Linh' }]
  const comboProps = {
    id: 'owner',
    name: 'owner',
    label: 'Owner',
    query: 'Ngọc',
    options,
    open: true,
    openHref: '?owner=open',
    closeHref: '?owner=',
  } as const
  const combo = renderToString(<Combobox {...comboProps} value="linh" />)
  assert.match(combo, /role="combobox"[^>]*aria-expanded="true"/)
  assert.match(combo, /role="listbox"/)
  assert.match(combo, /role="option" aria-selected="true"/)
  assert.match(
    renderToString(<MultiCombobox {...comboProps} values={['linh']} removeHref={() => '?remove=linh'} />),
    /Remove Ngọc Linh/,
  )
  assert.match(
    renderToString(<TagPicker {...comboProps} values={['linh']} removeHref={() => '?remove=linh'} />),
    /data-ui="tag-picker"/,
  )

  assert.match(
    renderToString(<DatePicker id="day" name="day" label="Day" value="2026-09-08" />),
    /value="2026-09-08"/,
  )
  assert.match(
    renderToString(
      <DateRangePicker
        id="range"
        label="Range"
        start={{ id: 'from', name: 'from', value: '2026-09-01' }}
        end={{ id: 'to', name: 'to', value: '2026-09-30' }}
        startLabel="From"
        endLabel="To"
      />,
    ),
    /value="2026-09-01"[\s\S]*value="2026-09-30"/,
  )
  assert.match(
    renderToString(<DateTimePicker id="at" name="at" label="At" value="2026-09-08T14:30" />),
    /type="datetime-local"[^>]*value="2026-09-08T14:30"/,
  )
  assert.match(renderToString(<TimePicker id="time" name="time" label="Time" value="14:30" />), /type="time"/)
  assert.match(
    renderToString(<FileUpload id="file" name="file" label="File" accept="application/pdf" />),
    /type="file"[^>]*accept="application\/pdf"/,
  )
  assert.match(
    renderToString(
      <RelationPicker
        {...comboProps}
        results={[{ id: 'linh', name: 'Ngọc Linh' }]}
        getValue={(person) => person.id}
        getLabel={(person) => person.name}
      />,
    ),
    /data-ui="relation-picker"[\s\S]*Ngọc Linh/,
  )
})

test('design system: catalogue renders every registered specimen', () => {
  const catalogue = renderToString(<CataloguePage theme="dark" density="compact" mode="all" />)
  const designSystemVersion = JSON.parse(readFileSync('packages/design-system/package.json', 'utf8'))
    .version as string
  assert.match(catalogue, /data-kv-design-system/)
  assert.match(catalogue, /data-theme="dark"/)
  assert.match(catalogue, /data-density="compact"/)
  assert.match(
    catalogue,
    new RegExp(`Design system[\\s\\S]*${designSystemVersion.replaceAll('.', '\\.')}`, 'u'),
  )
  assert.match(catalogue, /public components/)
  assert.match(catalogue, /id="data-table"/)
  assert.match(catalogue, /id="list-chrome"/)
  assert.match(catalogue, /id="list-page"/)
  assert.match(catalogue, /id="board-page"/)
  assert.match(catalogue, /id="form-page"/)
  assert.match(catalogue, /id="record-form"/)
  assert.match(catalogue, /id="modal-sheet"/)
  assert.match(catalogue, /id="app-shell"/)
  assert.match(catalogue, /id="record-page"/)
  assert.match(catalogue, /id="workspace-flow"/)
  assert.match(catalogue, /id="workspace-canvas"/)
  assert.match(catalogue, /id="navigation-items"/)
  assert.match(catalogue, /data-ui="list-page"/)
  assert.match(catalogue, /data-ui="record-page"/)
  assert.match(catalogue, /data-ui="dashboard-page"/)
  assert.match(catalogue, /data-ui="board-page"/)
  assert.match(catalogue, /data-ui="catalogue-governance"/)
})

test('design system: governance connects public components to owners and specimens', () => {
  const names = componentRegistry.map((component) => component.name)
  assert.equal(names.length, 73)
  assert.equal(new Set(names).size, names.length)
  const examples = new Set(componentGroups.flatMap((group) => group.examples.map((example) => example.id)))
  assert.deepEqual(
    componentRegistry.filter((component) => !examples.has(component.specimenId)),
    [],
  )
  assert.deepEqual(
    componentGroups.filter((group) => !group.owner || !group.maturity || !group.states.length),
    [],
  )
})

test('design system: density, layer, focus, motion and container tokens are contractual', () => {
  const tokens = readFileSync('packages/design-system/src/foundations/tokens.css', 'utf8')
  const reset = readFileSync('packages/design-system/src/foundations/reset.css', 'utf8')
  const entry = readFileSync('packages/design-system/src/styles.css', 'utf8')
  assert.match(entry, /@layer ket\.reset, ket\.theme, ket\.app, ket\.user;/)
  for (const token of [
    '--kv-density-control-height',
    '--kv-density-row-height',
    '--kv-density-content-gap',
    '--kv-layer-menu',
    '--kv-layer-popover',
    '--kv-layer-dialog',
    '--kv-layer-toast',
    '--kv-container-field-narrow',
    '--kv-container-rail-collapse',
    '--kv-container-page-wide',
  ])
    assert.match(tokens, new RegExp(`${token}:`, 'u'))
  assert.match(tokens, /prefers-reduced-motion: reduce/)
  assert.match(reset, /:focus-visible/)
  assert.match(reset, /outline: 2px solid var\(--kv-color-focus\)/)
})

test('design system: inventory classifies every public and compatibility export', () => {
  assert.equal(designSystemInventory.summary.publicExports, 132)
  assert.equal(designSystemInventory.summary.runtimeExports, 77)
  assert.equal(designSystemInventory.summary.plannedComponents, 22)
  assert.equal(designSystemInventory.summary.compatibilityModules, 38)
  assert.ok(designSystemInventory.rows.length > designSystemInventory.summary.publicExports)
  assert.deepEqual(
    designSystemInventory.rows.filter((row) => !row.owner || !row.decision || !row.gapTask),
    [],
  )
  assert.equal(
    new Set(designSystemInventory.rows.map((row) => `${row.scope}:${row.kind}:${row.name}`)).size,
    designSystemInventory.rows.length,
  )
})

test('design system: inventory is an SSR review surface with URL-owned filters', () => {
  const inventory = renderToString(
    <InventoryPage scope="public" kind="runtime" decision="keep" query="Page" />,
  )
  assert.match(inventory, /data-ui="inventory-page"/)
  assert.match(inventory, /Design-system inventory/)
  assert.match(inventory, /action="\/inventory" method="get"/)
  assert.match(inventory, /name="q" value="Page"/)
  assert.match(inventory, /data-decision="keep"/)
  assert.match(inventory.replace(/<!--k\[?-->/gu, ''), /3 entries in this view/)
  assert.match(inventory, /CSS and JavaScript delivery/)
  assert.doesNotMatch(inventory, /<script/)
  assert.doesNotMatch(inventory, /FormPage<\/code>/)
})

test('design system: KetSuite consumes the public package through aliases and generated assets', () => {
  const packageJson = readFileSync('packages/ketsuite/package.json', 'utf8')
  const backend = readFileSync('packages/ketsuite/src/modules/backend/index.ts', 'utf8')
  const aliases = readFileSync('packages/ketsuite/src/modules/backend/design/tokens.css', 'utf8')
  // The version this repository ships, not a literal. A release moves five
  // package.json files and two scaffolds at once, and the release checker
  // already refuses drift between them; an eighth copy here would only be one
  // more thing to remember, and the kind of failure whose repair is mechanical.
  const shipped = JSON.parse(readFileSync('package.json', 'utf8')).version as string
  assert.match(packageJson, new RegExp(`"@ketvietlab/design-system": "${shipped}"`, 'u'))
  assert.match(backend, /'design-system\.css'/)
  assert.match(aliases, /--admin-bg: var\(--kv-page-bg\)/)
  assert.match(aliases, /--color-primary: var\(--kv-ref-primary\)/)
})
