// The list itself: columns as data, and the small pieces that go in a cell.
//
// A module says what its columns ARE — key, label, how to read one out of a row,
// whether it is on by default. It does not write a <table>. Optional columns and
// sorting live in the URL, so the back button and shared links keep their meaning.

import { each } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import type { Translator } from 'ketjs'
import { icon } from './icons.ts'

export type Cell = TemplateResult | string

export type Column<R> = {
  key: string
  label: string
  cell: (row: R) => Cell
  align?: 'end'
  kind?: 'text' | 'number' | 'currency' | 'date' | 'status' | 'identifier' | 'person'
  priority?: 'primary' | 'secondary' | 'tertiary'
  width?: 'narrow' | 'medium' | 'wide'
  sort?: { href: string; direction?: 'asc' | 'desc' | null; label: string }
  optional?: boolean
}

export type DataTable<R> = {
  columns: ReadonlyArray<Column<R>>
  rows: readonly R[]
  id: (row: R) => string
  caption?: string | null
  shown?: readonly string[]
  colsHref?: (keys: readonly string[]) => string
}

export const HOOKS = [
  'table-scroll',
  'table',
  'col',
  'row',
  'cell',
  'col-actions',
  'cell-actions',
  'table-caption',
  'sort-link',
  'sort-icon',
  'col-config',
  'col-config-open',
  'col-config-menu',
  'col-toggle',
  'col-toggle-mark',
] as const

export const visibleColumns = <R,>(table: DataTable<R>): ReadonlyArray<Column<R>> =>
  table.columns.filter((column) => !column.optional || (table.shown ?? []).includes(column.key))

const columnMenu = <R,>(_: Translator, table: DataTable<R>): TemplateResult => {
  const optional = table.columns.filter((column) => column.optional)
  const shown = new Set(table.shown ?? [])
  return (
    <details data-ui="col-config">
      <summary data-ui="col-config-open" aria-label={_('backend.table.columns')}>
        {icon('sliders-horizontal')}
      </summary>
      <div data-ui="col-config-menu">
        {each(
          optional,
          (column) => column.key,
          (column) => (
            <a
              data-ui="col-toggle"
              data-on={String(shown.has(column.key))}
              href={table.colsHref!(
                shown.has(column.key)
                  ? [...shown].filter((key) => key !== column.key)
                  : [...shown, column.key],
              )}
            >
              <span data-ui="col-toggle-mark">{shown.has(column.key) ? '✓' : ''}</span>
              {column.label}
            </a>
          ),
        )}
      </div>
    </details>
  )
}

/** A canonical, URL-driven operational table with keyed rows. */
export const dataTable = <R,>(_: Translator, table: DataTable<R>): TemplateResult => {
  const columns = visibleColumns(table)
  const configurable = !!table.colsHref && table.columns.some((column) => column.optional)
  return (
    <div data-ui="table-scroll">
      <table data-ui="table">
        {!!table.caption && <caption data-ui="table-caption">{table.caption}</caption>}
        <thead>
          <tr>
            {each(
              columns,
              (column) => column.key,
              (column) => (
                <th
                  data-ui="col"
                  data-col={column.key}
                  data-align={column.align ?? 'start'}
                  data-kind={column.kind ?? 'text'}
                  data-priority={column.priority ?? 'secondary'}
                  data-width={column.width ?? null}
                >
                  {column.sort ? (
                    <a
                      data-ui="sort-link"
                      href={column.sort.href}
                      aria-label={column.sort.label}
                      aria-current={column.sort.direction ? 'true' : null}
                    >
                      {column.label}
                      {!!column.sort.direction && (
                        <span data-ui="sort-icon">
                          {icon(column.sort.direction === 'asc' ? 'arrow-up' : 'arrow-down')}
                        </span>
                      )}
                    </a>
                  ) : (
                    column.label
                  )}
                </th>
              ),
            )}
            {configurable && <th data-ui="col-actions">{columnMenu(_, table)}</th>}
          </tr>
        </thead>
        <tbody>
          {each(table.rows, table.id, (row) => (
            <tr data-ui="row" data-row={table.id(row)}>
              {each(
                columns,
                (column) => column.key,
                (column) => (
                  <td
                    data-ui="cell"
                    data-col={column.key}
                    data-align={column.align ?? 'start'}
                    data-kind={column.kind ?? 'text'}
                    data-priority={column.priority ?? 'secondary'}
                  >
                    {column.cell(row)}
                  </td>
                ),
              )}
              {configurable && <td data-ui="cell-actions" />}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
