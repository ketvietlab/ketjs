import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  bulkActions,
  code,
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

export type WarehouseListRow = {
  id: string
  name: string
  code: string
  receptionSteps: string
  deliverySteps: string
}

export type WarehousesListScreenOptions = {
  rows: WarehouseListRow[]
  /** Localized `/admin/stock/warehouses/new` URL supplied by the route. */
  createHref: string
  total?: number
  table?: Partial<DataTable<WarehouseListRow>>
}

const selectionLabel = (_: Translator, group: string, value: string): string => {
  const key = `stock_backend.${group}.${value}`
  return _.resolves(key) ? _(key) : value
}

export const warehouseListColumns = (_: Translator): Array<Column<WarehouseListRow>> => [
  {
    key: 'name',
    label: _('stock_backend.warehouse.col.name'),
    cell: (row) => row.name,
    priority: 'primary',
    width: 'wide',
  },
  {
    key: 'code',
    label: _('stock_backend.warehouse.col.code'),
    cell: (row) => code(row.code, 'identifier'),
    kind: 'identifier',
    priority: 'secondary',
  },
  {
    key: 'receptionSteps',
    label: _('stock_backend.warehouse.col.reception'),
    cell: (row) => badge(selectionLabel(_, 'receptionSteps', row.receptionSteps)),
  },
  {
    key: 'deliverySteps',
    label: _('stock_backend.warehouse.col.delivery'),
    cell: (row) => badge(selectionLabel(_, 'deliverySteps', row.deliverySteps)),
  },
]

/** List-only warehouse surface. Creation belongs to the dedicated `/new` form. */
export const warehousesListScreen = (
  _: Translator,
  options: WarehousesListScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const total = options.total ?? options.rows.length
  const selection = options.table?.selection ?? frame.chrome?.selection

  return shell(
    _,
    _('stock_backend.warehouses'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('stock_backend.warehouse.title')}
      description={_('stock_backend.warehouse.subtitle')}
      actions={inline([
        <LinkButton label={_('stock_backend.action.create')} href={options.createHref} variant="primary" />,
        selection ? bulkActions(_, selection) : '',
        frame.extras?.['topbar.end'] ?? '',
      ])}
      controls={
        frame.chrome
          ? listChrome(
              _,
              _('stock_backend.warehouse.title'),
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
      status={`${_('stock_backend.warehouse.summary.total')}: ${String(total)}`}
      body={
        options.rows.length || options.table?.groups?.length
          ? dataTable(_, {
              columns: warehouseListColumns(_),
              rows: options.rows,
              id: (row) => row.id,
              ...options.table,
            })
          : emptyState(_('stock_backend.warehouse.empty'), _('stock_backend.warehouse.emptyHint'), {
              icon: icon('warehouse'),
            })
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
