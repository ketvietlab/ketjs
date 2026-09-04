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

export type PickingTypeListRow = {
  id: string
  name: string
  code: string
  warehouse: string
  source: string
  destination: string
  createBackorder: string
}

export type PickingTypesListScreenOptions = {
  rows: PickingTypeListRow[]
  /** Locale-aware `/admin/stock/picking-types/new` URL supplied by the route. */
  createHref: string
  table?: Partial<DataTable<PickingTypeListRow>>
}

const selectionLabel = (_: Translator, group: string, value: string): string => {
  const key = `stock_backend.${group}.${value}`
  return _.resolves(key) ? _(key) : value
}

const operationTone = (code: string): 'info' | 'positive' | 'neutral' => {
  if (code === 'incoming') return 'positive'
  if (code === 'outgoing') return 'info'
  return 'neutral'
}

export const pickingTypeListColumns = (_: Translator): Array<Column<PickingTypeListRow>> => [
  {
    key: 'name',
    label: _('stock_backend.pickingType.col.name'),
    cell: (row) => row.name,
    priority: 'primary',
    width: 'wide',
  },
  {
    key: 'code',
    label: _('stock_backend.pickingType.col.code'),
    cell: (row) => badge(selectionLabel(_, 'pickingType', row.code), operationTone(row.code), row.code),
    kind: 'status',
    priority: 'secondary',
  },
  {
    key: 'warehouse',
    label: _('stock_backend.pickingType.col.warehouse'),
    cell: (row) => row.warehouse || '—',
    priority: 'secondary',
  },
  {
    key: 'route',
    label: _('stock_backend.pickingType.col.route'),
    cell: (row) => `${row.source || '—'} → ${row.destination || '—'}`,
  },
  {
    key: 'createBackorder',
    label: _('stock_backend.pickingType.col.backorder'),
    cell: (row) => badge(selectionLabel(_, 'backorder', row.createBackorder)),
    optional: true,
  },
]

/** List-only operation-type surface. Creation belongs to the dedicated `/new` form. */
export const pickingTypesListScreen = (
  _: Translator,
  options: PickingTypesListScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const incomingCount = options.rows.filter((row) => row.code === 'incoming').length
  const outgoingCount = options.rows.filter((row) => row.code === 'outgoing').length
  const internalCount = options.rows.filter((row) => row.code === 'internal').length
  const selection = options.table?.selection ?? frame.chrome?.selection

  return shell(
    _,
    _('stock_backend.pickingTypes'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('stock_backend.pickingType.title')}
      description={_('stock_backend.pickingType.subtitle')}
      actions={inline([
        <LinkButton label={_('stock_backend.action.create')} href={options.createHref} variant="primary" />,
        selection ? bulkActions(_, selection) : '',
        frame.extras?.['topbar.end'] ?? '',
      ])}
      controls={
        frame.chrome
          ? listChrome(
              _,
              _('stock_backend.pickingType.title'),
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
      status={inline([
        badge(`${_('stock_backend.pickingType.summary.incoming')}: ${incomingCount}`, 'positive'),
        badge(`${_('stock_backend.pickingType.summary.outgoing')}: ${outgoingCount}`, 'info'),
        badge(`${_('stock_backend.pickingType.summary.internal')}: ${internalCount}`, 'neutral'),
      ])}
      body={
        options.rows.length || options.table?.groups?.length
          ? dataTable(_, {
              columns: pickingTypeListColumns(_),
              rows: options.rows,
              id: (row) => row.id,
              ...options.table,
            })
          : emptyState(_('stock_backend.pickingType.empty'), _('stock_backend.pickingType.emptyHint'), {
              icon: icon('truck'),
            })
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
