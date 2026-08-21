import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  dataTable,
  emptyState,
  formatMoney,
  framedPage as Framed,
  icon,
  recordForm as RecordForm,
  recordWorkspace as RecordWorkspace,
  section as Section,
  stack,
  surface as Surface,
} from '../../ui/index.ts'
import type { FormField, Frame } from '../../ui/index.ts'

type Row = Record<string, unknown>

export const partnerLedgerScreen = (
  _: Translator,
  options: {
    frame: Frame
    fields: FormField[]
    rows: Row[]
    action: string
    currency: unknown
    selected: boolean
  },
): TemplateResult => {
  const total = (field: 'debit' | 'credit' | 'amountResidual') =>
    options.rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0)
  const table = options.rows.length ? (
    dataTable(_, {
      rows: options.rows,
      id: (row) => String(row.id),
      columns: [
        {
          key: 'date',
          label: _('account_backend.field.date'),
          priority: 'primary',
          cell: (row) => String((row.move as Row)?.date ?? '').slice(0, 10),
        },
        {
          key: 'entry',
          label: _('account_backend.field.entry'),
          cell: (row) => String((row.move as Row)?.name ?? ''),
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
              value: formatMoney(_, total('debit'), options.currency),
            },
            {
              id: 'credit',
              label: _('account_backend.partnerLedger.summary.credit'),
              value: formatMoney(_, total('credit'), options.currency),
            },
            {
              id: 'residual',
              label: _('account_backend.partnerLedger.summary.residual'),
              value: formatMoney(_, total('amountResidual'), options.currency),
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
