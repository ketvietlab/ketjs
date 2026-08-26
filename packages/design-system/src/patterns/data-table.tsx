import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { EmptyState } from '../primitives/feedback.tsx'

export type Cell = JSXChild
export type Column<Row> = {
  key: string
  label: string
  cell: (row: Row) => Cell
  align?: 'start' | 'end'
  kind?: 'text' | 'number' | 'currency' | 'date' | 'status' | 'identifier' | 'person'
  priority?: 'primary' | 'secondary' | 'tertiary'
  width?: 'narrow' | 'medium' | 'wide'
}

export type DataTableProps<Row> = {
  columns: readonly Column<Row>[]
  rows: readonly Row[]
  id: (row: Row) => string
  caption?: string | null
  rowHref?: (row: Row) => string
  selected?: (row: Row) => boolean
  emptyTitle?: string
  emptyMessage?: string
}

export const HOOKS = ['table-scroll', 'table', 'table-caption', 'col', 'row', 'cell', 'row-link'] as const

export const DataTable = <Row,>(props: DataTableProps<Row>): TemplateResult =>
  props.rows.length === 0 ? (
    <EmptyState
      title={props.emptyTitle ?? 'No records'}
      message={props.emptyMessage ?? 'There is nothing to show yet.'}
    />
  ) : (
    <div data-ui="table-scroll">
      <table data-ui="table">
        {!!props.caption && <caption data-ui="table-caption">{props.caption}</caption>}
        <thead>
          <tr>
            {each(
              props.columns,
              (column) => column.key,
              (column) => (
                <th
                  data-ui="col"
                  data-col={column.key}
                  data-align={column.align ?? 'start'}
                  data-kind={column.kind ?? 'text'}
                  data-width={column.width ?? null}
                  scope="col"
                >
                  {column.label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {each(props.rows, props.id, (row) => (
            <tr
              data-ui="row"
              data-row={props.id(row)}
              data-selected={props.selected?.(row) === true ? 'true' : null}
            >
              {each(
                props.columns,
                (column) => column.key,
                (column, index) => (
                  <td
                    data-ui="cell"
                    data-col={column.key}
                    data-align={column.align ?? 'start'}
                    data-kind={column.kind ?? 'text'}
                    data-priority={column.priority ?? 'secondary'}
                  >
                    {props.rowHref && index === 0 ? (
                      <a data-ui="row-link" href={props.rowHref(row)}>
                        {column.cell(row)}
                      </a>
                    ) : (
                      column.cell(row)
                    )}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
