import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  collectionActions,
  collectionControls,
  collectionTable,
  emptyState,
  formatMoney,
  icon,
  LinkButton,
  ListPage,
  prepareCollectionTable,
  shell,
  Surface,
} from '../../../ui/index.ts'
import type { DataTable, Frame } from '../../../ui/index.ts'
import { labelOf } from './shared.tsx'

export type PaymentListRow = Record<string, unknown>

export type PaymentListSummary = {
  total: number
  inbound: number
  outbound: number
  open: number
}

export type PaymentsListScreenOptions = {
  frame: Frame
  rows: PaymentListRow[]
  createHref: string
  rowHref: (row: PaymentListRow) => string
  partnerLabel: (row: PaymentListRow) => string
  summary: PaymentListSummary
  table?: Partial<DataTable<PaymentListRow>>
}

export const paymentListColumns = (_: Translator, partnerLabel: (row: PaymentListRow) => string) => [
  {
    key: 'name',
    label: _('account_backend.field.name'),
    priority: 'primary' as const,
    width: 'wide' as const,
    cell: (row: PaymentListRow) => String(row.name),
  },
  {
    key: 'date',
    label: _('account_backend.field.date'),
    cell: (row: PaymentListRow) => String(row.accountingDate ?? row.date).slice(0, 10),
  },
  {
    key: 'type',
    label: _('account_backend.field.paymentType'),
    cell: (row: PaymentListRow) => labelOf(_, 'paymentType', row.paymentType),
  },
  {
    key: 'partner',
    label: _('account_backend.field.partnerId'),
    width: 'wide' as const,
    cell: (row: PaymentListRow) => `${partnerLabel(row)} · ${labelOf(_, 'partnerType', row.partnerType)}`,
  },
  {
    key: 'amount',
    label: _('account_backend.field.paymentAmount'),
    cell: (row: PaymentListRow) => formatMoney(_, row.amount, row.currency),
    align: 'end' as const,
    kind: 'currency' as const,
  },
  {
    key: 'state',
    label: _('account_backend.field.state'),
    kind: 'status' as const,
    cell: (row: PaymentListRow) =>
      badge(
        labelOf(_, 'paymentStatus', row.state),
        row.state === 'paid' ? 'positive' : row.state === 'reversed' ? 'warning' : 'neutral',
        String(row.state),
      ),
  },
]

export const paymentsListScreen = (_: Translator, options: PaymentsListScreenOptions): TemplateResult => {
  const status = [
    `${_('account_backend.payment.summary.total')}: ${String(options.summary.total)}`,
    `${_('account_backend.payment.summary.inbound')}: ${String(options.summary.inbound)}`,
    `${_('account_backend.payment.summary.outbound')}: ${String(options.summary.outbound)}`,
    `${_('account_backend.payment.summary.open')}: ${String(options.summary.open)}`,
  ].join(' · ')
  const collection = prepareCollectionTable(_, options.frame, {
    rows: options.rows,
    id: (row) => String(row.id),
    rowHref: options.rowHref,
    columns: paymentListColumns(_, options.partnerLabel),
    ...options.table,
  })
  const table =
    options.rows.length || options.table?.groups?.length ? (
      collectionTable(_, collection.table)
    ) : (
      <Surface
        padding="compact"
        body={emptyState(_('account_backend.payment.empty'), _('account_backend.payment.emptyHint'), {
          icon: icon('credit-card'),
        })}
      />
    )

  return shell(
    _,
    _('account_backend.payments.title'),
    <ListPage
      variant="operational"
      frame={collection.frame}
      title={_('account_backend.payments.title')}
      description={_('account_backend.payment.subtitle')}
      headerActions={
        <LinkButton
          label={_('account_backend.action.registerPayment')}
          href={options.createHref}
          variant="primary"
        />
      }
      actions={collectionActions(_, collection.frame)}
      controls={collectionControls(_, _('account_backend.payments.title'), collection.frame)}
      footer={status}
      body={table}
    />,
    { ...collection.frame, chrome: null, topbar: false },
  )
}
