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
} from '../../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../../ui/index.ts'

export type LocationListRow = {
  id: string
  /** Complete hierarchy path supplied by the route. */
  completeName: string
  usage: string
  warehouse: string
}

export type LocationsListScreenOptions = {
  rows: LocationListRow[]
  /** Localized `/admin/stock/locations/new` URL supplied by the route. */
  createHref: string
  total?: number
  table?: Partial<DataTable<LocationListRow>>
}

const selectionLabel = (_: Translator, group: string, value: string): string => {
  const key = `stock_backend.${group}.${value}`
  return _.resolves(key) ? _(key) : value
}

const usageTone = (usage: string): 'info' | 'positive' | 'neutral' => {
  if (usage === 'internal') return 'positive'
  if (usage === 'view') return 'info'
  return 'neutral'
}

export const locationListColumns = (_: Translator): Array<Column<LocationListRow>> => [
  {
    key: 'completeName',
    label: _('stock_backend.location.col.location'),
    cell: (row) => row.completeName,
    priority: 'primary',
    width: 'wide',
  },
  {
    key: 'usage',
    label: _('stock_backend.location.col.usage'),
    cell: (row) => badge(selectionLabel(_, 'usage', row.usage), usageTone(row.usage), row.usage),
    kind: 'status',
    priority: 'secondary',
  },
  {
    key: 'warehouse',
    label: _('stock_backend.location.col.warehouse'),
    cell: (row) => row.warehouse || '—',
  },
]

/** List-only location tree. Creation belongs to the dedicated `/new` form. */
export const locationsListScreen = (
  _: Translator,
  options: LocationsListScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const collection = prepareCollectionTable(
    _,
    frame,
    {
      columns: locationListColumns(_),
      rows: options.rows,
      id: (row) => row.id,
      ...options.table,
    },
    { paginate: options.total === undefined && !options.table?.groups },
  )
  const total = options.total ?? options.rows.length
  const selection = options.table?.selection ?? collection.frame.chrome?.selection

  return shell(
    _,
    _('stock_backend.locations'),
    <ListPage
      variant="operational"
      frame={collection.frame}
      title={_('stock_backend.location.title')}
      description={_('stock_backend.location.subtitle')}
      headerActions={
        <LinkButton label={_('stock_backend.action.create')} href={options.createHref} variant="primary" />
      }
      actions={collectionActions(_, collection.frame, undefined, selection)}
      controls={collectionControls(_, _('stock_backend.location.title'), collection.frame)}
      footer={`${_('stock_backend.location.configured.title')}: ${String(total)}`}
      body={
        options.rows.length || options.table?.groups?.length
          ? collectionTable(_, collection.table)
          : emptyState(_('stock_backend.location.empty'), _('stock_backend.location.emptyHint'), {
              icon: icon('warehouse'),
            })
      }
    />,
    { ...collection.frame, chrome: null, topbar: false },
  )
}
