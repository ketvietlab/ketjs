import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import { badge, code, dataTable, emptyState, framed } from '../../ui/index.ts'
import type { Column, Frame } from '../../ui/index.ts'

export type StockRow = {
  id: string
  name: string
  kind: string
  state?: string | null
  detail?: string | null
}

const columns = (_: Translator): Array<Column<StockRow>> => [
  { key: 'name', label: _('stock_backend.col.name'), cell: (row) => row.name, priority: 'primary' },
  { key: 'kind', label: _('stock_backend.col.kind'), cell: (row) => badge(row.kind), priority: 'secondary' },
  {
    key: 'state',
    label: _('stock_backend.col.state'),
    cell: (row) =>
      row.state ? badge(row.state, row.state === 'done' ? 'positive' : 'neutral', row.state) : '—',
  },
  { key: 'detail', label: _('stock_backend.col.detail'), cell: (row) => row.detail ?? '—' },
  { key: 'id', label: _('backend.table.id'), cell: (row) => code(row.id, 'identifier'), optional: true },
]

export const stockScreen = (_: Translator, title: string, rows: StockRow[], frame: Frame): TemplateResult =>
  framed(
    _,
    title,
    frame,
    rows.length
      ? dataTable(_, { columns: columns(_), rows, id: (row) => row.id })
      : emptyState(_('stock_backend.empty'), _('stock_backend.emptyHint')),
  )
