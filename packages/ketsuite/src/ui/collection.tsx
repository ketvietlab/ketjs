import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import type { Frame } from './layout.tsx'
import { bulkActions, listChrome } from './chrome.tsx'
import { inline } from './primitives.tsx'
import { Disclosure } from '@ketvietlab/design-system'
import type { KetTableColumn, KetTableConfig, KetTableGroup, KetTableRow } from '@ketvietlab/design-system'
import type { DataTable, TableGroup, TableSelection } from './table.tsx'
import { collectionQueryKeep, paginateCollectionRows } from './collection-state.ts'

/** Collection tools only. ListPage places frame.chrome.create beside the title.
 * A screen whose table owns the selection passes it explicitly; otherwise the
 * frame's chrome is authoritative. */
export const collectionActions = (
  _: Translator,
  frame: Frame,
  extra?: JSXChild,
  selection?: TableSelection | null,
): JSXChild => {
  const chosen = selection ?? frame.chrome?.selection
  // A bar selection takes the controls' place instead; see collectionSelection.
  const active = chosen?.presentation === 'bar' ? null : chosen
  return active || extra !== undefined || frame.extras?.['topbar.end'] !== undefined
    ? inline([active ? bulkActions(_, active) : '', extra ?? '', frame.extras?.['topbar.end'] ?? ''])
    : undefined
}

/** The bar a `presentation: 'bar'` selection shows in place of the query controls. */
export const collectionSelection = (
  _: Translator,
  frame: Frame,
  selection?: TableSelection | null,
): JSXChild => {
  const active = selection ?? frame.chrome?.selection
  return active?.presentation === 'bar' ? bulkActions(_, active) : undefined
}

export const collectionControls = (
  _: Translator,
  title: string,
  frame: Frame,
  advancedControls?: JSXChild,
): JSXChild => {
  if (!frame.chrome && advancedControls === undefined) return undefined
  const advanced =
    advancedControls !== undefined ? (
      <Disclosure summary={_('backend.chrome.filters')} body={advancedControls} />
    ) : undefined
  const chrome = {
    ...frame.chrome,
    layout: 'command' as const,
    section: undefined,
    create: null,
    selection: null,
    advancedControls: advanced,
  }
  return listChrome(_, title, chrome, false)
}

/** Compose native toolbar state without changing the domain's data contract.
 * Pagination and local search must be explicitly enabled for complete datasets.
 * Pre-paged and grouped sources retain their supplied pager and rows.
 */
export const prepareCollectionTable = <R,>(
  _: Translator,
  frame: Frame,
  table: DataTable<R>,
  options: { paginate?: boolean; searchText?: (row: R) => string; range?: boolean } = {},
): { frame: Frame; table: DataTable<R>; total: number } => {
  const total = frame.chrome?.pager?.total ?? table.rows.length
  if (!frame.collectionUrl) return { frame, table, total }
  const url = new URL(frame.collectionUrl, 'http://collection.local')
  if (url.searchParams.has('record')) {
    url.searchParams.delete('record')
    url.searchParams.delete('tab')
  }
  let rows = table.rows
  const chrome = { ...frame.chrome }
  if (options.searchText) {
    const query = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase()
    if (query) rows = rows.filter((row) => options.searchText!(row).toLocaleLowerCase().includes(query))
    chrome.search = {
      name: 'q',
      value: url.searchParams.get('q') ?? '',
      placeholder: chrome.search?.placeholder ?? _('backend.chrome.globalFilter'),
      keep: collectionQueryKeep(url, ['q']),
    }
  }
  const paged =
    options.paginate && !frame.chrome?.pager && !table.groups?.length
      ? paginateCollectionRows(url, rows)
      : null
  if (paged) chrome.pager = paged.pager
  else if (options.range !== false && !chrome.pager && !table.groups?.length)
    chrome.pager = {
      from: rows.length ? 1 : 0,
      to: rows.length,
      total: rows.length,
      prev: null,
      next: null,
    }
  const defaults = table.columns.filter((column) => !column.optional || table.shown?.includes(column.key))
  // `cols` remains the legacy optional-column query. `columns` explicitly names
  // the complete visibility set, including columns that used to be mandatory.
  const selected = url.searchParams.has('columns')
    ? new Set((url.searchParams.get('columns') ?? '').split(',').filter(Boolean))
    : new Set(defaults.map((column) => column.key))
  const configurable = table.columns.filter(
    (column, index) => index > 0 && column.label && column.key !== 'actions',
  )
  const fixed = table.columns.filter((column) => !configurable.includes(column))
  for (const column of fixed) selected.add(column.key)
  if (configurable.length) {
    chrome.tailMenus = [
      ...(chrome.tailMenus ?? []).filter((menu) => menu.id !== 'collection-columns'),
      {
        id: 'collection-columns',
        label: _('backend.table.columns'),
        items: configurable.map((column) => {
          const next = new Set(selected)
          if (next.has(column.key)) next.delete(column.key)
          else next.add(column.key)
          const target = new URL(url)
          target.searchParams.set(
            'columns',
            table.columns
              .filter((item) => next.has(item.key))
              .map((item) => item.key)
              .join(','),
          )
          return {
            id: column.key,
            label: column.label,
            active: selected.has(column.key),
            path: target.pathname + target.search,
          }
        }),
      },
    ]
  }
  return {
    frame: { ...frame, chrome },
    table: {
      ...table,
      rows: paged?.rows ?? rows,
      columns: table.columns
        .filter((column) => selected.has(column.key))
        .map((column) => ({ ...column, optional: false })),
      colsHref: undefined,
    },
    total: paged?.total ?? chrome.pager?.total ?? rows.length,
  }
}

/** The labels every collection grid shares, in the backend's own words. */
export const collectionGridLabels = (
  _: Translator,
  empty: string,
  emptyHint = '',
): KetTableConfig['labels'] => ({
  region: _('backend.table.results'),
  selectAll: _('backend.table.selectAll'),
  selectRow: _('backend.table.selectRow'),
  sortedAscending: _('backend.table.sortAscending'),
  sortedDescending: _('backend.table.sortDescending'),
  previousPage: _('backend.chrome.previous'),
  nextPage: _('backend.chrome.next'),
  loading: _('backend.relation.loading'),
  loadError: _('backend.error.failed.title'),
  retry: _('backend.relation.retry'),
  empty,
  emptyHint,
})

export type CollectionGrid<R> = {
  /** Island columns: what each one reads out of a view row, as JSON. */
  columns: KetTableColumn[]
  rows: readonly R[]
  groups?: readonly TableGroup<R>[]
  id: (row: R) => string
  /** The JSON row the island renders; it must carry `id` and every field a column reads. */
  view: (row: R) => KetTableRow
  /** A `{id}` href that opens a row, such as its record modal. */
  rowHrefTemplate?: string
  /** The bulk form the row checkboxes post to; null offers no selection. */
  selection?: TableSelection | null
  labels: KetTableConfig['labels']
}

/**
 * The island counterpart of `prepareCollectionTable` for a list screen whose table
 * is the KetTable island. The toolbar keeps its page, column chooser and group
 * state from the same URL rules; the island receives only the rows of this page,
 * as JSON, with the selection bound to the bulk form the toolbar shows.
 */
export const prepareCollectionGrid = <R,>(
  _: Translator,
  frame: Frame,
  grid: CollectionGrid<R>,
  options: { paginate?: boolean } = {},
): { frame: Frame; config: KetTableConfig } => {
  const prepared = prepareCollectionTable(
    _,
    frame,
    {
      columns: grid.columns.map((column) => ({ key: column.key, label: column.label, cell: () => '' })),
      rows: grid.rows,
      id: grid.id,
      ...(grid.groups ? { groups: grid.groups } : {}),
    },
    options,
  )
  const shown = new Set(prepared.table.columns.map((column) => column.key))
  const groups = (nodes: readonly TableGroup<R>[]): KetTableGroup[] =>
    nodes.map((node) => ({
      id: node.id,
      label: node.label,
      count: node.count,
      open: node.open,
      href: node.href,
      ...(node.pager ? { pager: node.pager } : {}),
      ...(node.rows ? { rows: node.rows.map(grid.view) } : {}),
      ...(node.children ? { children: groups(node.children) } : {}),
    }))
  const grouped = !!grid.groups?.length
  return {
    frame: {
      ...prepared.frame,
      chrome: { ...prepared.frame.chrome, ...(grid.selection ? { selection: grid.selection } : {}) },
    },
    config: {
      columns: grid.columns.filter((column) => shown.has(column.key)),
      rows: prepared.table.rows.map(grid.view),
      total: prepared.total,
      idField: 'id',
      locale: _.locale,
      ...(grid.rowHrefTemplate ? { rowHrefTemplate: grid.rowHrefTemplate } : {}),
      groupBy: grouped ? ['group'] : [],
      ...(grouped ? { groups: groups(grid.groups!) } : {}),
      ...(grid.selection
        ? { selection: { formId: grid.selection.formId, fieldName: grid.selection.field ?? 'selected' } }
        : {}),
      pager: false,
      labels: grid.labels,
    },
  }
}
