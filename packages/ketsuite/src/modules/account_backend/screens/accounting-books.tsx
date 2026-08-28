import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  code,
  dataTable,
  formatMoney,
  Framed,
  icon,
  RecordForm,
  RecordWorkspace,
  Section,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
type Row = Record<string, unknown>

export const accountingBooksScreen = (
  _: Translator,
  options: {
    frame: Frame
    fields: FormField[]
    action: string
    result?: Row
    currency: unknown
    errors?: string[]
    entryHref: (row: Row) => string
  },
): TemplateResult => {
  const rows = (options.result?.rows as Row[] | undefined) ?? []
  return (
    <Framed
      translator={_}
      title={_('account_backend.books.title')}
      frame={options.frame}
      body={
        <RecordWorkspace
          kicker={_('account_backend.menu.reporting')}
          title={_('account_backend.books.title')}
          subtitle={_('account_backend.books.subtitle')}
          imageFallback={icon('library-big')}
          summary={
            options.result
              ? [
                  {
                    id: 'opening',
                    label: _('account_backend.books.opening'),
                    value: String(options.result.opening),
                  },
                  {
                    id: 'debit',
                    label: _('account_backend.field.debit'),
                    value: String(options.result.debit),
                  },
                  {
                    id: 'credit',
                    label: _('account_backend.field.credit'),
                    value: String(options.result.credit),
                  },
                  {
                    id: 'closing',
                    label: _('account_backend.books.closing'),
                    value: String(options.result.closing),
                  },
                ]
              : []
          }
          body={stack(
            [
              <Section
                title={_('account_backend.books.filter')}
                description={_('account_backend.books.filterHint')}
                body={
                  <Surface
                    body={
                      <RecordForm
                        id="book-filter-form"
                        scope="account-book"
                        action={options.action}
                        method="get"
                        submit={_('account_backend.action.calculate')}
                        submitVariant="secondary"
                        fields={options.fields}
                        errors={options.errors}
                      />
                    }
                  />
                }
              />,
              <Section
                title={_('account_backend.books.result')}
                description={_('account_backend.books.resultHint')}
                body={
                  <Surface
                    padding="compact"
                    body={dataTable(_, {
                      rows,
                      id: (row) => String(row.id),
                      rowHref: options.entryHref,
                      columns: [
                        {
                          key: 'date',
                          label: _('account_backend.field.accountingDate'),
                          priority: 'primary',
                          cell: (row) => String(row.accountingDate),
                        },
                        {
                          key: 'entry',
                          label: _('account_backend.field.entry'),
                          cell: (row) => code(String(row.moveName)),
                        },
                        {
                          key: 'journal',
                          label: _('account_backend.field.journalId'),
                          cell: (row) => code(String(row.journalCode)),
                        },
                        {
                          key: 'account',
                          label: _('account_backend.field.accountId'),
                          cell: (row) => code(String(row.accountCode)),
                        },
                        {
                          key: 'description',
                          label: _('account_backend.field.name'),
                          cell: (row) => String(row.description ?? ''),
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
                          key: 'running',
                          label: _('account_backend.books.running'),
                          cell: (row) => formatMoney(_, row.runningBalance, options.currency),
                          align: 'end',
                          kind: 'currency',
                        },
                      ],
                    })}
                  />
                }
              />,
            ],
            'loose',
          )}
        />
      }
    />
  )
}
