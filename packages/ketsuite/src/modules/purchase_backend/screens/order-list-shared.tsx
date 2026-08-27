import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { badge, dataTable, formatMoney } from '../../../ui/index.ts'
import type { Column, DataTable } from '../../../ui/index.ts'
import { labelOf, purchaseOrderPath } from './shared.tsx'

export type PurchaseOrderListRow = Record<string, unknown>

const stateTone = (state: unknown) =>
  state === 'purchase' || state === 'done'
    ? 'positive'
    : state === 'cancel'
      ? 'danger'
      : state === 'to approve'
        ? 'warning'
        : state === 'sent'
          ? 'info'
          : 'neutral'

export const purchaseOrderListColumns = (_: Translator): Array<Column<PurchaseOrderListRow>> => [
  {
    key: 'name',
    label: _('purchase_backend.field.name'),
    priority: 'primary',
    width: 'wide',
    cell: (row) => String(row.name),
  },
  {
    key: 'vendor',
    label: _('purchase_backend.field.vendor'),
    cell: (row) => String(row.partnerName ?? row.partnerId),
  },
  {
    key: 'date',
    label: _('purchase_backend.field.dateOrder'),
    cell: (row) => String(row.dateOrder).slice(0, 10),
    kind: 'date',
  },
  {
    key: 'state',
    label: _('purchase_backend.field.state'),
    cell: (row) => badge(labelOf(_, 'state', row.state), stateTone(row.state), String(row.state)),
    kind: 'status',
  },
  {
    key: 'invoice',
    label: _('purchase_backend.field.invoiceStatus'),
    cell: (row) => labelOf(_, 'invoiceStatus', row.invoiceStatus),
    kind: 'status',
  },
  {
    key: 'total',
    label: _('purchase_backend.field.amountTotal'),
    cell: (row) => formatMoney(_, row.amountTotal, row.currency),
    align: 'end',
    kind: 'currency',
  },
]

export const purchaseOrderTable = (
  _: Translator,
  rows: PurchaseOrderListRow[],
  detailSuffix: string,
  table?: Partial<DataTable<PurchaseOrderListRow>>,
): TemplateResult =>
  dataTable(_, {
    rows,
    columns: purchaseOrderListColumns(_),
    id: (row) => String(row.id),
    rowHref: (row) => `${purchaseOrderPath(row)}${detailSuffix}`,
    ...table,
  })
