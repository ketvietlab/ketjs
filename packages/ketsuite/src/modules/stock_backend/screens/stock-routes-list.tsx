import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
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

export type StockRouteListRow = {
  id: string
  name: string
  sequence: number
  ruleCount: number
  /** Localized detail URL supplied by the route. */
  href: string
}

export type StockRoutesListScreenOptions = {
  rows: StockRouteListRow[]
  /** Localized `/admin/stock/routes/new` URL supplied by the route. */
  createHref: string
  total?: number
  table?: Partial<DataTable<StockRouteListRow>>
}

export const stockRouteListColumns = (_: Translator): Array<Column<StockRouteListRow>> => [
  {
    key: 'name',
    label: _('stock_backend.stockRoute.list.col.name'),
    cell: (row) => row.name,
    priority: 'primary',
    width: 'wide',
  },
  {
    key: 'sequence',
    label: _('stock_backend.stockRoute.list.col.sequence'),
    cell: (row) => String(row.sequence),
    kind: 'number',
  },
  {
    key: 'ruleCount',
    label: _('stock_backend.stockRoute.list.col.rules'),
    cell: (row) => String(row.ruleCount),
    kind: 'number',
    priority: 'secondary',
  },
]

/** List-only supply-route surface. Creation belongs to the dedicated `/new` form. */
export const stockRoutesListScreen = (
  _: Translator,
  options: StockRoutesListScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const total = options.total ?? options.rows.length
  const selection = options.table?.selection ?? frame.chrome?.selection

  return shell(
    _,
    _('stock_backend.routes'),
    <ListPage
      title={_('stock_backend.stockRoute.list.title')}
      description={_('stock_backend.stockRoute.list.subtitle')}
      actions={inline([
        <LinkButton label={_('stock_backend.action.create')} href={options.createHref} variant="primary" />,
        selection ? bulkActions(_, selection) : '',
        frame.extras?.['topbar.end'] ?? '',
      ])}
      controls={
        frame.chrome
          ? listChrome(
              _,
              _('stock_backend.stockRoute.list.title'),
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
      status={`${_('stock_backend.stockRoute.list.summary.total')}: ${String(total)}`}
      body={
        options.rows.length || options.table?.groups?.length
          ? dataTable(_, {
              columns: stockRouteListColumns(_),
              rows: options.rows,
              id: (row) => row.id,
              rowHref: (row) => row.href,
              ...options.table,
            })
          : emptyState(
              _('stock_backend.stockRoute.list.empty'),
              _('stock_backend.stockRoute.list.emptyHint'),
              { icon: icon('sliders-horizontal') },
            )
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
