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
  RecordForm,
  shell,
} from '../../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../../ui/index.ts'

export type ReplenishmentListRow = {
  id: string
  product: string
  warehouse: string
  location: string
  trigger: string
  triggerLabel: string
  minQuantity: string
  maxQuantity: string
  forecasted: string
  toOrder: string
  replenishmentUom: string
  /** Locale-aware run endpoint supplied by the route. */
  runAction: string
}

export type ReplenishmentListScreenOptions = {
  rows: ReplenishmentListRow[]
  /** Localized `/admin/stock/replenishment/new` URL supplied by the route. */
  createHref: string
  total?: number
  table?: Partial<DataTable<ReplenishmentListRow>>
}

export const replenishmentListColumns = (_: Translator): Array<Column<ReplenishmentListRow>> => [
  {
    key: 'product',
    label: _('stock_backend.replenishment.col.product'),
    cell: (row) => row.product,
    priority: 'primary',
    width: 'wide',
  },
  {
    key: 'location',
    label: _('stock_backend.field.location'),
    cell: (row) => `${row.warehouse} · ${row.location}`,
    priority: 'secondary',
  },
  {
    key: 'forecasted',
    label: _('stock_backend.replenishment.col.forecasted'),
    cell: (row) => row.forecasted,
    kind: 'number',
  },
  {
    key: 'minimum',
    label: _('stock_backend.field.minQuantity'),
    cell: (row) => row.minQuantity,
    kind: 'number',
  },
  {
    key: 'maximum',
    label: _('stock_backend.field.maxQuantity'),
    cell: (row) => row.maxQuantity,
    kind: 'number',
  },
  {
    key: 'toOrder',
    label: _('stock_backend.replenishment.col.toOrder'),
    cell: (row) => badge(row.toOrder, Number(row.toOrder) > 0 ? 'warning' : 'neutral'),
    kind: 'number',
  },
  {
    key: 'uom',
    label: _('stock_backend.field.replenishmentUom'),
    cell: (row) => row.replenishmentUom,
  },
  {
    key: 'trigger',
    label: _('stock_backend.field.trigger'),
    cell: (row) => badge(row.triggerLabel, row.trigger === 'auto' ? 'positive' : 'info'),
  },
  {
    key: 'action',
    label: _('stock_backend.replenishment.col.action'),
    cell: (row) => (
      <RecordForm
        action={row.runAction}
        submit={_('stock_backend.action.run')}
        submitVariant="secondary"
        submitSize="compact"
        layout="inline"
        fields={[]}
      />
    ),
  },
]

/** List-only reordering-rule surface. Creation belongs to the dedicated `/new` form. */
export const replenishmentListScreen = (
  _: Translator,
  options: ReplenishmentListScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const total = options.total ?? options.rows.length
  const selection = options.table?.selection ?? frame.chrome?.selection

  return shell(
    _,
    _('stock_backend.replenishment'),
    <ListPage
      title={_('stock_backend.replenishment.title')}
      description={_('stock_backend.replenishment.subtitle')}
      actions={inline([
        <LinkButton label={_('stock_backend.action.create')} href={options.createHref} variant="primary" />,
        selection ? bulkActions(_, selection) : '',
        frame.extras?.['topbar.end'] ?? '',
      ])}
      controls={
        frame.chrome
          ? listChrome(
              _,
              _('stock_backend.replenishment.title'),
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
      status={`${_('stock_backend.replenishment.summary.rules')}: ${String(total)}`}
      body={
        options.rows.length || options.table?.groups?.length
          ? dataTable(_, {
              columns: replenishmentListColumns(_),
              rows: options.rows,
              id: (row) => row.id,
              ...options.table,
            })
          : emptyState(_('stock_backend.replenishment.empty'), _('stock_backend.replenishment.emptyHint'), {
              icon: icon('warehouse'),
            })
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
