import { html, type JSXChild, type TemplateResult } from '@ketvietlab/ketjs-view'
import { Badge, Code, ListPage } from '@ketvietlab/design-system'
import type { BrowserScreenPlan, BrowserWidgetBuiltin, Row } from '@ketvietlab/ketjs'
import { moneyValue } from './primitives.tsx'
import { emptyState, loadingState } from './state.tsx'
import { dataTable, type TableSelection } from './table.tsx'

export type BrowserWidgetRenderer = (props: Record<string, unknown>) => JSXChild

export type BrowserListState = {
  rows: Row[]
  resources: Record<string, ReadonlyMap<string, Row>>
  loading: readonly string[]
  errors: Readonly<Record<string, string>>
  total?: number
  /** Every essential resource has completed successfully for the current rows. */
  requiredReady: boolean
  phase: 'shell' | 'primary' | 'complete'
}

export type BrowserListOptions = {
  status?: string
  emptyTitle?: string
  emptyMessage?: string
  loadingLabel?: string
  locale?: string
  rowHref?: (row: Row) => string
  responsive?: 'scroll' | 'stack'
  selection?: TableSelection
  selectAllLabel?: string
  selectRowLabel?: string
}

const boundProps = (bindings: Readonly<Record<string, string>>, row: Row): Record<string, unknown> =>
  Object.fromEntries(Object.entries(bindings).map(([prop, field]) => [prop, row[field]]))

const builtinCell = (
  kind: BrowserWidgetBuiltin,
  props: Record<string, unknown>,
  locale = 'en',
): TemplateResult | string => {
  const value = props.value
  if (kind === 'code')
    return value === null || value === undefined || value === '' ? '—' : <Code value={String(value)} />
  if (kind === 'badge') {
    const positive = value === true || value === 'active' || value === 'company'
    return <Badge tone={positive ? 'positive' : 'neutral'} label={String(value ?? '—')} />
  }
  if (kind === 'money') {
    return moneyValue(value, props.currency, locale)
  }
  return value === null || value === undefined || value === '' ? '—' : String(value)
}

const cellFor = (
  plan: BrowserScreenPlan,
  state: BrowserListState,
  renderers: Readonly<Record<string, BrowserWidgetRenderer>>,
  column: BrowserScreenPlan['screen']['columns'][number],
  primaryRow: Row,
  locale?: string,
): TemplateResult | string => {
  const resource = plan.resources[column.resource]
  const key = String(primaryRow[plan.screen.rowKey] ?? '')
  const row =
    column.resource === plan.screen.primary ? primaryRow : state.resources[column.resource]?.get(key)
  if (!row) {
    if (state.errors[column.resource])
      return html`<span data-lego-error=${column.resource} title=${state.errors[column.resource]}>—</span>`
    return html`<span data-lego-loading=${column.resource} aria-label="Loading">…</span>`
  }
  const props = boundProps(column.bind, row)
  const widget = plan.widgets[column.widget]
  const renderer = renderers[column.widget]
  if (renderer) return html`${renderer(props)}`
  const builtin = widget?.builtin ?? widget?.ssrBuiltin
  if (builtin) return builtinCell(builtin, props, locale)
  if (!resource) return '—'
  return String(props.value ?? Object.values(props)[0] ?? '—')
}

const tableTranslator = (options: BrowserListOptions) => {
  const translate = (key: string): string => {
    if (key === 'backend.table.selectAll') return options.selectAllLabel ?? 'Select all rows'
    if (key === 'backend.table.selectRow') return options.selectRowLabel ?? 'Select row'
    return key
  }
  return Object.assign(translate, {
    locale: 'en',
    has: (key: string) => key === 'backend.table.selectAll' || key === 'backend.table.selectRow',
    resolves: (key: string) => key === 'backend.table.selectAll' || key === 'backend.table.selectRow',
  })
}

/**
 * The keyed table fragment shared by matched SSR and both CSR strategies.
 *
 * It deliberately does not own a ListPage or shell. A host screen keeps its
 * navigation, filters, summary and bulk actions while composed modules only
 * contribute typed columns and the resources behind them.
 */
export function browserTable(
  plan: BrowserScreenPlan,
  state: BrowserListState,
  renderers: Readonly<Record<string, BrowserWidgetRenderer>> = {},
  options: BrowserListOptions = {},
): TemplateResult {
  const columns = plan.screen.columns.map((column) => ({
    key: column.id,
    label: column.label,
    priority:
      column.priority === 'primary'
        ? ('primary' as const)
        : column.priority === 'optional'
          ? ('tertiary' as const)
          : ('secondary' as const),
    width:
      column.width === 'narrow'
        ? ('narrow' as const)
        : column.width === 'wide'
          ? ('wide' as const)
          : ('medium' as const),
    kind:
      plan.widgets[column.widget]?.builtin === 'badge'
        ? ('status' as const)
        : plan.widgets[column.widget]?.builtin === 'code'
          ? ('identifier' as const)
          : ('text' as const),
    cell: (row: Row) => cellFor(plan, state, renderers, column, row, options.locale),
  }))
  return (
    <div
      data-lego-screen={plan.screen.id}
      data-lego-revision={plan.revision}
      data-lego-phase={state.phase}
      data-lego-rows={String(state.rows.length)}
    >
      {state.phase === 'shell'
        ? loadingState(options.loadingLabel ?? 'Loading', 6)
        : state.rows.length
          ? dataTable(tableTranslator(options), {
              rows: state.rows,
              columns,
              id: (row) => String(row[plan.screen.rowKey]),
              rowHref: options.rowHref,
              rowLink: false,
              responsive: options.responsive ?? 'stack',
              selection: options.selection,
            })
          : emptyState(options.emptyTitle ?? 'No records', options.emptyMessage ?? '')}
    </div>
  )
}

/** Attach the serialized loader contract and its generated client entry to a table fragment. */
export function browserTableBootstrap(bootstrap: unknown, table: TemplateResult): TemplateResult {
  return html`<div data-lego-bootstrap=${JSON.stringify(bootstrap)}>${table}</div><script type="module" src="/_ket/asset/backend/client/browser-list.mjs"></script>`
}

/** A standalone generic ListPage for hosts that do not already own one. */
export function browserList(
  plan: BrowserScreenPlan,
  state: BrowserListState,
  renderers: Readonly<Record<string, BrowserWidgetRenderer>> = {},
  options: BrowserListOptions = {},
): TemplateResult {
  const status =
    options.status ??
    (state.total === undefined ? String(state.rows.length) : `${state.rows.length} / ${state.total}`)
  return (
    <ListPage
      variant="operational"
      title={plan.screen.title}
      description={plan.screen.description}
      status={status}
      body={browserTable(plan, state, renderers, options)}
    />
  )
}

export function browserResourceMap(rows: readonly Row[], key: string): ReadonlyMap<string, Row> {
  return new Map(rows.map((row) => [String(row[key]), row]))
}
