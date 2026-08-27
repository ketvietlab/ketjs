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
  LinkButton,
  ListPage,
  linkButton,
  listChrome,
  shell,
} from '../../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../../ui/index.ts'
import { labelOf } from './shared.tsx'

export type QuotationListRow = Record<string, unknown>

export type QuotationsListScreenOptions = {
  rows: QuotationListRow[]
  /** Localized `/admin/sales/quotations/new` URL, including retained list state. */
  createHref: string
  /** Locale-only suffix used by record and report links. */
  detailSuffix: string
  /** The quotation document, when it is installed and published. */
  printReport?: { id: string; title: string } | undefined
  total?: number
  table?: Partial<DataTable<QuotationListRow>>
}

const stateTone = (state: unknown): 'neutral' | 'info' | 'danger' =>
  state === 'sent' ? 'info' : state === 'cancel' ? 'danger' : 'neutral'

export const quotationListColumns = (
  _: Translator,
  detailSuffix: string,
  printReport: { id: string; title: string } | undefined,
): Array<Column<QuotationListRow>> => [
  {
    key: 'name',
    label: _('sale_backend.field.name'),
    priority: 'primary',
    width: 'wide',
    cell: (row) => String(row.name),
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
    key: 'validity',
    label: _('sale_backend.field.validityDate'),
    cell: (row) => (row.validityDate ? String(row.validityDate).slice(0, 10) : '—'),
    kind: 'date',
  },
  {
    key: 'state',
    label: _('sale_backend.field.state'),
    cell: (row) => badge(labelOf(_, 'state', row.state), stateTone(row.state), String(row.state)),
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
          cell: (row: QuotationListRow) =>
            linkButton({
              label: _('backend.print.label'),
              href: `/reports/${encodeURIComponent(printReport.id)}/${encodeURIComponent(String(row.id))}${detailSuffix}`,
              variant: 'tertiary',
            }),
        },
      ]
    : []),
]

/** List-only quotation surface. Creation belongs to the dedicated `/new` form. */
export const quotationsListScreen = (
  _: Translator,
  options: QuotationsListScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const total = options.total ?? options.rows.length
  const draft = options.rows.filter((row) => row.state === 'draft').length
  const sent = options.rows.filter((row) => row.state === 'sent').length
  const cancelled = options.rows.filter((row) => row.state === 'cancel').length
  const selection = options.table?.selection ?? frame.chrome?.selection
  const summary = [
    `${_('sale_backend.quotation.summary.total')}: ${String(total)}`,
    `${_('sale_backend.quotation.summary.draft')}: ${String(draft)}`,
    `${_('sale_backend.quotation.summary.sent')}: ${String(sent)}`,
    `${_('sale_backend.quotation.summary.cancelled')}: ${String(cancelled)}`,
  ].join(' · ')

  return shell(
    _,
    _('sale_backend.quotations.title'),
    <ListPage
      title={_('sale_backend.quotation.title')}
      description={_('sale_backend.quotation.subtitle')}
      actions={inline([
        <LinkButton label={_('sale_backend.action.create')} href={options.createHref} variant="primary" />,
        selection ? bulkActions(_, selection) : '',
        frame.extras?.['topbar.end'] ?? '',
      ])}
      controls={
        frame.chrome
          ? listChrome(
              _,
              _('sale_backend.quotation.title'),
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
              columns: quotationListColumns(_, options.detailSuffix, options.printReport),
              rows: options.rows,
              id: (row) => String(row.id),
              rowHref: (row) => `/admin/sales/quotations/${String(row.id)}${options.detailSuffix}`,
              ...options.table,
            })
          : emptyState(_('sale_backend.quotation.empty'), _('sale_backend.quotation.emptyHint'), {
              icon: icon('shopping-bag'),
            })
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
