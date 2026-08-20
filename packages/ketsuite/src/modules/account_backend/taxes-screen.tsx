import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  formatMoney,
  framed,
  icon,
  recordForm as RecordForm,
  recordWorkspace as RecordWorkspace,
  section as Section,
  stack,
  surface as Surface,
} from '../../ui/index.ts'
import type { FormField, Frame } from '../../ui/index.ts'
import { labelOf } from './screens.ts'

type Row = Record<string, unknown>

export const taxesScreen = (
  _: Translator,
  options: {
    frame: Frame
    fields: FormField[]
    rows: Row[]
    action: string
    currency: unknown
    errors?: string[]
  },
): TemplateResult => {
  const table = options.rows.length ? (
    dataTable(_, {
      rows: options.rows,
      id: (row) => String(row.id),
      columns: [
        {
          key: 'name',
          label: _('account_backend.field.name'),
          priority: 'primary',
          cell: (row) => String(row.name),
        },
        {
          key: 'use',
          label: _('account_backend.field.typeTaxUse'),
          cell: (row) => labelOf(_, 'taxUse', row.typeTaxUse),
        },
        {
          key: 'computation',
          label: _('account_backend.field.amountType'),
          cell: (row) => labelOf(_, 'taxAmountType', row.amountType),
        },
        {
          key: 'amount',
          label: _('account_backend.field.amount'),
          cell: (row) =>
            row.amountType === 'fixed'
              ? formatMoney(_, row.amount, options.currency)
              : row.amountType === 'group'
                ? '—'
                : `${String(row.amount)}%`,
          align: 'end',
          kind: 'number',
        },
        {
          key: 'included',
          label: _('account_backend.field.priceInclude'),
          cell: (row) =>
            badge(
              row.priceInclude ? _('account_backend.yes') : _('account_backend.no'),
              row.priceInclude ? 'positive' : 'neutral',
              row.priceInclude ? 'yes' : 'no',
            ),
        },
      ],
    })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('account_backend.tax.empty'), _('account_backend.tax.emptyHint'), {
        icon: icon('banknote'),
      })}
    />
  )

  return framed(
    _,
    _('account_backend.taxes.title'),
    options.frame,
    <RecordWorkspace
      kicker={_('account_backend.tax.kicker')}
      title={_('account_backend.taxes.title')}
      subtitle={_('account_backend.tax.subtitle')}
      imageFallback={icon('banknote')}
      summary={[
        { id: 'total', label: _('account_backend.tax.summary.total'), value: options.rows.length },
        {
          id: 'sale',
          label: _('account_backend.tax.summary.sale'),
          value: options.rows.filter((row) => row.typeTaxUse === 'sale').length,
        },
        {
          id: 'purchase',
          label: _('account_backend.tax.summary.purchase'),
          value: options.rows.filter((row) => row.typeTaxUse === 'purchase').length,
        },
        {
          id: 'included',
          label: _('account_backend.tax.summary.included'),
          value: options.rows.filter((row) => row.priceInclude).length,
        },
      ]}
      body={stack(
        [
          <Section
            title={_('account_backend.tax.create.title')}
            description={_('account_backend.tax.create.hint')}
            body={
              <Surface
                padding="compact"
                body={
                  <RecordForm
                    id="tax-create-form"
                    scope="account-tax"
                    action={options.action}
                    submit={_('account_backend.action.create')}
                    submitVariant="primary"
                    fields={options.fields}
                    errors={options.errors}
                  />
                }
              />
            }
          />,
          <Section
            title={_('account_backend.tax.list.title')}
            description={_('account_backend.tax.list.hint')}
            body={table}
          />,
        ],
        'loose',
      )}
    />,
  )
}
