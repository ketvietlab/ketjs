import { DescriptionList, EmptyState, Stack } from '@ketvietlab/design-system'
import { h } from '../ui.mjs'

// Inspector records read vertically: a narrow panel cannot host a multi-column table.
export function BuilderRecords({ rows, columns, emptyTitle }) {
  if (!rows.length) return emptyTitle ? h(EmptyState, { title: emptyTitle }) : null
  return h(Stack, {
    divided: true,
    items: rows.map((row) =>
      h(DescriptionList, {
        columns: 1,
        items: columns.map((column) => ({ id: column.key, label: column.label, value: column.cell(row) })),
      }),
    ),
  })
}
