import assert from 'node:assert/strict'
import { globSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  AppShell,
  Badge,
  Button,
  DataTable,
  Field,
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
  assert.match(listPage, /<section data-ui="list-page">/)
  assert.match(listPage, /data-ui="list-page-eyebrow"[^>]*>[\s\S]*?Catalogue/)
  assert.match(listPage, /data-ui="list-page-title"[^>]*>[\s\S]*?Products/)
  assert.match(listPage, /data-ui="list-page-title-row"[\s\S]*?data-ui="list-page-actions"/)
  assert.match(listPage, /data-ui="list-page-toolbar"/)
  assert.match(listPage, /data-ui="list-page-controls"[^>]*>[\s\S]*?Search and filters/)
  assert.match(listPage, /data-ui="list-page-status"[^>]*>[\s\S]*?24 products/)

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
  assert.match(backend, /'design-system\/styles\.css'/)
  assert.match(aliases, /--admin-bg: var\(--kv-page-bg\)/)
  assert.match(aliases, /--color-primary: var\(--kv-ref-primary\)/)
})
