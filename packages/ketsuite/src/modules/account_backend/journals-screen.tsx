import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  code,
  dataTable,
  emptyState,
  framed,
  icon,
  recordForm as RecordForm,
  recordWorkspace as RecordWorkspace,
  section as Section,
  stack,
  surface as Surface,
} from '../../ui/index.ts'
import type { FormField, Frame } from '../../ui/index.ts'
import { labelOf } from './screens.ts'

type Row = Record<string, unknown>

export const journalsScreen = (
  _: Translator,
  options: {
    frame: Frame
    fields: FormField[]
    rows: Row[]
    accounts: Row[]
    action: string
    errors?: string[]
  },
): TemplateResult => {
  const accountLabels = new Map(
    options.accounts.map((account) => [
      String(account.id),
      `${String(account.code)} · ${String(account.name)}`,
    ]),
  )
  const liquidity = options.rows.filter((row) => ['bank', 'cash'].includes(String(row.type))).length
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
          label: _('account_backend.field.type'),
          cell: (row) => labelOf(_, 'journalType', row.type),
        },
        {
          key: 'account',
          label: _('account_backend.field.defaultAccountId'),
          cell: (row) => accountLabels.get(String(row.defaultAccountId)) ?? '—',
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

  return framed(
    _,
    _('account_backend.journals.title'),
    options.frame,
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
            title={_('account_backend.journal.create.title')}
            description={_('account_backend.journal.create.hint')}
            body={
              <Surface
                padding="compact"
                body={
                  <RecordForm
                    id="journal-create-form"
                    scope="account-journal"
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
            title={_('account_backend.journal.list.title')}
            description={_('account_backend.journal.list.hint')}
            body={table}
          />,
        ],
        'loose',
      )}
    />,
  )
}
