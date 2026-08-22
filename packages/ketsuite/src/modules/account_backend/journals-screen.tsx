import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  code,
  dataTable,
  emptyState,
  badge,
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
import { labelOf } from './screens.tsx'

type Row = Record<string, unknown>

export const journalsScreen = (
  _: Translator,
  options: {
    frame: Frame
    fields: FormField[]
    rows: Row[]
    accounts: Row[]
    action: string
    editing?: Row | null
    submit?: string
    rowHref?: (row: Row) => string
    cancelHref?: string
    displayName?: (row: Row) => string
    errors?: string[]
  },
): TemplateResult => {
  const accountName = options.displayName ?? ((row: Row) => String(row.name))
  const accountLabels = new Map(
    options.accounts.map((account) => [
      String(account.id),
      `${String(account.code)} · ${accountName(account)}`,
    ]),
  )
  const liquidity = options.rows.filter((row) => ['bank', 'cash'].includes(String(row.type))).length
  const table = options.rows.length ? (
    dataTable(_, {
      rows: options.rows,
      id: (row) => String(row.id),
      rowHref: options.rowHref,
      columns: [
        {
          key: 'code',
          label: _('account_backend.field.code'),
          priority: 'primary',
          cell: (row) => code(String(row.code)),
        },
        { key: 'name', label: _('account_backend.field.name'), cell: (row) => String(row.name) },
        {
          key: 'type',
          label: _('account_backend.field.type'),
          cell: (row) => labelOf(_, 'journalType', row.type),
        },
        {
          key: 'account',
          label: _('account_backend.field.defaultAccountId'),
          cell: (row) => accountLabels.get(String(row.defaultAccountId)) ?? '—',
        },
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
      body={emptyState(_('account_backend.journal.empty'), _('account_backend.journal.emptyHint'), {
        icon: icon('notebook-tabs'),
      })}
    />
  )

  return (
    <Framed
      translator={_}
      title={_('account_backend.journals.title')}
      frame={options.frame}
      body={
        <RecordWorkspace
          kicker={_('account_backend.journal.kicker')}
          title={_('account_backend.journals.title')}
          subtitle={_('account_backend.journal.subtitle')}
          imageFallback={icon('notebook-tabs')}
          summary={[
            { id: 'total', label: _('account_backend.journal.summary.total'), value: options.rows.length },
            {
              id: 'sale',
              label: _('account_backend.journal.summary.sale'),
              value: options.rows.filter((row) => row.type === 'sale').length,
            },
            {
              id: 'purchase',
              label: _('account_backend.journal.summary.purchase'),
              value: options.rows.filter((row) => row.type === 'purchase').length,
            },
            { id: 'liquidity', label: _('account_backend.journal.summary.liquidity'), value: liquidity },
          ]}
          body={stack(
            [
              <Section
                title={
                  options.editing
                    ? _('account_backend.journal.edit.title')
                    : _('account_backend.journal.create.title')
                }
                description={
                  options.editing
                    ? `${String(options.editing.code)} · ${String(options.editing.name)}`
                    : _('account_backend.journal.create.hint')
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
                        id="journal-create-form"
                        scope="account-journal"
                        action={options.action}
                        submit={options.submit ?? _('account_backend.action.create')}
                        submitVariant="primary"
                        fields={options.fields}
                        errors={options.errors}
                      />
                    }
                  />
                }
              />,
              <Section
                title={_('account_backend.journal.list.title')}
                description={_('account_backend.journal.list.hint')}
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
