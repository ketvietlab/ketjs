import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  formatMoney,
  Framed,
  icon,
  linkButton,
  RecordWorkspace,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { Column, Frame } from '../../ui/index.ts'
import { labelOf } from './screens.tsx'

type SalesOrderRow = Record<string, unknown>

export type SalesOrdersScreenOptions = {
  rows: SalesOrderRow[]
  frame: Frame
  detailSuffix: string
}

const invoiceTone = (status: unknown) =>
  status === 'to invoice' ? 'warning' : status === 'invoiced' ? 'positive' : 'neutral'

const columns = (_: Translator, detailSuffix: string): Array<Column<SalesOrderRow>> => [
  {
    key: 'name',
    label: _('sale_backend.field.name'),
    priority: 'primary',
    cell: (row) =>
      linkButton({
        label: String(row.name),
        href: `/admin/sales/orders/${String(row.id)}${detailSuffix}`,
        variant: 'tertiary',
      }),
  },
  {
    key: 'customer',
    label: _('sale_backend.field.customer'),
    priority: 'secondary',
    cell: (row) => String(row.partnerName ?? row.partnerId),
  },
  {
    key: 'date',
    label: _('sale_backend.field.dateOrder'),
    cell: (row) => String(row.dateOrder).slice(0, 10),
  },
  {
    key: 'invoice',
    label: _('sale_backend.field.invoiceStatus'),
    cell: (row) =>
      badge(
        labelOf(_, 'invoiceStatus', row.invoiceStatus),
        invoiceTone(row.invoiceStatus),
        String(row.invoiceStatus),
      ),
  },
  {
    key: 'locked',
    label: _('sale_backend.field.locked'),
    cell: (row) =>
      badge(
        row.locked ? _('sale_backend.order.locked') : _('sale_backend.order.unlocked'),
        row.locked ? 'warning' : 'neutral',
      ),
  },
  {
    key: 'total',
    label: _('sale_backend.field.amountTotal'),
    cell: (row) => formatMoney(_, row.amountTotal, row.currency),
    align: 'end',
    kind: 'currency',
  },
]

export const salesOrdersScreen = (_: Translator, options: SalesOrdersScreenOptions): TemplateResult => {
  const toInvoice = options.rows.filter((row) => row.invoiceStatus === 'to invoice').length
  const invoiced = options.rows.filter((row) => row.invoiceStatus === 'invoiced').length
  const locked = options.rows.filter((row) => row.locked).length
  const table = options.rows.length ? (
    dataTable(_, {
      columns: columns(_, options.detailSuffix),
      rows: options.rows,
      id: (row) => String(row.id),
    })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('sale_backend.orderList.empty'), _('sale_backend.orderList.emptyHint'), {
        icon: icon('shopping-bag'),
      })}
    />
  )

  return (
    <Framed
      translator={_}
      title={_('sale_backend.orders.title')}
      frame={options.frame}
      body={
        <RecordWorkspace
          kicker={_('sale_backend.orderList.kicker')}
          title={_('sale_backend.orderList.title')}
          subtitle={_('sale_backend.orderList.subtitle')}
          imageFallback={icon('shopping-bag')}
          summary={[
            { id: 'total', label: _('sale_backend.orderList.summary.total'), value: options.rows.length },
            { id: 'to-invoice', label: _('sale_backend.orderList.summary.toInvoice'), value: toInvoice },
            { id: 'invoiced', label: _('sale_backend.orderList.summary.invoiced'), value: invoiced },
            { id: 'locked', label: _('sale_backend.orderList.summary.locked'), value: locked },
          ]}
          body={stack(
            [
              <Section
                title={_('sale_backend.orderList.records.title')}
                description={_('sale_backend.orderList.records.hint')}
                body={table}
              />,
            ],
            'loose',
          )}
        />
      }
    />
  )
}
