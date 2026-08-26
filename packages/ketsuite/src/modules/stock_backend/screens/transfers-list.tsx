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

export type TransferListRow = {
  id: string
  name: string
  operationType: string
  source: string
  destination: string
  scheduledDate: string
  state: string
  /** Localized detail URL supplied by the route. */
  href: string
}

export type TransfersListScreenOptions = {
  rows: TransferListRow[]
  /** Localized `/admin/stock/transfers/new` URL supplied by the route. */
  createHref: string
  total?: number
  table?: Partial<DataTable<TransferListRow>>
}

const stateTone = (state: string): 'positive' | 'danger' | 'neutral' => {
  if (state === 'done') return 'positive'
  if (state === 'cancel') return 'danger'
  return 'neutral'
}

const selectionLabel = (_: Translator, group: string, value: string): string => {
  const key = `stock_backend.${group}.${value}`
  return _.resolves(key) ? _(key) : value
}

export const transferListColumns = (_: Translator): Array<Column<TransferListRow>> => [
  {
    key: 'name',
    label: _('stock_backend.transfer.list.col.reference'),
    cell: (row) => row.name,
    priority: 'primary',
    width: 'wide',
  },
  {
    key: 'source',
    label: _('stock_backend.transfer.list.col.source'),
    cell: (row) => row.source,
    priority: 'secondary',
  },
  {
    key: 'destination',
    label: _('stock_backend.transfer.list.col.destination'),
    cell: (row) => row.destination,
    priority: 'secondary',
  },
  {
    key: 'scheduledDate',
    label: _('stock_backend.transfer.list.col.scheduledDate'),
    cell: (row) => row.scheduledDate || '—',
    kind: 'date',
  },
  {
    key: 'operationType',
    label: _('stock_backend.transfer.list.col.operationType'),
    cell: (row) => row.operationType,
    optional: true,
  },
  {
    key: 'state',
    label: _('stock_backend.transfer.list.col.state'),
    cell: (row) => badge(selectionLabel(_, 'state', row.state), stateTone(row.state), row.state),
    kind: 'status',
  },
]

/** List-only transfer surface. Creation belongs to the dedicated `/new` form. */
export const transfersListScreen = (
  _: Translator,
  options: TransfersListScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const total = options.total ?? options.rows.length
  const selection = options.table?.selection ?? frame.chrome?.selection

  return shell(
    _,
    _('stock_backend.transfers'),
    <ListPage
      title={_('stock_backend.transfer.list.title')}
      description={_('stock_backend.transfer.list.subtitle')}
      actions={inline([
        <LinkButton label={_('stock_backend.action.create')} href={options.createHref} variant="primary" />,
        selection ? bulkActions(_, selection) : '',
        frame.extras?.['topbar.end'] ?? '',
      ])}
      controls={
        frame.chrome
          ? listChrome(
              _,
              _('stock_backend.transfer.list.title'),
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
      status={`${_('stock_backend.transfer.list.records.title')}: ${String(total)}`}
      body={
        options.rows.length || options.table?.groups?.length
          ? dataTable(_, {
              columns: transferListColumns(_),
              rows: options.rows,
              id: (row) => row.id,
              rowHref: (row) => row.href,
              ...options.table,
            })
          : emptyState(_('stock_backend.transfer.list.empty'), _('stock_backend.transfer.list.emptyHint'), {
              icon: icon('truck'),
            })
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
