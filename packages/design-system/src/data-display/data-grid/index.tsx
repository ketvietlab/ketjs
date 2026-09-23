import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = ['data-grid-scroll', 'data-grid', 'data-grid-cap', 'data-grid-cell'] as const

export type DataGridColumn<Row> = {
  key: string
  label: string
  cell: (row: Row) => JSXChild
  visible?: boolean
  pinned?: 'start' | 'end'
  width?: string
}

export type DataGridProps<Row> = {
  label: string
  rows: readonly Row[]
  id: (row: Row) => string
  columns: readonly DataGridColumn<Row>[]
  columnOrder?: readonly string[]
  maxRows?: number
  capLabel?: (shown: number, total: number) => string
  density?: 'compact' | 'default' | 'comfortable'
}

export const DataGrid = <Row,>(props: DataGridProps<Row>): TemplateResult => {
  const maxRows = Math.max(1, props.maxRows ?? 500)
  const rows = props.rows.slice(0, maxRows)
  const order = props.columnOrder ?? props.columns.map((column) => column.key)
  const byKey = new Map(props.columns.map((column) => [column.key, column]))
  const columns = order
    .map((key) => byKey.get(key))
    .filter((column): column is DataGridColumn<Row> => !!column && column.visible !== false)
  return (
    <div data-ui="data-grid-scroll" data-density={props.density ?? 'default'}>
      {props.rows.length > rows.length && (
        <p data-ui="data-grid-cap" role="status">
          {props.capLabel?.(rows.length, props.rows.length) ??
            `Showing ${rows.length} of ${props.rows.length} rows`}
        </p>
      )}
      <table
        data-ui="data-grid"
        aria-label={props.label}
        style={`--kv-grid-columns: ${columns.map((column) => column.width ?? 'minmax(9rem, 1fr)').join(' ')}`}
      >
        <thead>
          <tr>
            {each(
              columns,
              (column) => column.key,
              (column) => (
                <th scope="col" data-pinned={column.pinned}>
                  {column.label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {each(rows, props.id, (row) => (
            <tr>
              {each(
                columns,
                (column) => column.key,
                (column) => (
                  <td data-ui="data-grid-cell" data-pinned={column.pinned}>
                    {column.cell(row)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
