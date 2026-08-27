import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { badge, dataTable, emptyState, inline, LinkButton, ListPage, shell } from '../../../ui/index.ts'
import type { Column, Frame } from '../../../ui/index.ts'

export type ManufacturingOrderListRow = {
  id: string
  name: string
  product: string
  quantity: string
  state: string
  /** Locale-aware order-detail URL supplied by the route. */
  href: string
}

export type OrdersListScreenOptions = {
  rows: ManufacturingOrderListRow[]
  /** Locale-aware `/admin/manufacturing/new` URL supplied by the route. */
  createHref: string
}

const stateTone = (state: string): 'positive' | 'danger' | 'warning' | 'neutral' =>
  state === 'done'
    ? 'positive'
    : state === 'cancelled'
      ? 'danger'
      : state === 'in_progress'
        ? 'warning'
        : 'neutral'

export const manufacturingOrderListColumns = (_: Translator): Array<Column<ManufacturingOrderListRow>> => [
  {
    key: 'name',
    label: _('manufacturing_backend.field.name'),
    cell: (row) => row.name,
    priority: 'primary',
    width: 'wide',
  },
  {
    key: 'product',
    label: _('manufacturing_backend.field.product'),
    cell: (row) => row.product,
    priority: 'secondary',
  },
  {
    key: 'quantity',
    label: _('manufacturing_backend.field.quantity'),
    cell: (row) => row.quantity,
    align: 'end',
  },
  {
    key: 'state',
    label: _('manufacturing_backend.field.state'),
    cell: (row) => badge(row.state, stateTone(row.state), row.state),
    kind: 'status',
  },
]

/** List-only production-order surface. Creation belongs to `/admin/manufacturing/new`. */
export const ordersListScreen = (
  _: Translator,
  options: OrdersListScreenOptions,
  frame: Frame = {},
): TemplateResult =>
  shell(
    _,
    _('manufacturing_backend.orders.title'),
    <ListPage
      title={_('manufacturing_backend.orders.title')}
      actions={inline([
        <LinkButton
          label={_('manufacturing_backend.orders.create')}
          href={options.createHref}
          variant="primary"
        />,
        frame.extras?.['topbar.end'] ?? '',
      ])}
      body={
        options.rows.length
          ? dataTable(_, {
              rows: options.rows,
              id: (row) => row.id,
              rowHref: (row) => row.href,
              columns: manufacturingOrderListColumns(_),
            })
          : emptyState(_('manufacturing_backend.empty.orders'), _('manufacturing_backend.empty.ordersHint'))
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
