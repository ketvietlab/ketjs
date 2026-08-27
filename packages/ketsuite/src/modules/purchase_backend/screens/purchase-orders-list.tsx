import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { emptyState, icon, ListPage, linkButton, listChrome, shell } from '../../../ui/index.ts'
import type { DataTable, Frame } from '../../../ui/index.ts'
import { purchaseOrderTable, type PurchaseOrderListRow } from './order-list-shared.tsx'

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
  const total = options.total ?? options.rows.length
  const summary = `${_('purchase_backend.dashboard.records')}: ${String(total)}`

  return shell(
    _,
    _('purchase_backend.orders.title'),
    <ListPage
      title={_('purchase_backend.orders.title')}
      controls={
        options.frame.chrome
          ? listChrome(
              _,
              _('purchase_backend.orders.title'),
              {
                ...options.frame.chrome,
                layout: 'command',
                section: undefined,
                create: null,
                selection: null,
              },
              false,
            )
          : undefined
      }
      status={summary}
      body={
        options.rows.length || options.table?.groups?.length
          ? purchaseOrderTable(_, options.rows, options.detailSuffix, options.table)
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
    { ...options.frame, chrome: null, topbar: false },
  )
}
