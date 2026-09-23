import {
  collectionActions,
  collectionControls,
  emptyState,
  icon,
  LinkButton,
  ListPage,
  prepareCollectionTable,
  shell,
  stack,
} from '../../../ui/index.ts'
import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { DataTable, Frame } from '../../../ui/index.ts'
import {
  purchaseOrderListColumns,
  purchaseOrderTable,
  type PurchaseOrderListRow,
} from './order-list-shared.tsx'
import { missingSetup } from './shared.tsx'

export type RfqsListScreenOptions = {
  frame: Frame
  rows: PurchaseOrderListRow[]
  createHref: string
  detailSuffix: string
  total?: number
  setup?: { pickingTypes: number; vendors: number }
  table?: Partial<DataTable<PurchaseOrderListRow>>
}

export const rfqsListScreen = (_: Translator, options: RfqsListScreenOptions): TemplateResult => {
  const collection = prepareCollectionTable(
    _,
    options.frame,
    {
      rows: options.rows,
      columns: purchaseOrderListColumns(_),
      id: (row) => String(row.id),
      ...options.table,
    },
    { paginate: !options.table?.groups },
  )
  const total = options.total ?? options.rows.length
  const table =
    options.rows.length || options.table?.groups?.length
      ? purchaseOrderTable(_, options.rows, options.detailSuffix, collection.table)
      : options.setup && (!options.setup.vendors || !options.setup.pickingTypes)
        ? null
        : emptyState(_('purchase_backend.empty'), _('purchase_backend.emptyHint'), {
            icon: icon('shopping-cart'),
          })
  const summary = `${_('purchase_backend.dashboard.records')}: ${String(total)}`

  return shell(
    _,
    _('purchase_backend.rfqs.title'),
    <ListPage
      variant="operational"
      frame={collection.frame}
      title={_('purchase_backend.rfqs.title')}
      headerActions={
        <LinkButton
          label={_('purchase_backend.action.createRfq')}
          href={options.createHref}
          variant="primary"
        />
      }
      actions={collectionActions(_, collection.frame)}
      controls={collectionControls(_, _('purchase_backend.rfqs.title'), collection.frame)}
      footer={summary}
      body={stack([options.setup ? missingSetup(_, options.setup) : null, table], 'loose')}
    />,
    { ...collection.frame, chrome: null, topbar: false },
  )
}
