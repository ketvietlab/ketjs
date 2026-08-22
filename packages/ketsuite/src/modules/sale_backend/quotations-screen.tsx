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
  RecordForm,
  RecordWorkspace,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { Column, FormField, Frame } from '../../ui/index.ts'
import { labelOf } from './screens.tsx'

type QuotationRow = Record<string, unknown>

export type QuotationsScreenOptions = {
  rows: QuotationRow[]
  fields: FormField[]
  frame: Frame
  action: string
  detailSuffix: string
  /** The quotation document, when it is installed and published. */
  printReport?: { id: string; title: string } | undefined
  errors?: string[]
}

const stateTone = (state: unknown): 'neutral' | 'info' | 'danger' =>
  state === 'sent' ? 'info' : state === 'cancel' ? 'danger' : 'neutral'

const columns = (
  _: Translator,
  detailSuffix: string,
  printReport: { id: string; title: string } | undefined,
): Array<Column<QuotationRow>> => [
  {
    key: 'name',
    label: _('sale_backend.field.name'),
    priority: 'primary',
    cell: (row) =>
      linkButton({
        label: String(row.name),
        href: `/admin/sales/quotations/${String(row.id)}${detailSuffix}`,
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
    key: 'validity',
    label: _('sale_backend.field.validityDate'),
    cell: (row) => (row.validityDate ? String(row.validityDate).slice(0, 10) : '—'),
  },
  {
    key: 'state',
    label: _('sale_backend.field.state'),
    cell: (row) => badge(labelOf(_, 'state', row.state), stateTone(row.state), String(row.state)),
  },
  {
    key: 'total',
    label: _('sale_backend.field.amountTotal'),
    cell: (row) => formatMoney(_, row.amountTotal, row.currency),
    align: 'end',
    kind: 'currency',
  },
  // Printing meant opening the record first, one at a time.
  ...(printReport
    ? [
        {
          key: 'print',
          label: _('backend.print.label'),
          align: 'end' as const,
          cell: (row: QuotationRow) =>
            linkButton({
              label: _('backend.print.label'),
              href: `/reports/${encodeURIComponent(printReport.id)}/${encodeURIComponent(String(row.id))}${detailSuffix}`,
              variant: 'tertiary',
            }),
        },
      ]
    : []),
]

export const quotationsScreen = (_: Translator, options: QuotationsScreenOptions): TemplateResult => {
  const draft = options.rows.filter((row) => row.state === 'draft').length
  const sent = options.rows.filter((row) => row.state === 'sent').length
  const cancelled = options.rows.filter((row) => row.state === 'cancel').length
  const table = options.rows.length ? (
    dataTable(_, {
      columns: columns(_, options.detailSuffix, options.printReport),
      rows: options.rows,
      id: (row) => String(row.id),
    })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('sale_backend.quotation.empty'), _('sale_backend.quotation.emptyHint'), {
        icon: icon('shopping-bag'),
      })}
    />
  )

  return (
    <Framed
      translator={_}
      title={_('sale_backend.quotations.title')}
      frame={options.frame}
      body={
        <RecordWorkspace
          kicker={_('sale_backend.quotation.kicker')}
          title={_('sale_backend.quotation.title')}
          subtitle={_('sale_backend.quotation.subtitle')}
          imageFallback={icon('shopping-bag')}
          summary={[
            { id: 'total', label: _('sale_backend.quotation.summary.total'), value: options.rows.length },
            { id: 'draft', label: _('sale_backend.quotation.summary.draft'), value: draft },
            { id: 'sent', label: _('sale_backend.quotation.summary.sent'), value: sent },
            { id: 'cancelled', label: _('sale_backend.quotation.summary.cancelled'), value: cancelled },
          ]}
          body={stack(
            [
              <Section
                title={_('sale_backend.quotation.create.title')}
                description={_('sale_backend.quotation.create.hint')}
                body={
                  <Surface
                    padding="compact"
                    body={
                      <RecordForm
                        id="quotation-create-form"
                        scope="sale-quotation-create"
                        action={options.action}
                        submit={_('sale_backend.action.create')}
                        submitVariant="primary"
                        errors={options.errors}
                        fields={options.fields}
                      />
                    }
                  />
                }
              />,
              <Section
                title={_('sale_backend.quotation.list.title')}
                description={_('sale_backend.quotation.list.hint')}
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
