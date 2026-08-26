import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  CardGrid,
  dataTable,
  emptyState,
  formatMoney,
  Framed,
  icon,
  linkButton,
  Metric,
  Pipeline,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'
import { localized } from '../backend/screen.ts'
import type { AnyRow } from '../backend/screen.ts'
import { salesOrderColumns } from './sales-orders-screen.tsx'

/**
 * What the dashboard is counted from.
 *
 * Counted in the database rather than loaded and counted here: at import scale
 * the overview was materialising the whole order table for four numbers, and
 * once the list is bounded, counting a page would be wrong. The amounts are in
 * `currency`, which is the company's own — `sale.countOrders` refuses to add two
 * currencies together and so does this screen.
 */
export type SaleCounts = {
  draft: number
  sent: number
  sale: number
  toInvoice: number
  draftToday: number
  sentTotal: unknown
  saleTotal: unknown
  toInvoiceTotal: unknown
  currency: unknown
}

export const overviewScreen = (
  _: Translator,
  o: { frame: Frame; counts: SaleCounts; recent: AnyRow[]; localeQuery?: string },
): TemplateResult => {
  // The reader's language travels in the query string, so every link this screen
  // writes has to carry it or the next page silently reverts to the default.
  const localeQuery = o.localeQuery ?? '',
    at = (path: string) => localized(path, localeQuery),
    // A caption under a figure, so the exact đồng is neither readable nor the
    // point. The full amount is one click away, on the record it belongs to.
    money = (value: unknown) => formatMoney(_, value, o.counts.currency, { compact: true })
  const quotations = at('/admin/sales/quotations'),
    newQuotation = at('/admin/sales/quotations/new'),
    orders = at('/admin/sales/orders')
  const cards = [
    {
      id: 'draft',
      label: _('sale_backend.dashboard.draft'),
      value: o.counts.draft,
      detail: _('sale_backend.dashboard.draftToday', { count: String(o.counts.draftToday) }),
      href: `${quotations}${quotations.includes('?') ? '&' : '?'}state=draft`,
      tone: 'neutral' as const,
    },
    {
      id: 'sent',
      label: _('sale_backend.dashboard.sent'),
      value: o.counts.sent,
      detail: _('sale_backend.dashboard.sentValue', { amount: money(o.counts.sentTotal) }),
      href: `${quotations}${quotations.includes('?') ? '&' : '?'}state=sent`,
      tone: 'info' as const,
    },
    {
      id: 'sale',
      label: _('sale_backend.menu.orders'),
      value: o.counts.sale,
      detail: _('sale_backend.dashboard.saleValue', { amount: money(o.counts.saleTotal) }),
      href: orders,
      tone: 'positive' as const,
    },
    {
      id: 'to-invoice',
      label: _('sale_backend.dashboard.toInvoice'),
      value: o.counts.toInvoice,
      detail: _('sale_backend.dashboard.toInvoiceValue', { amount: money(o.counts.toInvoiceTotal) }),
      href: orders,
      tone: 'warning' as const,
    },
  ]
  return (
    <Framed
      translator={_}
      title={_('sale_backend.dashboard.title')}
      subtitle={_('sale_backend.dashboard.subtitle')}
      frame={o.frame}
      actions={linkButton({
        label: _('sale_backend.action.create'),
        href: newQuotation,
        variant: 'primary',
      })}
      body={stack(
        [
          <CardGrid
            items={cards}
            id={(card) => card.id}
            card={(card) => (
              <Metric
                label={card.label}
                value={String(card.value)}
                detail={card.detail}
                tone={card.tone}
                href={card.href}
              />
            )}
          />,
          <Section
            title={_('sale_backend.dashboard.flow.title')}
            description={_('sale_backend.dashboard.flow.hint')}
            body={
              <Pipeline
                label={_('sale_backend.dashboard.flow.title')}
                steps={cards.map((card) => ({
                  id: card.id,
                  label: card.label,
                  value: card.value,
                  href: card.href,
                  tone: card.tone,
                }))}
              />
            }
          />,
          <Section
            title={_('sale_backend.dashboard.recent.title')}
            description={_('sale_backend.dashboard.recent.hint')}
            actions={linkButton({
              label: _('sale_backend.dashboard.recent.all'),
              href: orders,
              variant: 'tertiary',
            })}
            body={
              o.recent.length ? (
                dataTable(_, {
                  columns: salesOrderColumns(_, localeQuery),
                  rows: o.recent,
                  id: (row) => String(row.id),
                })
              ) : (
                <Surface
                  padding="compact"
                  body={emptyState(_('sale_backend.orderList.empty'), _('sale_backend.orderList.emptyHint'), {
                    icon: icon('shopping-bag'),
                  })}
                />
              )
            }
          />,
        ],
        'loose',
      )}
    />
  )
}
