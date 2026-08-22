import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
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

type Row = Record<string, unknown>

export const paymentTermsScreen = (
  _: Translator,
  options: {
    frame: Frame
    termFields: FormField[]
    lineFields?: FormField[]
    rows: Row[]
    action: string
    editing?: Row | null
    submit?: string
    rowHref?: (row: Row) => string
    cancelHref?: string
    errors?: string[]
    lineErrors?: string[]
    editingLine?: Row | null
    lineSubmit?: string
    lineAction?: string
    lineHref?: (line: Row) => string
    lineCancelHref?: string
    delayLabel?: (line: Row) => string
    valueLabel?: (line: Row) => string
  },
): TemplateResult => {
  const linesOf = (row: Row): Row[] => (Array.isArray(row.lines) ? (row.lines as Row[]) : [])
  const lineCount = options.rows.reduce((total, row) => total + linesOf(row).length, 0)
  const configured = options.rows.filter((row) => linesOf(row).length > 0).length
  // A term is defined by its milestones. Counting them and hiding them left the
  // screen unable to answer what "30 days" actually means.
  const milestones = options.rows
    .flatMap((row) => linesOf(row).map((line): Row & { term: Row } => ({ ...line, term: row })))
    .sort(
      (a, b) =>
        String(a.term.name).localeCompare(String(b.term.name)) ||
        Number(a.sequence ?? 0) - Number(b.sequence ?? 0),
    )
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
          key: 'lines',
          label: _('account_backend.terms.lines'),
          cell: (row) => String(Array.isArray(row.lines) ? row.lines.length : 0),
        },
        { key: 'note', label: _('account_backend.field.note'), cell: (row) => String(row.note ?? '—') },
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
                title={
                  options.editing
                    ? _('account_backend.term.edit.title')
                    : _('account_backend.term.create.title')
                }
                description={
                  options.editing ? String(options.editing.name) : _('account_backend.term.create.hint')
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
                        id="payment-term-create-form"
                        scope="account-payment-term"
                        action={options.action}
                        submit={options.submit ?? _('account_backend.action.createTerm')}
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
                      title={
                        options.editingLine
                          ? _('account_backend.term.line.edit.title')
                          : _('account_backend.term.line.create.title')
                      }
                      description={_('account_backend.term.line.create.hint')}
                      actions={
                        options.editingLine && options.lineCancelHref
                          ? linkButton({
                              label: _('account_backend.action.cancelEdit'),
                              href: options.lineCancelHref,
                            })
                          : undefined
                      }
                      body={
                        <Surface
                          padding="compact"
                          body={
                            <RecordForm
                              id="payment-term-line-form"
                              scope="account-payment-term-line"
                              action={options.lineAction ?? options.action}
                              submit={options.lineSubmit ?? _('account_backend.action.addTermLine')}
                              submitVariant="secondary"
                              hidden={{ action: 'line' }}
                              fields={options.lineFields}
                              errors={options.lineErrors}
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
              <Section
                title={_('account_backend.term.milestones.title')}
                description={_('account_backend.term.milestones.hint')}
                body={
                  milestones.length ? (
                    dataTable(_, {
                      rows: milestones,
                      id: (line) => String(line.id),
                      rowHref: options.lineHref,
                      columns: [
                        {
                          key: 'term',
                          label: _('account_backend.field.paymentTermId'),
                          priority: 'primary',
                          cell: (line) => String((line.term as Row).name),
                        },
                        {
                          key: 'value',
                          label: _('account_backend.field.termValue'),
                          cell: (line) =>
                            `${String(line.valueAmount)}${line.value === 'percent' ? '%' : ''} · ${options.valueLabel?.(line) ?? String(line.value)}`,
                        },
                        {
                          key: 'delay',
                          label: _('account_backend.field.delayType'),
                          cell: (line) => options.delayLabel?.(line) ?? String(line.delayType),
                        },
                        {
                          key: 'days',
                          label: _('account_backend.field.nbDays'),
                          cell: (line) => String(line.nbDays ?? 0),
                          align: 'end',
                          kind: 'number',
                        },
                        {
                          key: 'dayOfMonth',
                          label: _('account_backend.field.daysNextMonth'),
                          cell: (line) => String(line.daysNextMonth ?? '—'),
                          align: 'end',
                          kind: 'number',
                        },
                      ],
                    })
                  ) : (
                    <Surface
                      padding="compact"
                      body={emptyState(
                        _('account_backend.term.milestones.empty'),
                        _('account_backend.term.milestones.emptyHint'),
                        { icon: icon('credit-card') },
                      )}
                    />
                  )
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
