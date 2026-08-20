import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  code,
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

type Row = Record<string, unknown>

export const trialBalanceScreen = (
  _: Translator,
  options: {
    frame: Frame
    fields: FormField[]
    rows: Row[]
    action: string
    currency: unknown
  },
): TemplateResult => {
  const total = (field: 'debit' | 'credit' | 'balance') =>
    options.rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0)
  const table = options.rows.length ? (
    dataTable(_, {
      rows: options.rows,
      id: (row) => String(row.id ?? row.accountId),
      columns: [
        {
          key: 'code',
          label: _('account_backend.field.code'),
          priority: 'primary',
          cell: (row) => code(String(row.code)),
        },
        { key: 'name', label: _('account_backend.field.name'), cell: (row) => String(row.name) },
        {
          key: 'debit',
          label: _('account_backend.field.debit'),
          cell: (row) => formatMoney(_, row.debit, options.currency),
          align: 'end',
          kind: 'currency',
        },
        {
          key: 'credit',
          label: _('account_backend.field.credit'),
          cell: (row) => formatMoney(_, row.credit, options.currency),
          align: 'end',
          kind: 'currency',
        },
        {
          key: 'balance',
          label: _('account_backend.field.balance'),
          cell: (row) => formatMoney(_, row.balance, options.currency),
          align: 'end',
          kind: 'currency',
        },
      ],
    })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('account_backend.trial.empty'), _('account_backend.trial.emptyHint'), {
        icon: icon('notebook-tabs'),
      })}
    />
  )

  return framed(
    _,
    _('account_backend.trialBalance.title'),
    options.frame,
    <RecordWorkspace
      kicker={_('account_backend.trial.kicker')}
      title={_('account_backend.trialBalance.title')}
      subtitle={_('account_backend.trial.subtitle')}
      imageFallback={icon('notebook-tabs')}
      summary={[
        {
          id: 'debit',
          label: _('account_backend.trial.summary.debit'),
          value: formatMoney(_, total('debit'), options.currency),
        },
        {
          id: 'credit',
          label: _('account_backend.trial.summary.credit'),
          value: formatMoney(_, total('credit'), options.currency),
        },
        {
          id: 'balance',
          label: _('account_backend.trial.summary.balance'),
          value: formatMoney(_, total('balance'), options.currency),
        },
      ]}
      body={stack(
        [
          <Section
            title={_('account_backend.trial.filter.title')}
            description={_('account_backend.trial.filter.hint')}
            body={
              <Surface
                padding="compact"
                body={
                  <RecordForm
                    id="trial-balance-filter-form"
                    scope="account-trial-balance"
                    action={options.action}
                    method="get"
                    submit={_('account_backend.action.calculate')}
                    submitVariant="secondary"
                    fields={options.fields}
                  />
                }
              />
            }
          />,
          <Section
            title={_('account_backend.trial.result.title')}
            description={_('account_backend.trial.result.hint')}
            body={table}
          />,
        ],
        'loose',
      )}
    />,
  )
}
