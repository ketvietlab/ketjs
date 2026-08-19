import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import { badge, code, dataTable, emptyState, framed } from '../../ui/index.ts'
import type { Column, Frame } from '../../ui/index.ts'

export type PricelistRow = { id: string; name: string; state: string; sequence: string }

export const pricelistsScreen = (_: Translator, rows: PricelistRow[], frame: Frame): TemplateResult => {
  const columns: Array<Column<PricelistRow>> = [
    { key: 'name', label: _('pricing_backend.col.name'), cell: (row) => row.name, priority: 'primary' },
    { key: 'state', label: _('pricing_backend.col.state'), cell: (row) => badge(row.state) },
    { key: 'sequence', label: _('pricing_backend.col.sequence'), cell: (row) => row.sequence },
    { key: 'id', label: _('backend.table.id'), cell: (row) => code(row.id), optional: true },
  ]
  return framed(
    _,
    _('pricing_backend.title'),
    frame,
    rows.length
      ? dataTable(_, { columns, rows, id: (row) => row.id })
      : emptyState(_('pricing_backend.empty'), _('pricing_backend.emptyHint')),
  )
}
