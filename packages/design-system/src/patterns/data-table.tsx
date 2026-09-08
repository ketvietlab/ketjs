import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { EmptyState } from '../primitives/feedback.tsx'
import { Surface } from '../layouts/index.tsx'

export type Cell = JSXChild
export type SortDirection = 'ascending' | 'descending'
export type TablePager = {
  label: string
  previousHref?: string | null
  nextHref?: string | null
}

export type Column<Row> = {
  key: string
  label: string
  cell: (row: Row) => Cell
  align?: 'start' | 'end'
  kind?: 'text' | 'number' | 'currency' | 'date' | 'status' | 'identifier' | 'person' | 'media'
  priority?: 'primary' | 'secondary' | 'tertiary'
  width?: 'narrow' | 'medium' | 'wide'
  hidden?: boolean
  optional?: boolean
  sort?: {
    href: string
    direction?: SortDirection | null
    label?: string
  } | null
}

export type TableSelection = {
  /** Associates row checkboxes with an external bulk-action form. */
  form?: string
  name?: string
  selectAllName?: string
  selectedIds?: readonly string[]
  disabled?: boolean
}

export type TableGroup<Row> = {
  id: string
  label: JSXChild
  count?: number
  href?: string | null
  rows?: readonly Row[]
  children?: readonly TableGroup<Row>[]
  pager?: TablePager | null
}

export type DataTableLabels<Row> = {
  selectAll?: string
  selectRow?: (row: Row, id: string) => string
  sortedAscending?: string
  sortedDescending?: string
  previousPage?: string
  nextPage?: string
}

export type DataTableProps<Row> = {
  /** A shared surface contains the heading and an unframed table viewport. */
  title?: string
  actions?: JSXChild
  columns: readonly Column<Row>[]
  rows: readonly Row[]
  id: (row: Row) => string
  caption?: string | null
  rowHref?: (row: Row) => string
  selected?: (row: Row) => boolean
  emptyTitle?: string
  emptyMessage?: string
  emptyActions?: JSXChild
  /** Stack labelled cells on narrow screens, or retain horizontal scrolling. */
  responsive?: 'scroll' | 'stack'
  /** Use a denser gutter for high-volume operational lists. */
  gutter?: 'default' | 'compact'
  selection?: TableSelection | null
  groups?: readonly TableGroup<Row>[]
  shownColumns?: readonly string[]
  labels?: DataTableLabels<Row>
}

export const HOOKS = [
  'table-scroll',
  'table',
  'table-caption',
  'select-col',
  'select-all',
  'col',
  'sort-link',
  'sort-icon',
  'row',
  'group-row',
  'group-cell',
  'group-link',
  'group-indent',
  'group-count',
  'group-pager',
  'group-pager-actions',
  'cell',
  'select-cell',
  'row-select',
  'row-link',
] as const

const selectedColumnKeys = <Row,>(props: DataTableProps<Row>): readonly string[] =>
  props.shownColumns ?? props.columns.filter((column) => column.hidden !== true).map((column) => column.key)

const visibleColumns = <Row,>(props: DataTableProps<Row>): readonly Column<Row>[] => {
  const selected = new Set(selectedColumnKeys(props))
  return props.columns.filter((column) => selected.has(column.key))
}

const colSpan = <Row,>(props: DataTableProps<Row>, columns: readonly Column<Row>[]): number =>
  columns.length + (props.selection ? 1 : 0)

const sortLabel = <Row,>(column: Column<Row>, labels: DataTableLabels<Row> | undefined): string | null => {
  if (!column.sort?.direction) return null
  return column.sort.direction === 'ascending'
    ? (labels?.sortedAscending ?? 'Sorted ascending')
    : (labels?.sortedDescending ?? 'Sorted descending')
}

const columnHeader = <Row,>(
  column: Column<Row>,
  labels: DataTableLabels<Row> | undefined,
): TemplateResult => (
  <th
    data-ui="col"
    data-col={column.key}
    data-align={column.align ?? 'start'}
    data-kind={column.kind ?? 'text'}
    data-width={column.width ?? null}
    data-optional={column.optional === true ? 'true' : null}
    data-sort={column.sort?.direction ?? null}
    aria-sort={column.sort?.direction ?? null}
    scope="col"
  >
    {column.sort ? (
      <a data-ui="sort-link" href={column.sort.href} aria-label={column.sort.label ?? column.label}>
        <span>{column.label}</span>
        {!!column.sort.direction && (
          <span data-ui="sort-icon" aria-hidden="true" title={sortLabel(column, labels) ?? undefined}>
            {column.sort.direction === 'ascending' ? '↑' : '↓'}
          </span>
        )}
      </a>
    ) : (
      column.label
    )}
  </th>
)

const selectionHeader = <Row,>(props: DataTableProps<Row>): TemplateResult | null =>
  props.selection ? (
    <th data-ui="select-col" scope="col">
      <input
        data-ui="select-all"
        type="checkbox"
        name={props.selection.selectAllName ?? 'select-all'}
        aria-label={props.labels?.selectAll ?? 'Select all rows'}
        disabled={props.selection.disabled === true}
      />
    </th>
  ) : null

const isSelected = <Row,>(props: DataTableProps<Row>, row: Row): boolean => {
  if (props.selected?.(row) === true) return true
  return props.selection?.selectedIds?.includes(props.id(row)) === true
}

const rowCells = <Row,>(
  props: DataTableProps<Row>,
  columns: readonly Column<Row>[],
  row: Row,
): TemplateResult => (
  <>
    {props.selection && (
      <td data-ui="select-cell">
        <input
          data-ui="row-select"
          type="checkbox"
          name={props.selection.name ?? 'ids'}
          form={props.selection.form}
          value={props.id(row)}
          checked={isSelected(props, row)}
          aria-label={props.labels?.selectRow?.(row, props.id(row)) ?? `Select row ${props.id(row)}`}
          disabled={props.selection.disabled === true}
        />
      </td>
    )}
    {each(
      columns,
      (column) => column.key,
      (column) => (
        <td
          data-ui="cell"
          data-col={column.key}
          data-linked={props.rowHref && column === columns[0] ? 'true' : null}
          data-align={column.align ?? 'start'}
          data-kind={column.kind ?? 'text'}
          data-priority={column.priority ?? 'secondary'}
          data-label={props.responsive === 'stack' ? column.label : null}
        >
          {props.rowHref && column === columns[0] ? (
            <a data-ui="row-link" href={props.rowHref(row)}>
              {column.cell(row)}
            </a>
          ) : (
            column.cell(row)
          )}
        </td>
      ),
    )}
  </>
)

const tableRow = <Row,>(
  props: DataTableProps<Row>,
  columns: readonly Column<Row>[],
  row: Row,
): TemplateResult => (
  <tr data-ui="row" data-row={props.id(row)} data-selected={isSelected(props, row) ? 'true' : null}>
    {rowCells(props, columns, row)}
  </tr>
)

const groupPager = <Row,>(
  props: DataTableProps<Row>,
  columns: readonly Column<Row>[],
  pager: TablePager | null | undefined,
): TemplateResult | null =>
  pager ? (
    <tr data-ui="group-pager">
      <td colSpan={String(colSpan(props, columns))}>
        <span>{pager.label}</span>
        <span data-ui="group-pager-actions">
          {pager.previousHref && (
            <a href={pager.previousHref} aria-label={props.labels?.previousPage ?? 'Previous page'}>
              ‹
            </a>
          )}
          {pager.nextHref && (
            <a href={pager.nextHref} aria-label={props.labels?.nextPage ?? 'Next page'}>
              ›
            </a>
          )}
        </span>
      </td>
    </tr>
  ) : null

const groupRows = <Row,>(
  props: DataTableProps<Row>,
  columns: readonly Column<Row>[],
  group: TableGroup<Row>,
  depth: number,
): TemplateResult => (
  <>
    <tr data-ui="group-row" data-group={group.id} data-depth={String(depth)}>
      <th data-ui="group-cell" colSpan={String(colSpan(props, columns))} scope="rowgroup">
        <span data-ui="group-indent" style={`--kv-group-depth: ${depth}`} aria-hidden="true" />
        {group.href ? (
          <a data-ui="group-link" href={group.href}>
            {group.label}
          </a>
        ) : (
          <span data-ui="group-link">{group.label}</span>
        )}
        {group.count !== undefined && <span data-ui="group-count">{String(group.count)}</span>}
      </th>
    </tr>
    {each(group.rows ?? [], props.id, (row) => tableRow(props, columns, row))}
    {each(
      group.children ?? [],
      (child) => child.id,
      (child) => groupRows(props, columns, child, depth + 1),
    )}
    {groupPager(props, columns, group.pager)}
  </>
)

export const DataTable = <Row,>(props: DataTableProps<Row>): TemplateResult => {
  const columns = visibleColumns(props)
  const groups = props.groups ?? []
  const hasRows = props.rows.length > 0 || groups.length > 0

  const content = hasRows ? (
    <div
      data-ui="table-scroll"
      data-framed={props.title ? 'false' : null}
      data-responsive={props.responsive ?? 'scroll'}
      data-gutter={props.gutter === 'compact' ? 'compact' : null}
    >
      <table data-ui="table" aria-label={props.caption ? null : (props.title ?? null)}>
        {!!props.caption && <caption data-ui="table-caption">{props.caption}</caption>}
        <thead>
          <tr>
            {selectionHeader(props)}
            {each(
              columns,
              (column) => column.key,
              (column) => columnHeader(column, props.labels),
            )}
          </tr>
        </thead>
        <tbody>
          {groups.length > 0
            ? each(
                groups,
                (group) => group.id,
                (group) => groupRows(props, columns, group, 0),
              )
            : each(props.rows, props.id, (row) => tableRow(props, columns, row))}
        </tbody>
      </table>
    </div>
  ) : (
    <EmptyState
      title={props.emptyTitle ?? 'No records'}
      message={props.emptyMessage ?? 'There is nothing to show yet.'}
      actions={props.emptyActions}
    />
  )
  return props.title ? (
    <Surface title={props.title} actions={props.actions} padding="none" body={content} />
  ) : (
    content
  )
}
