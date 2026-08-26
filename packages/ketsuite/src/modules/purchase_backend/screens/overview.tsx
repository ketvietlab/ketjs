import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { CardGrid, ContentCard, Framed, inline, linkButton, Metric, stack } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'
import { missingSetup } from './shared.tsx'

/** The two order facts that feed the purchase workflow counters. */
export type PurchaseOverviewOrder = {
  state?: unknown
  invoiceStatus?: unknown
}

export type PurchaseOverviewSetup = {
  pickingTypes: number
  vendors: number
}

/**
 * The purchase landing page is a specialized workflow overview, not a record
 * list or an editing form: each card is a distinct operational queue and the
 * primary action hands the reader to the RFQ task surface.
 */
export const purchaseOverviewScreen = (
  _: Translator,
  orders: PurchaseOverviewOrder[],
  frame: Frame,
  locale = '',
  setup?: PurchaseOverviewSetup,
): TemplateResult => {
  const count = (states: string[]) => orders.filter((row) => states.includes(String(row.state))).length
  return (
    <Framed
      translator={_}
      title={_('purchase_backend.dashboard.title')}
      frame={frame}
      body={stack([
        setup ? missingSetup(_, setup) : null,
        inline([
          linkButton({
            label: _('purchase_backend.action.createRfq'),
            href: `${localized('/admin/purchase/rfqs', locale)}#rfq-create-form`,
            variant: 'primary',
          }),
        ]),
        <CardGrid
          items={[
            {
              id: 'draft',
              title: _('purchase_backend.dashboard.toSend'),
              value: count(['draft']),
              href: localized('/admin/purchase/rfqs?state=draft', locale),
            },
            {
              id: 'waiting',
              title: _('purchase_backend.dashboard.waiting'),
              value: count(['sent']),
              href: localized('/admin/purchase/rfqs?state=sent', locale),
            },
            {
              id: 'approval',
              title: _('purchase_backend.dashboard.toApprove'),
              value: count(['to approve']),
              href: localized('/admin/purchase/rfqs?state=to%20approve', locale),
            },
            {
              id: 'orders',
              title: _('purchase_backend.menu.orders'),
              value: count(['purchase']),
              href: localized('/admin/purchase/orders', locale),
            },
            {
              id: 'bill',
              title: _('purchase_backend.dashboard.toBill'),
              value: orders.filter((row) => row.invoiceStatus === 'to invoice').length,
              href: localized('/admin/purchase/orders', locale),
            },
          ]}
          id={(item) => item.id}
          card={(item) => (
            <ContentCard
              title={item.title}
              href={item.href}
              body={<Metric label={_('purchase_backend.dashboard.records')} value={String(item.value)} />}
            />
          )}
        />,
      ])}
    />
  )
}
