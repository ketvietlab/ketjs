import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  code,
  dataTable,
  DatePicker,
  emptyState,
  formatMoney,
  ListScreen,
  icon,
  linkButton,
  Notice,
  RecordWorkspace,
  Section,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { DatePickerField, Frame } from '../../../ui/index.ts'
import { addDecimals } from '../../account/money.ts'

export type TrialBalanceRow = Record<string, unknown>

export type TrialBalanceScreenOptions = {
  frame: Frame
  /** From and to. This report is a date range and nothing else. */
  fields: readonly [DatePickerField, DatePickerField]
  rows: TrialBalanceRow[]
  action: string
  locale?: string
  currency: unknown
  /** The ledger behind a balance. A total nobody can open is a number to trust blindly. */
  ledgerHref?: (row: TrialBalanceRow) => string
  errors?: readonly string[]
}

/** A specialized financial report: filter, control totals, and drillable account rows. */
export const trialBalanceScreen = (_: Translator, options: TrialBalanceScreenOptions): TemplateResult => {
  const total = (field: 'debit' | 'credit' | 'balance') =>
    options.rows.reduce((sum, row) => addDecimals(sum, row[field] ?? '0'), '0')
  const table = options.rows.length ? (
    dataTable(_, {
      rows: options.rows,
      id: (row) => String(row.id ?? row.accountId),
      columns: [
        {
          key: 'code',
          label: _('account_backend.field.code'),
          priority: 'primary',
          cell: (row) =>
            options.ledgerHref
              ? linkButton({
                  label: String(row.code),
                  href: options.ledgerHref(row),
                  variant: 'tertiary',
                })
              : code(String(row.code)),
        },
        {
          key: 'name',
          label: _('account_backend.field.name'),
          cell: (row) => String((_.locale.startsWith('en') && row.nameEn) || row.name),
        },
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

  return (
    <ListScreen
      translator={_}
      title={_('account_backend.trialBalance.title')}
      frame={options.frame}
      body={
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
              options.errors?.length ? (
                <Notice
                  tone="danger"
                  title={_('account_backend.trial.filter.title')}
                  message={options.errors.join(' · ')}
                />
              ) : null,
              <Section
                title={_('account_backend.trial.filter.title')}
                description={_('account_backend.trial.filter.hint')}
                body={
                  <Surface
                    padding="compact"
                    body={
                      <DatePicker
                        action={options.action}
                        label={_('account_backend.trial.filter.title')}
                        fields={options.fields}
                        hidden={options.locale ? { lang: options.locale } : undefined}
                        submit={_('account_backend.action.calculate')}
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
        />
      }
    />
  )
}
