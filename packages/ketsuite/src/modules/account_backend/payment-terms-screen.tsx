import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  dataTable,
  emptyState,
  Framed,
  icon,
  RecordForm,
  RecordWorkspace,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { FormField, Frame } from '../../ui/index.ts'

type Row = Record<string, unknown>

export const paymentTermsScreen = (
  _: Translator,
  options: {
    frame: Frame
    termFields: FormField[]
    lineFields?: FormField[]
    rows: Row[]
    action: string
    errors?: string[]
  },
): TemplateResult => {
  const lineCount = options.rows.reduce(
    (total, row) => total + (Array.isArray(row.lines) ? row.lines.length : 0),
    0,
  )
  const configured = options.rows.filter((row) => Array.isArray(row.lines) && row.lines.length > 0).length
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
          key: 'lines',
          label: _('account_backend.terms.lines'),
          cell: (row) => String(Array.isArray(row.lines) ? row.lines.length : 0),
        },
        { key: 'note', label: _('account_backend.field.note'), cell: (row) => String(row.note ?? '—') },
      ],
    })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('account_backend.term.empty'), _('account_backend.term.emptyHint'), {
        icon: icon('credit-card'),
      })}
    />
  )

  return (
    <Framed
      translator={_}
      title={_('account_backend.terms.title')}
      frame={options.frame}
      body={
        <RecordWorkspace
          kicker={_('account_backend.term.kicker')}
          title={_('account_backend.terms.title')}
          subtitle={_('account_backend.term.subtitle')}
          imageFallback={icon('credit-card')}
          summary={[
            { id: 'total', label: _('account_backend.term.summary.total'), value: options.rows.length },
            { id: 'configured', label: _('account_backend.term.summary.configured'), value: configured },
            { id: 'lines', label: _('account_backend.term.summary.lines'), value: lineCount },
          ]}
          body={stack(
            [
              <Section
                title={_('account_backend.term.create.title')}
                description={_('account_backend.term.create.hint')}
                body={
                  <Surface
                    padding="compact"
                    body={
                      <RecordForm
                        id="payment-term-create-form"
                        scope="account-payment-term"
                        action={options.action}
                        submit={_('account_backend.action.createTerm')}
                        submitVariant="primary"
                        fields={options.termFields}
                        errors={options.errors}
                      />
                    }
                  />
                }
              />,
              ...(options.lineFields
                ? [
                    <Section
                      title={_('account_backend.term.line.create.title')}
                      description={_('account_backend.term.line.create.hint')}
                      body={
                        <Surface
                          padding="compact"
                          body={
                            <RecordForm
                              id="payment-term-line-form"
                              scope="account-payment-term-line"
                              action={options.action}
                              submit={_('account_backend.action.addTermLine')}
                              submitVariant="secondary"
                              hidden={{ action: 'line' }}
                              fields={options.lineFields}
                            />
                          }
                        />
                      }
                    />,
                  ]
                : []),
              <Section
                title={_('account_backend.term.list.title')}
                description={_('account_backend.term.list.hint')}
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
