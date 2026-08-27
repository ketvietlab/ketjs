import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  code,
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
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

export type PartnerStatementRow = Record<string, unknown>

export type PartnerStatementSummary = {
  debit: number
  credit: number
  residual: number
}

export type PartnerStatementScreenOptions = {
  frame: Frame
  fields: FormField[]
  rows: PartnerStatementRow[]
  summary: PartnerStatementSummary
  action: string
  currency: unknown
  selected: boolean
  hidden?: Record<string, string>
  errors?: readonly string[]
  accountLabel?: (id: unknown) => string
  /** The document behind a balance, so a partner's ledger is not a dead end. */
  entryHref?: (row: PartnerStatementRow) => string
}

/** A specialized receivable/payable report with exact totals above its paged movements. */
export const partnerLedgerScreen = (
  _: Translator,
  options: PartnerStatementScreenOptions,
): TemplateResult => {
  const table = options.rows.length ? (
    dataTable(_, {
      rows: options.rows,
      id: (row) => String(row.id),
      columns: [
        {
          key: 'date',
          label: _('account_backend.field.date'),
          priority: 'primary',
          cell: (row) => String((row.move as PartnerStatementRow)?.date ?? '').slice(0, 10),
        },
        {
          key: 'entry',
          label: _('account_backend.field.entry'),
          cell: (row) =>
            options.entryHref
              ? linkButton({
                  label: String((row.move as PartnerStatementRow)?.name ?? ''),
                  href: options.entryHref(row),
                  variant: 'tertiary',
                })
              : String((row.move as PartnerStatementRow)?.name ?? ''),
        },
        {
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
        {
          key: 'residual',
          label: _('account_backend.field.residual'),
          cell: (row) => formatMoney(_, row.amountResidual, options.currency),
          align: 'end',
          kind: 'currency',
        },
      ],
    })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(
        options.selected
          ? _('account_backend.partnerLedger.empty')
          : _('account_backend.partnerLedger.select'),
        options.selected
          ? _('account_backend.partnerLedger.emptyHint')
          : _('account_backend.partnerLedger.selectHint'),
        { icon: icon('credit-card') },
      )}
    />
  )

  return (
    <Framed
      translator={_}
      title={_('account_backend.partnerStatement.title')}
      frame={options.frame}
      body={
        <RecordWorkspace
          kicker={_('account_backend.partnerLedger.kicker')}
          title={_('account_backend.partnerStatement.title')}
          subtitle={_('account_backend.partnerLedger.subtitle')}
          imageFallback={icon('credit-card')}
          summary={[
            {
              id: 'debit',
              label: _('account_backend.partnerLedger.summary.debit'),
              value: formatMoney(_, options.summary.debit, options.currency),
            },
            {
              id: 'credit',
              label: _('account_backend.partnerLedger.summary.credit'),
              value: formatMoney(_, options.summary.credit, options.currency),
            },
            {
              id: 'residual',
              label: _('account_backend.partnerLedger.summary.residual'),
              value: formatMoney(_, options.summary.residual, options.currency),
            },
          ]}
          body={stack(
            [
              <Section
                title={_('account_backend.partnerLedger.filter.title')}
                description={_('account_backend.partnerLedger.filter.hint')}
                body={
                  <Surface
                    padding="compact"
                    body={
                      <RecordForm
                        id="partner-ledger-filter-form"
                        scope="account-partner-ledger"
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
                title={_('account_backend.partnerLedger.result.title')}
                description={_('account_backend.partnerLedger.result.hint')}
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
