import { DescriptionList, EmptyState, Stack } from '@ketvietlab/design-system'
import type { JSXChild } from '@ketvietlab/ketjs-view/jsx-runtime'

export type BuilderRecordColumn<Row> = { key: string; label: string; cell: (row: Row) => JSXChild }
export type BuilderRecordsProps<Row> = {
  rows: readonly Row[]
  columns: BuilderRecordColumn<Row>[]
  emptyTitle?: string
}

// Inspector records read vertically: a narrow panel cannot host a multi-column table.
export function BuilderRecords<Row>({ rows, columns, emptyTitle }: BuilderRecordsProps<Row>) {
  if (!rows.length) return emptyTitle ? <EmptyState title={emptyTitle} message="" /> : null
  return (
    <Stack
      divided
      items={rows.map((row) => (
        <DescriptionList
          columns={1}
          items={columns.map((column) => ({ id: column.key, label: column.label, value: column.cell(row) }))}
        />
      ))}
    />
  )
}
