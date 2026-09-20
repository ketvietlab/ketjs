import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import type { Frame } from './layout.tsx'
import { bulkActions, listChrome } from './chrome.tsx'
import { inline } from './primitives.tsx'
import { Disclosure } from '@ketvietlab/design-system'
import type { DataTable, TableSelection } from './table.tsx'
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
  const active = selection ?? frame.chrome?.selection
  return active || extra !== undefined || frame.extras?.['topbar.end'] !== undefined
    ? inline([active ? bulkActions(_, active) : '', extra ?? '', frame.extras?.['topbar.end'] ?? ''])
    : undefined
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
