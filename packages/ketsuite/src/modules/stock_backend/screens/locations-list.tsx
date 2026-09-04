import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  bulkActions,
  dataTable,
  emptyState,
  icon,
  inline,
  LinkButton,
  ListPage,
  listChrome,
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
  const total = options.total ?? options.rows.length
  const selection = options.table?.selection ?? frame.chrome?.selection

  return shell(
    _,
    _('stock_backend.locations'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('stock_backend.location.title')}
      description={_('stock_backend.location.subtitle')}
      actions={inline([
        <LinkButton label={_('stock_backend.action.create')} href={options.createHref} variant="primary" />,
        selection ? bulkActions(_, selection) : '',
        frame.extras?.['topbar.end'] ?? '',
      ])}
      controls={
        frame.chrome
          ? listChrome(
              _,
              _('stock_backend.location.title'),
              {
                ...frame.chrome,
                layout: 'command',
                section: undefined,
                create: null,
                selection: null,
              },
              false,
            )
          : undefined
      }
      status={`${_('stock_backend.location.configured.title')}: ${String(total)}`}
      body={
        options.rows.length || options.table?.groups?.length
          ? dataTable(_, {
              columns: locationListColumns(_),
              rows: options.rows,
              id: (row) => row.id,
              ...options.table,
            })
          : emptyState(_('stock_backend.location.empty'), _('stock_backend.location.emptyHint'), {
              icon: icon('warehouse'),
            })
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
