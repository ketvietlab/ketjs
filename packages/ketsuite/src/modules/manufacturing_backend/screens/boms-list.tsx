import {
  code,
  collectionActions,
  collectionControls,
  collectionTable,
  emptyState,
  LinkButton,
  ListPage,
  prepareCollectionTable,
  shell,
} from '../../../ui/index.ts'
import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Column, DataTable, Frame } from '../../../ui/index.ts'

export type BomListRow = {
  id: string
  code: string
  product: string
  quantity: string
}

export type BomsListScreenOptions = {
  /** Grouped rows the search-filter bar decided on, when the reader grouped. */
  table?: Partial<DataTable<BomListRow>>
  rows: BomListRow[]
  /** Locale-aware URL that opens the create modal over this collection. */
  createHref: string
}

export const bomListColumns = (_: Translator): Array<Column<BomListRow>> => [
  {
    key: 'code',
    label: _('manufacturing_backend.field.code'),
    cell: (row) => code(row.code, 'identifier'),
    kind: 'identifier',
    priority: 'primary',
  },
  {
    key: 'product',
    label: _('manufacturing_backend.field.product'),
    cell: (row) => row.product,
    priority: 'secondary',
    width: 'wide',
  },
  {
    key: 'quantity',
    label: _('manufacturing_backend.field.quantity'),
    cell: (row) => row.quantity,
    align: 'end',
  },
]

/** List-only BOM collection. Creation is a URL-owned modal layered by the route. */
export const bomsListScreen = (
  _: Translator,
  options: BomsListScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const collection = prepareCollectionTable(
    _,
    frame,
    {
      rows: options.rows,
      id: (row) => row.id,
      columns: bomListColumns(_),
      ...options.table,
    },
    { paginate: !options.table?.groups },
  )
  return shell(
    _,
    _('manufacturing_backend.boms.title'),
    <ListPage
      variant="operational"
      frame={collection.frame}
      title={_('manufacturing_backend.boms.title')}
      controls={collectionControls(_, _('manufacturing_backend.boms.title'), collection.frame)}
      headerActions={
        <LinkButton
          label={_('manufacturing_backend.boms.create')}
          href={options.createHref}
          variant="primary"
        />
      }
      actions={collectionActions(_, collection.frame)}
      footer={`${_('manufacturing_backend.boms.title')}: ${String(collection.total)}`}
      body={
        options.rows.length || options.table?.groups?.length
          ? collectionTable(_, collection.table)
          : emptyState(_('manufacturing_backend.empty.boms'), _('manufacturing_backend.empty.bomsHint'))
      }
    />,
    { ...collection.frame, chrome: null, topbar: false },
  )
}
