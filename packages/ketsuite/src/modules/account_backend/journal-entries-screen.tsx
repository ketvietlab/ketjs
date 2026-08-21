import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  framedPage as Framed,
  icon,
  linkButton,
  recordForm as RecordForm,
  recordWorkspace as RecordWorkspace,
  section as Section,
  stack,
  surface as Surface,
} from '../../ui/index.ts'
import type { FormField, Frame } from '../../ui/index.ts'
import { labelOf } from './screens.tsx'

type Row = Record<string, unknown>

export const journalEntriesScreen = (
  _: Translator,
  options: {
    frame: Frame
    fields: FormField[]
    rows: Row[]
    action: string
    locale: string
    errors?: string[]
  },
): TemplateResult => {
  const draft = options.rows.filter((row) => row.state === 'draft').length
  const posted = options.rows.filter((row) => row.state === 'posted').length
  const table = options.rows.length ? (
    dataTable(_, {
      rows: options.rows,
      id: (row) => String(row.id),
      columns: [
        {
          key: 'name',
          label: _('account_backend.field.name'),
          priority: 'primary',
          cell: (row) =>
            linkButton({
              label: String(row.name),
              href: `/admin/journal-entries/${String(row.id)}${options.locale}`,
              variant: 'tertiary',
            }),
        },
        { key: 'date', label: _('account_backend.field.date'), cell: (row) => String(row.date).slice(0, 10) },
        {
          key: 'reference',
          label: _('account_backend.field.ref'),
          cell: (row) => String(row.ref ?? '—'),
        },
        {
          key: 'state',
          label: _('account_backend.field.state'),
          cell: (row) =>
            badge(
              labelOf(_, 'moveState', row.state),
              row.state === 'posted' ? 'positive' : 'neutral',
              String(row.state),
            ),
        },
      ],
    })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('account_backend.entry.empty'), _('account_backend.entry.emptyHint'), {
        icon: icon('notebook-tabs'),
      })}
    />
  )

  return (
    <Framed
      translator={_}
      title={_('account_backend.entries.title')}
      frame={options.frame}
      body={
        <RecordWorkspace
          kicker={_('account_backend.entry.kicker')}
          title={_('account_backend.entries.title')}
          subtitle={_('account_backend.entry.subtitle')}
          imageFallback={icon('notebook-tabs')}
          summary={[
            { id: 'total', label: _('account_backend.entry.summary.total'), value: options.rows.length },
            { id: 'draft', label: _('account_backend.entry.summary.draft'), value: draft },
            { id: 'posted', label: _('account_backend.entry.summary.posted'), value: posted },
          ]}
          body={stack(
            [
              <Section
                title={_('account_backend.entry.create.title')}
                description={_('account_backend.entry.create.hint')}
                body={
                  <Surface
                    padding="compact"
                    body={
                      <RecordForm
                        id="journal-entry-create-form"
                        scope="account-journal-entry"
                        action={options.action}
                        submit={_('account_backend.action.create')}
                        submitVariant="primary"
                        fields={options.fields}
                        errors={options.errors}
                      />
                    }
                  />
                }
              />,
              <Section
                title={_('account_backend.entry.list.title')}
                description={_('account_backend.entry.list.hint')}
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
