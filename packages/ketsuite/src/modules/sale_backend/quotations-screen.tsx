import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  formatMoney,
  framed,
  icon,
  linkButton,
  recordForm as RecordForm,
  recordWorkspace as RecordWorkspace,
  section as Section,
  stack,
  surface as Surface,
} from '../../ui/index.ts'
import type { Column, FormField, Frame } from '../../ui/index.ts'
import { labelOf } from './screens.ts'

type QuotationRow = Record<string, unknown>

export type QuotationsScreenOptions = {
  rows: QuotationRow[]
  fields: FormField[]
  frame: Frame
  action: string
  detailSuffix: string
  errors?: string[]
}

const stateTone = (state: unknown): 'neutral' | 'info' => (state === 'sent' ? 'info' : 'neutral')

const columns = (_: Translator, detailSuffix: string): Array<Column<QuotationRow>> => [
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
]

export const quotationsScreen = (_: Translator, options: QuotationsScreenOptions): TemplateResult => {
  const draft = options.rows.filter((row) => row.state === 'draft').length
  const sent = options.rows.filter((row) => row.state === 'sent').length
  const table = options.rows.length ? (
    dataTable(_, {
      columns: columns(_, options.detailSuffix),
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

  return framed(
    _,
    _('sale_backend.quotations.title'),
    options.frame,
    <RecordWorkspace
      kicker={_('sale_backend.quotation.kicker')}
      title={_('sale_backend.quotation.title')}
      subtitle={_('sale_backend.quotation.subtitle')}
      imageFallback={icon('shopping-bag')}
      summary={[
        { id: 'total', label: _('sale_backend.quotation.summary.total'), value: options.rows.length },
        { id: 'draft', label: _('sale_backend.quotation.summary.draft'), value: draft },
        { id: 'sent', label: _('sale_backend.quotation.summary.sent'), value: sent },
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
    />,
  )
}
