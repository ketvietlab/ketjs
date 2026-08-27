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

export type AccountListRow = Record<string, unknown>

export type AccountListSummary = {
  total: number
  asset: number
  liability: number
  profit: number
}

export type AccountsListScreenOptions = {
  frame: Frame
  rows: AccountListRow[]
  createHref: string
  rowHref: (row: AccountListRow) => string
  displayName?: (row: AccountListRow) => string
  summary: AccountListSummary
  table?: Partial<DataTable<AccountListRow>>
}

export const accountListColumns = (_: Translator, displayName: (row: AccountListRow) => string) => [
  {
    key: 'code',
    label: _('account_backend.field.code'),
    priority: 'primary' as const,
    width: 'medium' as const,
    cell: (row: AccountListRow) => code(String(row.code)),
  },
  {
    key: 'name',
    label: _('account_backend.field.name'),
    width: 'wide' as const,
    cell: (row: AccountListRow) => displayName(row),
  },
  {
    key: 'type',
    label: _('account_backend.field.accountType'),
    cell: (row: AccountListRow) => labelOf(_, 'accountType', row.accountType),
  },
  {
    key: 'reconcile',
    label: _('account_backend.field.reconcile'),
    kind: 'status' as const,
    cell: (row: AccountListRow) =>
      badge(
        row.reconcile ? _('account_backend.yes') : _('account_backend.no'),
        row.reconcile ? 'positive' : 'neutral',
        row.reconcile ? 'yes' : 'no',
      ),
  },
  {
    key: 'active',
    label: _('account_backend.field.active'),
    kind: 'status' as const,
    cell: (row: AccountListRow) =>
      badge(
        row.active ? _('account_backend.active') : _('account_backend.archived'),
        row.active ? 'positive' : 'neutral',
        row.active ? 'active' : 'archived',
      ),
  },
]

export const accountsListScreen = (_: Translator, options: AccountsListScreenOptions): TemplateResult => {
  const name = options.displayName ?? ((row: AccountListRow) => String(row.name))
  const status = [
    `${_('account_backend.account.summary.total')}: ${String(options.summary.total)}`,
    `${_('account_backend.account.summary.asset')}: ${String(options.summary.asset)}`,
    `${_('account_backend.account.summary.liability')}: ${String(options.summary.liability)}`,
    `${_('account_backend.account.summary.profit')}: ${String(options.summary.profit)}`,
  ].join(' · ')
  const table =
    options.rows.length || options.table?.groups?.length ? (
      dataTable(_, {
        rows: options.rows,
        id: (row) => String(row.id),
        rowHref: options.rowHref,
        columns: accountListColumns(_, name),
        ...options.table,
      })
    ) : (
      <Surface
        padding="compact"
        body={emptyState(_('account_backend.account.empty'), _('account_backend.account.emptyHint'), {
          icon: icon('notebook-tabs'),
        })}
      />
    )

  return shell(
    _,
    _('account_backend.accounts.title'),
    <ListPage
      title={_('account_backend.accounts.title')}
      description={_('account_backend.account.subtitle')}
      actions={inline([
        <LinkButton label={_('account_backend.action.create')} href={options.createHref} variant="primary" />,
        options.frame.extras?.['topbar.end'] ?? '',
      ])}
      controls={
        options.frame.chrome
          ? listChrome(
              _,
              _('account_backend.accounts.title'),
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
