import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  code,
  dataTable,
  emptyState,
  icon,
  inline,
  LinkButton,
  ListPage,
  listChrome,
  shell,
  Surface,
} from '../../../ui/index.ts'
import type { DataTable, Frame } from '../../../ui/index.ts'
import { labelOf } from './shared.tsx'

export type JournalListRow = Record<string, unknown>

export type JournalListSummary = {
  total: number
  sale: number
  purchase: number
  liquidity: number
}

export type JournalsListScreenOptions = {
  frame: Frame
  rows: JournalListRow[]
  accounts: JournalListRow[]
  createHref: string
  rowHref: (row: JournalListRow) => string
  displayAccountName?: (row: JournalListRow) => string
  summary: JournalListSummary
  table?: Partial<DataTable<JournalListRow>>
}

export const journalListColumns = (_: Translator, accountLabels: ReadonlyMap<string, string>) => [
  {
    key: 'code',
    label: _('account_backend.field.code'),
    priority: 'primary' as const,
    width: 'medium' as const,
    cell: (row: JournalListRow) => code(String(row.code)),
  },
  {
    key: 'name',
    label: _('account_backend.field.name'),
    width: 'wide' as const,
    cell: (row: JournalListRow) => String(row.name),
  },
  {
    key: 'type',
    label: _('account_backend.field.type'),
    cell: (row: JournalListRow) => labelOf(_, 'journalType', row.type),
  },
  {
    key: 'account',
    label: _('account_backend.field.defaultAccountId'),
    width: 'wide' as const,
    cell: (row: JournalListRow) => accountLabels.get(String(row.defaultAccountId)) ?? '—',
  },
  {
    key: 'active',
    label: _('account_backend.field.active'),
    kind: 'status' as const,
    cell: (row: JournalListRow) =>
      badge(
        row.active ? _('account_backend.active') : _('account_backend.archived'),
        row.active ? 'positive' : 'neutral',
        row.active ? 'active' : 'archived',
      ),
  },
]

export const journalsListScreen = (_: Translator, options: JournalsListScreenOptions): TemplateResult => {
  const accountName = options.displayAccountName ?? ((row: JournalListRow) => String(row.name))
  const accountLabels = new Map(
    options.accounts.map((account) => [
      String(account.id),
      `${String(account.code)} · ${accountName(account)}`,
    ]),
  )
  const status = [
    `${_('account_backend.journal.summary.total')}: ${String(options.summary.total)}`,
    `${_('account_backend.journal.summary.sale')}: ${String(options.summary.sale)}`,
    `${_('account_backend.journal.summary.purchase')}: ${String(options.summary.purchase)}`,
    `${_('account_backend.journal.summary.liquidity')}: ${String(options.summary.liquidity)}`,
  ].join(' · ')
  const table =
    options.rows.length || options.table?.groups?.length ? (
      dataTable(_, {
        rows: options.rows,
        id: (row) => String(row.id),
        rowHref: options.rowHref,
        columns: journalListColumns(_, accountLabels),
        ...options.table,
      })
    ) : (
      <Surface
        padding="compact"
        body={emptyState(_('account_backend.journal.empty'), _('account_backend.journal.emptyHint'), {
          icon: icon('notebook-tabs'),
        })}
      />
    )

  return shell(
    _,
    _('account_backend.journals.title'),
    <ListPage
      variant="operational"
      frame={options.frame}
      title={_('account_backend.journals.title')}
      description={_('account_backend.journal.subtitle')}
      actions={inline([
        <LinkButton label={_('account_backend.action.create')} href={options.createHref} variant="primary" />,
        options.frame.extras?.['topbar.end'] ?? '',
      ])}
      controls={
        options.frame.chrome
          ? listChrome(
              _,
              _('account_backend.journals.title'),
              {
                ...options.frame.chrome,
                layout: 'command',
                section: undefined,
                create: null,
                selection: null,
              },
              false,
            )
          : undefined
      }
      status={status}
      body={table}
    />,
    { ...options.frame, chrome: null, topbar: false },
  )
}
