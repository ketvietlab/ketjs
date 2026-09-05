import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  code,
  dataTable,
  emptyState,
  formatMoney,
  ListScreen,
  icon,
  linkButton,
  RecordForm,
  RecordWorkspace,
  Section,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

export type GeneralLedgerRow = Record<string, unknown>

export type GeneralLedgerSummary = {
  lines: number
  debit: unknown
  credit: unknown
}

export type GeneralLedgerScreenOptions = {
  frame: Frame
  fields: FormField[]
  rows: GeneralLedgerRow[]
  summary: GeneralLedgerSummary
  action: string
  currency: unknown
  hidden?: Record<string, string>
  errors?: readonly string[]
  accountLabel?: (id: unknown) => string
  entryHref?: (row: GeneralLedgerRow) => string
}

/** A specialized journal report: URL-owned filters, exact control totals, and paged lines. */
export const generalLedgerScreen = (_: Translator, options: GeneralLedgerScreenOptions): TemplateResult => {
  const table = options.rows.length ? (
    dataTable(_, {
      rows: options.rows,
      id: (row) => String(row.id),
      columns: [
        {
          key: 'date',
          label: _('account_backend.field.date'),
          priority: 'primary',
          cell: (row) =>
            String(
              (row.move as GeneralLedgerRow)?.accountingDate ?? (row.move as GeneralLedgerRow)?.date ?? '',
            ).slice(0, 10),
        },
        {
          key: 'entry',
          label: _('account_backend.field.entry'),
          cell: (row) =>
            options.entryHref
              ? linkButton({
                  label: String((row.move as GeneralLedgerRow)?.name ?? ''),
                  href: options.entryHref(row),
                  variant: 'tertiary',
                })
              : String((row.move as GeneralLedgerRow)?.name ?? ''),
        },
        {
          // A general ledger without the account each line posts to is a list of
          // amounts. With no filter chosen it is every account at once.
          key: 'account',
          label: _('account_backend.field.accountId'),
          cell: (row) => code(options.accountLabel?.(row.accountId) ?? String(row.accountId)),
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
      ],
    })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('account_backend.ledger.empty'), _('account_backend.ledger.emptyHint'), {
        icon: icon('notebook-tabs'),
      })}
    />
  )

  return (
    <ListScreen
      translator={_}
      title={_('account_backend.generalLedger.title')}
      frame={options.frame}
      body={
        <RecordWorkspace
          kicker={_('account_backend.ledger.kicker')}
          title={_('account_backend.generalLedger.title')}
          subtitle={_('account_backend.ledger.subtitle')}
          imageFallback={icon('notebook-tabs')}
          summary={[
            {
              id: 'lines',
              label: _('account_backend.ledger.summary.lines'),
              value: options.summary.lines,
            },
            {
              id: 'debit',
              label: _('account_backend.ledger.summary.debit'),
              value: formatMoney(_, options.summary.debit, options.currency),
            },
            {
              id: 'credit',
              label: _('account_backend.ledger.summary.credit'),
              value: formatMoney(_, options.summary.credit, options.currency),
            },
          ]}
          body={stack(
            [
              <Section
                title={_('account_backend.ledger.filter.title')}
                description={_('account_backend.ledger.filter.hint')}
                body={
                  <Surface
                    padding="compact"
                    body={
                      <RecordForm
                        id="general-ledger-filter-form"
                        scope="account-general-ledger"
                        action={options.action}
                        method="get"
                        submit={_('account_backend.action.calculate')}
                        submitVariant="secondary"
                        fields={options.fields}
                        hidden={options.hidden}
                        errors={options.errors}
                      />
                    }
                  />
                }
              />,
              <Section
                title={_('account_backend.ledger.result.title')}
                description={_('account_backend.ledger.result.hint')}
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
