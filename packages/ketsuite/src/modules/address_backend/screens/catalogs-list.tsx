import { prepareCollectionTable } from '../../../ui/index.ts'
import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  collectionControls,
  badge,
  collectionTable,
  emptyState,
  ListPage,
  RecordActions,
  shell,
} from '../../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../../ui/index.ts'
import type { CatalogRow } from './types.ts'

export type CatalogListRow = CatalogRow & { detailHref: string; installAction: string }
export type CatalogsListScreenOptions = {
  rows: readonly CatalogListRow[]
  /** What the search-filter bar decided about the table, such as its groups. */
  table?: Partial<DataTable<CatalogListRow>>
}

export const catalogListColumns = (_: Translator): Array<Column<CatalogListRow>> => [
  {
    key: 'country',
    label: _('address_backend.field.country'),
    priority: 'primary',
    width: 'wide',
    cell: (row) => (row.countryCode === 'VN' ? _('address_backend.country.VN') : row.countryCode),
  },
  { key: 'version', label: _('address_backend.field.version'), cell: (row) => row.version },
  {
    key: 'status',
    label: _('address_backend.field.status'),
    kind: 'status',
    cell: (row) =>
      badge(
        row.installed ? _('address_backend.state.installed') : _('address_backend.state.available'),
        row.installed ? 'positive' : 'neutral',
      ),
  },
  {
    key: 'records',
    label: _('address_backend.field.records'),
    cell: (row) => (row.recordCount == null ? '—' : String(row.recordCount)),
  },
  {
    key: 'actions',
    label: _('address_backend.field.actions'),
    align: 'end',
    cell: (row) =>
      row.installed ? (
        _('address_backend.action.open')
      ) : (
        <RecordActions
          action={row.installAction}
          actions={[{ value: row.version, label: _('address_backend.action.install'), variant: 'primary' }]}
        />
      ),
  },
]

export const catalogsScreen = (
  _: Translator,
  frame: Frame,
  options: CatalogsListScreenOptions,
): TemplateResult => {
  const prepared = prepareCollectionTable(
    _,
    frame,
    {
      rows: options.rows,
      id: (row) => `${row.countryCode}:${row.version}`,
      rowHref: (row) => row.detailHref,
      columns: catalogListColumns(_),
      ...options.table,
    },
    { paginate: !options.table?.groups },
  )
  frame = prepared.frame
  return shell(
    _,
    _('address_backend.title'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('address_backend.title')}
      controls={collectionControls(_, _('address_backend.title'), frame)}
      description={_('address_backend.hint')}
      status={`${_('address_backend.title')}: ${String(options.rows.length)}`}
      body={
        options.rows.length || options.table?.groups?.length
          ? collectionTable(_, prepared.table)
          : emptyState(_('address_backend.empty'), _('address_backend.emptyHint'))
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
