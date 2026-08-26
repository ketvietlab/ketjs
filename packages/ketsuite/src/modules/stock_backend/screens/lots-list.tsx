import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { badge, dataTable, emptyState, icon, inline, LinkButton, ListPage, shell } from '../../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../../ui/index.ts'

export type LotListRow = {
  id: string
  name: string
  product: string
  reference: string
  onHand: string
  onHandValue: number
  active: boolean
  /** Localized detail URL supplied by the route. */
  href: string
}

export type LotsListScreenOptions = {
  rows: LotListRow[]
  /** Localized `/admin/stock/lots/new` URL supplied by the route. */
  createHref: string
  total?: number
  table?: Partial<DataTable<LotListRow>>
}

export const lotListColumns = (_: Translator): Array<Column<LotListRow>> => [
  {
    key: 'name',
    label: _('stock_backend.lot.list.col.name'),
    cell: (row) => row.name,
    priority: 'primary',
    width: 'wide',
  },
  {
    key: 'product',
    label: _('stock_backend.lot.list.col.product'),
    cell: (row) => row.product,
    priority: 'secondary',
  },
  {
    key: 'reference',
    label: _('stock_backend.lot.list.col.reference'),
    cell: (row) => row.reference || '—',
  },
  {
    key: 'onHand',
    label: _('stock_backend.lot.list.col.onHand'),
    cell: (row) => row.onHand,
    kind: 'number',
    align: 'end',
  },
  {
    key: 'active',
    label: _('stock_backend.lot.list.col.status'),
    cell: (row) =>
      badge(
        row.active ? _('stock_backend.lot.status.active') : _('stock_backend.lot.status.archived'),
        row.active ? 'positive' : 'neutral',
        row.active ? 'active' : 'archived',
      ),
    kind: 'status',
  },
]

/** List-only lot/serial surface. Creation belongs to the dedicated `/new` form. */
export const lotsListScreen = (
  _: Translator,
  options: LotsListScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const total = options.total ?? options.rows.length

  return shell(
    _,
    _('stock_backend.lots'),
    <ListPage
      title={_('stock_backend.lot.list.title')}
      description={_('stock_backend.lot.list.subtitle')}
      actions={inline([
        <LinkButton label={_('stock_backend.action.create')} href={options.createHref} variant="primary" />,
        frame.extras?.['topbar.end'] ?? '',
      ])}
      status={`${_('stock_backend.lot.list.summary.total')}: ${String(total)}`}
      body={
        options.rows.length || options.table?.groups?.length
          ? dataTable(_, {
              columns: lotListColumns(_),
              rows: options.rows,
              id: (row) => row.id,
              rowHref: (row) => row.href,
              ...options.table,
            })
          : emptyState(_('stock_backend.lot.list.empty'), _('stock_backend.lot.list.emptyHint'), {
              icon: icon('package'),
            })
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
