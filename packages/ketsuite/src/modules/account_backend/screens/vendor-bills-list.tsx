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

export type VendorBillListRow = Record<string, unknown>

export type VendorBillListSummary = {
  total: number
  draft: number
  posted: number
  unpaid: number
}

export type VendorBillsListScreenOptions = {
  frame: Frame
  rows: VendorBillListRow[]
  createHref: string
  rowHref: (row: VendorBillListRow) => string
  partnerLabel: (row: VendorBillListRow) => string
  summary: VendorBillListSummary
  table?: Partial<DataTable<VendorBillListRow>>
}

const paymentTone = (state: unknown) => {
  if (state === 'paid') return 'positive' as const
  if (state === 'partial') return 'warning' as const
  return 'neutral' as const
}

export const vendorBillListColumns = (_: Translator, partnerLabel: (row: VendorBillListRow) => string) => [
  {
    key: 'name',
    label: _('account_backend.field.name'),
    priority: 'primary' as const,
    width: 'wide' as const,
    cell: (row: VendorBillListRow) => moveTitle(_, row),
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
    cell: (row: VendorBillListRow) => String(row.accountingDate ?? row.date).slice(0, 10),
  },
  {
    key: 'type',
    label: _('account_backend.field.moveType'),
    cell: (row: VendorBillListRow) => labelOf(_, 'moveType', row.moveType),
  },
  {
    key: 'state',
    label: _('account_backend.field.state'),
    kind: 'status' as const,
    cell: (row: VendorBillListRow) =>
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
    cell: (row: VendorBillListRow) =>
      badge(
        labelOf(_, 'paymentState', row.paymentState),
        paymentTone(row.paymentState),
        String(row.paymentState),
      ),
  },
  {
    key: 'total',
    label: _('account_backend.field.amountTotal'),
    cell: (row: VendorBillListRow) => formatMoney(_, row.amountTotal, row.currency),
    align: 'end' as const,
    kind: 'currency' as const,
  },
]

export const vendorBillsListScreen = (
  _: Translator,
  options: VendorBillsListScreenOptions,
): TemplateResult => {
  const status = [
    `${_('account_backend.vendorBill.summary.total')}: ${String(options.summary.total)}`,
    `${_('account_backend.vendorBill.summary.draft')}: ${String(options.summary.draft)}`,
    `${_('account_backend.vendorBill.summary.posted')}: ${String(options.summary.posted)}`,
    `${_('account_backend.vendorBill.summary.unpaid')}: ${String(options.summary.unpaid)}`,
  ].join(' · ')
  const table =
    options.rows.length || options.table?.groups?.length ? (
      dataTable(_, {
        rows: options.rows,
        id: (row) => String(row.id),
        rowHref: options.rowHref,
        columns: vendorBillListColumns(_, options.partnerLabel),
        ...options.table,
      })
    ) : (
      <Surface
        padding="compact"
        body={emptyState(_('account_backend.vendorBill.empty'), _('account_backend.vendorBill.emptyHint'), {
          icon: icon('banknote'),
        })}
      />
    )

  return shell(
    _,
    _('account_backend.vendorBills.title'),
    <ListPage
      variant="operational"
      frame={options.frame}
      title={_('account_backend.vendorBills.title')}
      description={_('account_backend.vendorBill.subtitle')}
      actions={inline([
        <LinkButton label={_('account_backend.action.create')} href={options.createHref} variant="primary" />,
        options.frame.extras?.['topbar.end'] ?? '',
      ])}
      controls={
        options.frame.chrome
          ? listChrome(
              _,
              _('account_backend.vendorBills.title'),
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
