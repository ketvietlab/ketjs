import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
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

export const generalLedgerScreen = (
  _: Translator,
  options: {
    frame: Frame
    fields: FormField[]
    rows: Row[]
    action: string
    currency: unknown
  },
): TemplateResult => {
  const total = (field: 'debit' | 'credit') =>
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
    <Framed
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
            { id: 'lines', label: _('account_backend.ledger.summary.lines'), value: options.rows.length },
            {
              id: 'debit',
              label: _('account_backend.ledger.summary.debit'),
              value: formatMoney(_, total('debit'), options.currency),
            },
            {
              id: 'credit',
              label: _('account_backend.ledger.summary.credit'),
              value: formatMoney(_, total('credit'), options.currency),
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
