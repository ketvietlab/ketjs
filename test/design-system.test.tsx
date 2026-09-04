import assert from 'node:assert/strict'
import { globSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  AppShell,
  Badge,
  BoardPage,
  Button,
  DashboardPage,
  DataTable,
  Disclosure,
  Field,
  FormPage,
  HOOKS,
  ListPage,
  NavList,
  Progress,
  RecordForm,
  Tabs,
} from '@ketvietlab/design-system'
import { CataloguePage } from '@ketvietlab/design-system/catalogue'

const css = globSync('packages/design-system/src/**/*.css')
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')

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

test('design system: card surfaces use the shared radius scale', () => {
  const layouts = readFileSync('packages/design-system/src/layouts/layouts.css', 'utf8')
  const metricRule = layouts.match(/\[data-ui="metric"\]\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? ''
  assert.match(metricRule, /border-radius: var\(--kv-radius-md\)/)
  assert.doesNotMatch(metricRule, /border-radius:\s*0/)
})

test('design system: application regions are square while independent objects are rounded', () => {
  const shellCss = readFileSync('packages/design-system/src/layouts/shell.css', 'utf8')
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
  const patterns = readFileSync('packages/design-system/src/patterns/patterns.css', 'utf8')
  const rule =
    patterns.match(
      /\[data-ui="list-page"\]\[data-variant="operational"\]\s*\[data-ui="list-page-body"\]\s*\{(?<body>[^}]+)\}/,
    )?.groups?.body ?? ''
  assert.match(rule, /padding-top: var\(--kv-space-2\)/)
})

test('design system: canonical page titles share one dense hierarchy', () => {
  const patterns = readFileSync('packages/design-system/src/patterns/patterns.css', 'utf8')
  const kinds = ['list-page', 'form-page', 'dashboard-page', 'board-page']
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
  const patterns = readFileSync('packages/design-system/src/patterns/patterns.css', 'utf8')
  const compactPadding = /padding: var\(--kv-space-4\) var\(--kv-space-4\) var\(--kv-space-3\)/g
  assert.equal((patterns.match(compactPadding) ?? []).length >= 4, true)
})

test('design system: light page surfaces use component roles without changing the palette', () => {
  const tokens = readFileSync('packages/design-system/src/foundations/tokens.css', 'utf8')
  const patterns = readFileSync('packages/design-system/src/patterns/patterns.css', 'utf8')
  assert.match(tokens, /--kv-page-chrome-bg: light-dark\(var\(--kv-page-bg\), var\(--kv-panel-bg\)\)/)
  assert.match(tokens, /--kv-page-content-bg: var\(--kv-page-bg\)/)
  assert.match(tokens, /--kv-table-bg: light-dark\(var\(--kv-panel-bg\), transparent\)/)
  for (const kind of ['list-page', 'form-page', 'dashboard-page', 'board-page']) {
    for (const region of ['context', 'header']) {
      const rule = patterns.match(
        new RegExp(
          `\\[data-ui="${kind}"\\]\\[data-variant="operational"\\]\\s*\\[data-ui="${kind}-${region}"\\]\\s*\\{([^}]+)\\}`,
        ),
      )?.[1]
      assert.match(rule ?? '', /background: var\(--kv-page-chrome-bg\)/, `${kind}-${region}`)
    }
  }
  for (const kind of ['form-page']) {
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
  const patterns = readFileSync('packages/design-system/src/patterns/patterns.css', 'utf8')
  const layouts = readFileSync('packages/design-system/src/layouts/layouts.css', 'utf8')
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

test('design system: form controls stack below 768px', () => {
  const patterns = readFileSync('packages/design-system/src/patterns/patterns.css', 'utf8')
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

test('design system: action labels leave room for Vietnamese diacritics while truncating', () => {
  const primitives = readFileSync('packages/design-system/src/primitives/primitives.css', 'utf8')
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
})

test('design system: catalogue renders every registered specimen', () => {
  const catalogue = renderToString(<CataloguePage theme="dark" density="compact" />)
  assert.match(catalogue, /data-kv-design-system/)
  assert.match(catalogue, /data-theme="dark"/)
  assert.match(catalogue, /data-density="compact"/)
  assert.match(catalogue, /Operational UI, kept honest/)
  assert.match(catalogue, /id="data-table"/)
  assert.match(catalogue, /id="list-page"/)
  assert.match(catalogue, /id="board-page"/)
  assert.match(catalogue, /id="form-page"/)
  assert.match(catalogue, /id="record-form"/)
  assert.match(catalogue, /id="modal-sheet"/)
  assert.match(catalogue, /id="app-shell"/)
  assert.match(catalogue, /id="navigation-items"/)
})

test('design system: KetSuite consumes the public package through aliases and generated assets', () => {
  const packageJson = readFileSync('packages/ketsuite/package.json', 'utf8')
  const backend = readFileSync('packages/ketsuite/src/modules/backend/index.ts', 'utf8')
  const aliases = readFileSync('packages/ketsuite/src/modules/backend/design/tokens.css', 'utf8')
  assert.match(packageJson, /"@ketvietlab\/design-system": "0\.1\.3"/)
  assert.match(backend, /'design-system\.css'/)
  assert.match(aliases, /--admin-bg: var\(--kv-page-bg\)/)
  assert.match(aliases, /--color-primary: var\(--kv-ref-primary\)/)
})
