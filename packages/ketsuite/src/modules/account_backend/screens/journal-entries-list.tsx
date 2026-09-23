import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  collectionActions,
  collectionControls,
  collectionTable,
  emptyState,
  icon,
  LinkButton,
  ListPage,
  prepareCollectionTable,
  shell,
  Surface,
} from '../../../ui/index.ts'
import type { DataTable, Frame } from '../../../ui/index.ts'
import { labelOf, moveTitle } from './shared.tsx'

export type JournalEntryListRow = Record<string, unknown>

export type JournalEntryListSummary = {
  total: number
  draft: number
  posted: number
}

export type JournalEntriesListScreenOptions = {
  frame: Frame
  rows: JournalEntryListRow[]
  createHref: string
  rowHref: (row: JournalEntryListRow) => string
  summary: JournalEntryListSummary
  table?: Partial<DataTable<JournalEntryListRow>>
}

export const journalEntryListColumns = (_: Translator) => [
  {
    key: 'name',
    label: _('account_backend.field.name'),
    priority: 'primary' as const,
    width: 'wide' as const,
    cell: (row: JournalEntryListRow) => moveTitle(_, row),
  },
  {
    key: 'date',
    label: _('account_backend.field.date'),
    cell: (row: JournalEntryListRow) => String(row.accountingDate ?? row.date).slice(0, 10),
  },
  {
    key: 'reference',
    label: _('account_backend.field.ref'),
    width: 'wide' as const,
    cell: (row: JournalEntryListRow) => String(row.ref ?? '—'),
  },
  {
    key: 'state',
    label: _('account_backend.field.state'),
    kind: 'status' as const,
    cell: (row: JournalEntryListRow) =>
      badge(
        labelOf(_, 'moveState', row.state),
        row.state === 'posted' ? 'positive' : 'neutral',
        String(row.state),
      ),
  },
]

export const journalEntriesListScreen = (
  _: Translator,
  options: JournalEntriesListScreenOptions,
): TemplateResult => {
  const status = [
    `${_('account_backend.entry.summary.total')}: ${String(options.summary.total)}`,
    `${_('account_backend.entry.summary.draft')}: ${String(options.summary.draft)}`,
    `${_('account_backend.entry.summary.posted')}: ${String(options.summary.posted)}`,
  ].join(' · ')
  const collection = prepareCollectionTable(_, options.frame, {
    rows: options.rows,
    id: (row) => String(row.id),
    rowHref: options.rowHref,
    columns: journalEntryListColumns(_),
    ...options.table,
  })
  const table =
    options.rows.length || options.table?.groups?.length ? (
      collectionTable(_, collection.table)
    ) : (
      <Surface
        padding="compact"
        body={emptyState(_('account_backend.entry.empty'), _('account_backend.entry.emptyHint'), {
          icon: icon('notebook-tabs'),
        })}
      />
    )

  return shell(
    _,
    _('account_backend.entries.title'),
    <ListPage
      variant="operational"
      frame={collection.frame}
      title={_('account_backend.entries.title')}
      description={_('account_backend.entry.subtitle')}
      headerActions={
        <LinkButton label={_('account_backend.action.create')} href={options.createHref} variant="primary" />
      }
      actions={collectionActions(_, collection.frame)}
      controls={collectionControls(_, _('account_backend.entries.title'), collection.frame)}
      footer={status}
      body={table}
    />,
    { ...collection.frame, chrome: null, topbar: false },
  )
}
