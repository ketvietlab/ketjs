import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  code,
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
import { labelOf } from './screens.tsx'

type Row = Record<string, unknown>

export const accountsScreen = (
  _: Translator,
  options: {
    frame: Frame
    fields: FormField[]
    rows: Row[]
    action: string
    errors?: string[]
  },
): TemplateResult => {
  const count = (prefixes: string[]) =>
    options.rows.filter((row) => prefixes.some((prefix) => String(row.accountType).startsWith(prefix))).length
  const table = options.rows.length ? (
    dataTable(_, {
      rows: options.rows,
      id: (row) => String(row.id),
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
          label: _('account_backend.field.accountType'),
          cell: (row) => labelOf(_, 'accountType', row.accountType),
        },
        {
          key: 'reconcile',
          label: _('account_backend.field.reconcile'),
          cell: (row) =>
            badge(
              row.reconcile ? _('account_backend.yes') : _('account_backend.no'),
              row.reconcile ? 'positive' : 'neutral',
              row.reconcile ? 'yes' : 'no',
            ),
        },
      ],
    })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('account_backend.account.empty'), _('account_backend.account.emptyHint'), {
        icon: icon('notebook-tabs'),
      })}
    />
  )

  return (
    <Framed
      translator={_}
      title={_('account_backend.accounts.title')}
      frame={options.frame}
      body={
        <RecordWorkspace
          kicker={_('account_backend.account.kicker')}
          title={_('account_backend.accounts.title')}
          subtitle={_('account_backend.account.subtitle')}
          imageFallback={icon('notebook-tabs')}
          summary={[
            { id: 'total', label: _('account_backend.account.summary.total'), value: options.rows.length },
            { id: 'asset', label: _('account_backend.account.summary.asset'), value: count(['asset']) },
            {
              id: 'liability',
              label: _('account_backend.account.summary.liability'),
              value: count(['liability', 'equity']),
            },
            {
              id: 'profit',
              label: _('account_backend.account.summary.profit'),
              value: count(['income', 'expense']),
            },
          ]}
          body={stack(
            [
              <Section
                title={_('account_backend.account.create.title')}
                description={_('account_backend.account.create.hint')}
                body={
                  <Surface
                    padding="compact"
                    body={
                      <RecordForm
                        id="account-create-form"
                        scope="account-chart"
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
                title={_('account_backend.account.list.title')}
                description={_('account_backend.account.list.hint')}
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
