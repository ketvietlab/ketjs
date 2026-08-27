import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { badge, code, dataTable, linkButton } from '../../../ui/index.ts'
import type { Column } from '../../../ui/index.ts'
import { selectionLabel as resolveSelection } from '../../backend/screen.ts'

export type StockRow = {
  id: string
  name: string
  kind: string
  state?: string | null
  detail?: string | null
  href?: string | null
}

/** A stable stock code in the reader's language; the code itself survives as data. */
const selectionLabel = (_: Translator, group: string, value: unknown): string =>
  resolveSelection(_, 'stock_backend', group, value)

const columns = (_: Translator): Array<Column<StockRow>> => [
  {
    key: 'name',
    label: _('stock_backend.col.name'),
    cell: (row) =>
      row.href ? linkButton({ label: row.name, href: row.href, variant: 'tertiary' }) : row.name,
    priority: 'primary',
  },
  {
    key: 'kind',
    label: _('stock_backend.col.kind'),
    cell: (row) => badge(selectionLabel(_, 'kind', row.kind), 'neutral', row.kind),
    priority: 'secondary',
  },
  {
    key: 'state',
    label: _('stock_backend.col.state'),
    cell: (row) =>
      row.state
        ? badge(
            selectionLabel(_, 'state', row.state),
            row.state === 'done' ? 'positive' : 'neutral',
            row.state,
          )
        : '—',
  },
  { key: 'detail', label: _('stock_backend.col.detail'), cell: (row) => row.detail ?? '—' },
  { key: 'id', label: _('backend.table.id'), cell: (row) => code(row.id, 'identifier'), optional: true },
]

export const stockRowsTable = (_: Translator, rows: StockRow[]): TemplateResult =>
  dataTable(_, { columns: columns(_), rows, id: (row) => row.id })
