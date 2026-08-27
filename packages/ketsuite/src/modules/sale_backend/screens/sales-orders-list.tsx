import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  bulkActions,
  dataTable,
  emptyState,
  formatMoney,
  icon,
  inline,
  ListPage,
  linkButton,
  listChrome,
  shell,
} from '../../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../../ui/index.ts'
import { labelOf } from './shared.tsx'

export type SalesOrderRow = Record<string, unknown>

export type SalesOrdersListScreenOptions = {
  rows: SalesOrderRow[]
  detailSuffix: string
  /** The sales-order document, when it is installed and published. */
  printReport?: { id: string; title: string } | undefined
  total?: number
  table?: Partial<DataTable<SalesOrderRow>>
}

const invoiceTone = (status: unknown) =>
  status === 'to invoice' ? 'warning' : status === 'invoiced' ? 'positive' : 'neutral'

/**
 * What a sales order is worth reading at a glance. The specialized overview
 * reuses this contract for its recent-orders table.
 */
export const salesOrderColumns = (
  _: Translator,
  detailSuffix: string,
  printReport?: { id: string; title: string } | undefined,
): Array<Column<SalesOrderRow>> => [
  {
    key: 'name',
    label: _('sale_backend.field.name'),
    priority: 'primary',
    width: 'wide',
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
    kind: 'date',
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
    kind: 'status',
  },
  {
    key: 'locked',
    label: _('sale_backend.field.locked'),
    cell: (row) =>
      badge(
        row.locked ? _('sale_backend.order.locked') : _('sale_backend.order.unlocked'),
        row.locked ? 'warning' : 'neutral',
      ),
    kind: 'status',
  },
  {
    key: 'total',
    label: _('sale_backend.field.amountTotal'),
    cell: (row) => formatMoney(_, row.amountTotal, row.currency),
    align: 'end',
    kind: 'currency',
  },
  ...(printReport
    ? [
        {
          key: 'print',
          label: _('backend.print.label'),
          align: 'end' as const,
          cell: (row: SalesOrderRow) =>
            linkButton({
              label: _('backend.print.label'),
              href: `/reports/${encodeURIComponent(printReport.id)}/${encodeURIComponent(String(row.id))}${detailSuffix}`,
              variant: 'tertiary',
            }),
        },
      ]
    : []),
]

export const salesOrdersListScreen = (
  _: Translator,
  options: SalesOrdersListScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const total = options.total ?? options.rows.length
  const toInvoice = options.rows.filter((row) => row.invoiceStatus === 'to invoice').length
  const invoiced = options.rows.filter((row) => row.invoiceStatus === 'invoiced').length
  const locked = options.rows.filter((row) => row.locked).length
  const selection = options.table?.selection ?? frame.chrome?.selection
  const summary = [
    `${_('sale_backend.orderList.summary.total')}: ${String(total)}`,
    `${_('sale_backend.orderList.summary.toInvoice')}: ${String(toInvoice)}`,
    `${_('sale_backend.orderList.summary.invoiced')}: ${String(invoiced)}`,
    `${_('sale_backend.orderList.summary.locked')}: ${String(locked)}`,
  ].join(' · ')

  return shell(
    _,
    _('sale_backend.orders.title'),
    <ListPage
      title={_('sale_backend.orderList.title')}
      description={_('sale_backend.orderList.subtitle')}
      actions={
        selection || frame.extras?.['topbar.end'] !== undefined
          ? inline([selection ? bulkActions(_, selection) : '', frame.extras?.['topbar.end'] ?? ''])
          : undefined
      }
      controls={
        frame.chrome
          ? listChrome(
              _,
              _('sale_backend.orderList.title'),
              {
                ...frame.chrome,
                layout: 'command',
                section: undefined,
                create: null,
                selection: null,
              },
              false,
            )
          : undefined
      }
      status={summary}
      body={
        options.rows.length || options.table?.groups?.length
          ? dataTable(_, {
              columns: salesOrderColumns(_, options.detailSuffix, options.printReport),
              rows: options.rows,
              id: (row) => String(row.id),
              ...options.table,
            })
          : emptyState(_('sale_backend.orderList.empty'), _('sale_backend.orderList.emptyHint'), {
              icon: icon('shopping-bag'),
            })
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
