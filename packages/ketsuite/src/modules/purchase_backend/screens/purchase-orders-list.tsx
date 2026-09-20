import {
  collectionControls,
  emptyState,
  icon,
  linkButton,
  ListPage,
  prepareCollectionTable,
  shell,
} from '../../../ui/index.ts'
import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { DataTable, Frame } from '../../../ui/index.ts'
import {
  purchaseOrderListColumns,
  purchaseOrderTable,
  type PurchaseOrderListRow,
} from './order-list-shared.tsx'

export type PurchaseOrdersListScreenOptions = {
  frame: Frame
  rows: PurchaseOrderListRow[]
  detailSuffix: string
  originHref: string
  total?: number
  table?: Partial<DataTable<PurchaseOrderListRow>>
}

export const purchaseOrdersListScreen = (
  _: Translator,
  options: PurchaseOrdersListScreenOptions,
): TemplateResult => {
  const collection = prepareCollectionTable(_, options.frame, {
    rows: options.rows,
    columns: purchaseOrderListColumns(_),
    id: (row) => String(row.id),
    ...options.table,
  })
  const total = options.total ?? options.rows.length
  const summary = `${_('purchase_backend.dashboard.records')}: ${String(total)}`

  return shell(
    _,
    _('purchase_backend.orders.title'),
    <ListPage
      variant="operational"
      frame={collection.frame}
      title={_('purchase_backend.orders.title')}
      controls={collectionControls(_, _('purchase_backend.orders.title'), collection.frame)}
      footer={summary}
      body={
        options.rows.length || options.table?.groups?.length
          ? purchaseOrderTable(_, options.rows, options.detailSuffix, collection.table)
          : emptyState(_('purchase_backend.orders.empty'), _('purchase_backend.orders.emptyHint'), {
              icon: icon('shopping-cart'),
              actions: linkButton({
                label: _('purchase_backend.orders.openRequests'),
                href: options.originHref,
                variant: 'primary',
              }),
            })
      }
    />,
    { ...collection.frame, chrome: null, topbar: false },
  )
}
