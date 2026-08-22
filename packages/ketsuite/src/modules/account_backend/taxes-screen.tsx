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
import type { FormField, Frame } from '../../ui/index.ts'
import { labelOf } from './screens.tsx'

type Row = Record<string, unknown>

export const taxesScreen = (
  _: Translator,
  options: {
    frame: Frame
    fields: FormField[]
    rows: Row[]
    accounts: Row[]
    action: string
    currency: unknown
    editing?: Row | null
    submit?: string
    rowHref?: (row: Row) => string
    cancelHref?: string
    errors?: string[]
  },
): TemplateResult => {
  const accountCodes = new Map(options.accounts.map((account) => [String(account.id), String(account.code)]))
  const table = options.rows.length ? (
    dataTable(_, {
      rows: options.rows,
      id: (row) => String(row.id),
      rowHref: options.rowHref,
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
              : `${String(row.amount)}%`,
          align: 'end',
          kind: 'number',
        },
        {
          key: 'account',
          label: _('account_backend.field.accountId'),
          cell: (row) => (row.accountId ? (accountCodes.get(String(row.accountId)) ?? '—') : '—'),
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
        {
          key: 'base',
          // The field label spells the rule out; a column header only has to name it.
          label: _('account_backend.column.includeBaseAmount'),
          cell: (row) =>
            badge(
              row.includeBaseAmount ? _('account_backend.yes') : _('account_backend.no'),
              row.includeBaseAmount ? 'positive' : 'neutral',
              row.includeBaseAmount ? 'yes' : 'no',
            ),
        },
        {
          key: 'active',
          label: _('account_backend.field.active'),
          cell: (row) =>
            badge(
              row.active ? _('account_backend.active') : _('account_backend.archived'),
              row.active ? 'positive' : 'neutral',
              row.active ? 'active' : 'archived',
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

  return (
    <Framed
      translator={_}
      title={_('account_backend.taxes.title')}
      frame={options.frame}
      body={
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
                title={
                  options.editing
                    ? _('account_backend.tax.edit.title')
                    : _('account_backend.tax.create.title')
                }
                description={
                  options.editing ? String(options.editing.name) : _('account_backend.tax.create.hint')
                }
                actions={
                  options.editing && options.cancelHref
                    ? linkButton({ label: _('account_backend.action.cancelEdit'), href: options.cancelHref })
                    : undefined
                }
                body={
                  <Surface
                    padding="compact"
                    body={
                      <RecordForm
                        id="tax-create-form"
                        scope="account-tax"
                        action={options.action}
                        submit={options.submit ?? _('account_backend.action.create')}
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
        />
      }
    />
  )
}
