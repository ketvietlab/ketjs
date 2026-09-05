import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  formatMoney,
  icon,
  inline,
  LinkButton,
  ListPage,
  listChrome,
  shell,
  Surface,
} from '../../../ui/index.ts'
import type { DataTable, Frame } from '../../../ui/index.ts'
import { labelOf, moveTitle } from './shared.tsx'

export type CustomerInvoiceListRow = Record<string, unknown>

export type CustomerInvoiceListSummary = {
  total: number
  draft: number
  posted: number
  unpaid: number
}

export type CustomerInvoicesListScreenOptions = {
  frame: Frame
  rows: CustomerInvoiceListRow[]
  createHref: string
  rowHref: (row: CustomerInvoiceListRow) => string
  partnerLabel: (row: CustomerInvoiceListRow) => string
  summary: CustomerInvoiceListSummary
  table?: Partial<DataTable<CustomerInvoiceListRow>>
}

const paymentTone = (state: unknown) => {
  if (state === 'paid') return 'positive' as const
  if (state === 'partial') return 'warning' as const
  return 'neutral' as const
}

export const customerInvoiceListColumns = (
  _: Translator,
  partnerLabel: (row: CustomerInvoiceListRow) => string,
) => [
  {
    key: 'name',
    label: _('account_backend.field.name'),
    priority: 'primary' as const,
    width: 'wide' as const,
    cell: (row: CustomerInvoiceListRow) => moveTitle(_, row),
  },
  {
    key: 'partner',
    label: _('account_backend.field.partnerId'),
    width: 'wide' as const,
    cell: partnerLabel,
  },
  {
    key: 'date',
    label: _('account_backend.field.date'),
    cell: (row: CustomerInvoiceListRow) => String(row.accountingDate ?? row.date).slice(0, 10),
  },
  {
    key: 'type',
    label: _('account_backend.field.moveType'),
    cell: (row: CustomerInvoiceListRow) => labelOf(_, 'moveType', row.moveType),
  },
  {
    key: 'state',
    label: _('account_backend.field.state'),
    kind: 'status' as const,
    cell: (row: CustomerInvoiceListRow) =>
      badge(
        labelOf(_, 'moveState', row.state),
        row.state === 'posted' ? 'positive' : 'neutral',
        String(row.state),
      ),
  },
  {
    key: 'payment',
    label: _('account_backend.field.paymentState'),
    kind: 'status' as const,
    cell: (row: CustomerInvoiceListRow) =>
      badge(
        labelOf(_, 'paymentState', row.paymentState),
        paymentTone(row.paymentState),
        String(row.paymentState),
      ),
  },
  {
    key: 'total',
    label: _('account_backend.field.amountTotal'),
    cell: (row: CustomerInvoiceListRow) => formatMoney(_, row.amountTotal, row.currency),
    align: 'end' as const,
    kind: 'currency' as const,
  },
]

export const customerInvoicesListScreen = (
  _: Translator,
  options: CustomerInvoicesListScreenOptions,
): TemplateResult => {
  const status = [
    `${_('account_backend.customerInvoice.summary.total')}: ${String(options.summary.total)}`,
    `${_('account_backend.customerInvoice.summary.draft')}: ${String(options.summary.draft)}`,
    `${_('account_backend.customerInvoice.summary.posted')}: ${String(options.summary.posted)}`,
    `${_('account_backend.customerInvoice.summary.unpaid')}: ${String(options.summary.unpaid)}`,
  ].join(' · ')
  const table =
    options.rows.length || options.table?.groups?.length ? (
      dataTable(_, {
        rows: options.rows,
        id: (row) => String(row.id),
        rowHref: options.rowHref,
        columns: customerInvoiceListColumns(_, options.partnerLabel),
        ...options.table,
      })
    ) : (
      <Surface
        padding="compact"
        body={emptyState(
          _('account_backend.customerInvoice.empty'),
          _('account_backend.customerInvoice.emptyHint'),
          { icon: icon('banknote') },
        )}
      />
    )

  return shell(
    _,
    _('account_backend.customerInvoices.title'),
    <ListPage
      variant="operational"
      frame={options.frame}
      title={_('account_backend.customerInvoices.title')}
      description={_('account_backend.customerInvoice.subtitle')}
      actions={inline([
        <LinkButton label={_('account_backend.action.create')} href={options.createHref} variant="primary" />,
        options.frame.extras?.['topbar.end'] ?? '',
      ])}
      controls={
        options.frame.chrome
          ? listChrome(
              _,
              _('account_backend.customerInvoices.title'),
              {
                ...options.frame.chrome,
                layout: 'command',
                section: undefined,
                create: null,
                selection: null,
              },
              false,
            )
          : undefined
      }
      status={status}
      body={table}
    />,
    { ...options.frame, chrome: null, topbar: false },
  )
}
