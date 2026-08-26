import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  emptyState,
  icon,
  inline,
  LinkButton,
  ListPage,
  listChrome,
  shell,
  stack,
} from '../../../ui/index.ts'
import type { DataTable, Frame } from '../../../ui/index.ts'
import { purchaseOrderTable, type PurchaseOrderListRow } from './order-list-shared.tsx'
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
  const total = options.total ?? options.rows.length
  const table =
    options.rows.length || options.table?.groups?.length
      ? purchaseOrderTable(_, options.rows, options.detailSuffix, options.table)
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
      title={_('purchase_backend.rfqs.title')}
      actions={inline([
        <LinkButton
          label={_('purchase_backend.action.createRfq')}
          href={options.createHref}
          variant="primary"
        />,
        options.frame.extras?.['topbar.end'] ?? '',
      ])}
      controls={
        options.frame.chrome
          ? listChrome(
              _,
              _('purchase_backend.rfqs.title'),
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
      body={stack([options.setup ? missingSetup(_, options.setup) : null, table], 'loose')}
    />,
    { ...options.frame, chrome: null, topbar: false },
  )
}
