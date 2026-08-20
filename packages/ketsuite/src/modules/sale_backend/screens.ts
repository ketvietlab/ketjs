import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  badge,
  cardGrid,
  contentCard,
  dataTable,
  emptyState,
  framed,
  linkButton,
  metric,
  recordActions,
  recordForm,
  section,
  stack,
  surface,
} from '../../ui/index.ts'
import type { FormField, Frame } from '../../ui/index.ts'

type AnyRow = Record<string, unknown>
export const labelOf = (_: Translator, group: string, value: unknown) => {
  const raw = String(value ?? ''),
    key = `sale_backend.${group}.${raw}`
  return _.resolves(key) ? _(key) : raw
}
const pathOf = (order: AnyRow) =>
  ['draft', 'sent'].includes(String(order.state))
    ? `/admin/sales/quotations/${String(order.id)}`
    : `/admin/sales/orders/${String(order.id)}`
const empty = (_: Translator) => emptyState(_('sale_backend.empty'), _('sale_backend.emptyHint'))

export const dashboard = (_: Translator, rows: AnyRow[], frame: Frame): TemplateResult =>
  framed(
    _,
    _('sale_backend.dashboard.title'),
    frame,
    cardGrid({
      items: [
        {
          id: 'draft',
          title: _('sale_backend.dashboard.draft'),
          value: rows.filter((r) => r.state === 'draft').length,
          href: '/admin/sales/quotations?state=draft',
        },
        {
          id: 'sent',
          title: _('sale_backend.dashboard.sent'),
          value: rows.filter((r) => r.state === 'sent').length,
          href: '/admin/sales/quotations?state=sent',
        },
        {
          id: 'orders',
          title: _('sale_backend.menu.orders'),
          value: rows.filter((r) => r.state === 'sale').length,
          href: '/admin/sales/orders',
        },
        {
          id: 'invoice',
          title: _('sale_backend.dashboard.toInvoice'),
          value: rows.filter((r) => r.invoiceStatus === 'to invoice').length,
          href: '/admin/sales/orders',
        },
      ],
      id: (item) => item.id,
      card: (item) =>
        contentCard({
          title: item.title,
          href: item.href,
          body: metric({ label: _('sale_backend.dashboard.records'), value: String(item.value) }),
        }),
    }),
  )

export const ordersScreen = (
  _: Translator,
  o: { title: string; frame: Frame; rows: AnyRow[]; fields?: FormField[] },
): TemplateResult =>
  framed(
    _,
    o.title,
    o.frame,
    stack([
      ...(o.fields
        ? [
            surface({
              body: recordForm({
                action: '/admin/sales/quotations',
                submit: _('sale_backend.action.create'),
                fields: o.fields,
              }),
            }),
          ]
        : []),
      o.rows.length
        ? dataTable(_, {
            rows: o.rows,
            id: (r) => String(r.id),
            columns: [
              {
                key: 'name',
                label: _('sale_backend.field.name'),
                priority: 'primary',
                cell: (r) => linkButton({ label: String(r.name), href: pathOf(r), variant: 'tertiary' }),
              },
              {
                key: 'customer',
                label: _('sale_backend.field.customer'),
                cell: (r) => String(r.partnerName ?? r.partnerId),
              },
              {
                key: 'date',
                label: _('sale_backend.field.dateOrder'),
                cell: (r) => String(r.dateOrder).slice(0, 10),
              },
              {
                key: 'state',
                label: _('sale_backend.field.state'),
                cell: (r) => badge(labelOf(_, 'state', r.state), 'neutral', String(r.state)),
              },
              {
                key: 'invoice',
                label: _('sale_backend.field.invoiceStatus'),
                cell: (r) => labelOf(_, 'invoiceStatus', r.invoiceStatus),
              },
              {
                key: 'total',
                label: _('sale_backend.field.amountTotal'),
                cell: (r) => `${String(r.amountTotal)} ${String(r.currency)}`,
              },
            ],
          })
        : empty(_),
    ]),
  )

export const policyScreen = (
  _: Translator,
  frame: Frame,
  fields: FormField[],
  rows: AnyRow[],
): TemplateResult =>
  framed(
    _,
    _('sale_backend.policies.title'),
    frame,
    stack([
      surface({
        body: recordForm({
          action: '/admin/sales/invoicing-policies',
          submit: _('sale_backend.action.savePolicy'),
          fields,
        }),
      }),
      rows.length
        ? dataTable(_, {
            rows,
            id: (r) => String(r.id),
            columns: [
              {
                key: 'name',
                label: _('sale_backend.field.product'),
                cell: (r) => String(r.name),
                priority: 'primary',
              },
              {
                key: 'policy',
                label: _('sale_backend.field.invoicePolicy'),
                cell: (r) => labelOf(_, 'invoicePolicy', r.invoicePolicy ?? 'order'),
              },
            ],
          })
        : empty(_),
    ]),
  )

export const orderDetail = (
  _: Translator,
  o: { frame: Frame; order: AnyRow; actionPath: string; lineFields: FormField[]; invoiceFields: FormField[] },
): TemplateResult => {
  const lines = (o.order.lines as AnyRow[] | undefined) ?? [],
    moves = (o.order.moves as AnyRow[] | undefined) ?? [],
    invoices = (o.order.invoices as AnyRow[] | undefined) ?? [],
    state = String(o.order.state)
  const actions: Array<{
    value: string
    label: string
    variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive'
  }> = []
  if (state === 'draft') actions.push({ value: 'send', label: _('sale_backend.action.send') })
  if (['draft', 'sent'].includes(state))
    actions.push({ value: 'confirm', label: _('sale_backend.action.confirm'), variant: 'primary' })
  if (state === 'sale') {
    actions.push({ value: 'sync', label: _('sale_backend.action.sync'), variant: 'primary' })
    actions.push({
      value: o.order.locked ? 'unlock' : 'lock',
      label: o.order.locked ? _('sale_backend.action.unlock') : _('sale_backend.action.lock'),
    })
  }
  if (state !== 'cancel')
    actions.push({ value: 'cancel', label: _('sale_backend.action.cancel'), variant: 'destructive' })
  return framed(
    _,
    String(o.order.name),
    o.frame,
    stack([
      cardGrid({
        items: [
          { id: 'state', label: _('sale_backend.field.state'), value: labelOf(_, 'state', o.order.state) },
          {
            id: 'customer',
            label: _('sale_backend.field.customer'),
            value: String(o.order.partnerName ?? o.order.partnerId),
          },
          {
            id: 'invoice',
            label: _('sale_backend.field.invoiceStatus'),
            value: labelOf(_, 'invoiceStatus', o.order.invoiceStatus),
          },
          {
            id: 'total',
            label: _('sale_backend.field.amountTotal'),
            value: `${String(o.order.amountTotal)} ${String(o.order.currency)}`,
          },
        ],
        id: (item) => item.id,
        card: (item) =>
          contentCard({ title: item.label, body: metric({ label: item.label, value: item.value }) }),
      }),
      ...(actions.length ? [surface({ body: recordActions({ action: o.actionPath, actions }) })] : []),
      section({
        title: _('sale_backend.lines.title'),
        body: lines.length
          ? dataTable(_, {
              rows: lines,
              id: (r) => String(r.id),
              columns: [
                {
                  key: 'product',
                  label: _('sale_backend.field.product'),
                  cell: (r) => String(r.name),
                  priority: 'primary',
                },
                {
                  key: 'ordered',
                  label: _('sale_backend.field.quantity'),
                  cell: (r) => String(r.productUomQty),
                },
                {
                  key: 'delivered',
                  label: _('sale_backend.field.delivered'),
                  cell: (r) => String(r.qtyDelivered),
                },
                {
                  key: 'invoiced',
                  label: _('sale_backend.field.invoiced'),
                  cell: (r) => String(r.qtyInvoiced),
                },
                { key: 'price', label: _('sale_backend.field.priceUnit'), cell: (r) => String(r.priceUnit) },
                {
                  key: 'subtotal',
                  label: _('sale_backend.field.subtotal'),
                  cell: (r) => String(r.priceSubtotal),
                },
              ],
            })
          : empty(_),
      }),
      ...(['draft', 'sent'].includes(state) && !o.order.locked
        ? [
            section({
              title: _('sale_backend.lines.add'),
              body: surface({
                body: recordForm({
                  action: o.actionPath,
                  submit: _('sale_backend.action.addLine'),
                  hidden: { action: 'add-line' },
                  fields: o.lineFields,
                }),
              }),
            }),
          ]
        : []),
      ...(state === 'sale' && o.order.invoiceStatus === 'to invoice'
        ? [
            section({
              title: _('sale_backend.invoice.title'),
              body: surface({
                body: recordForm({
                  action: o.actionPath,
                  submit: _('sale_backend.action.createInvoice'),
                  hidden: { action: 'invoice' },
                  fields: o.invoiceFields,
                }),
              }),
            }),
          ]
        : []),
      ...(moves.length
        ? [
            section({
              title: _('sale_backend.deliveries.title'),
              body: dataTable(_, {
                rows: moves,
                id: (r) => String(r.id),
                columns: [
                  {
                    key: 'name',
                    label: _('sale_backend.field.name'),
                    cell: (r) =>
                      linkButton({
                        label: String(r.origin ?? r.id),
                        href: `/admin/transfers/${String(r.pickingId)}`,
                        variant: 'tertiary',
                      }),
                    priority: 'primary',
                  },
                  { key: 'state', label: _('sale_backend.field.state'), cell: (r) => String(r.state) },
                  {
                    key: 'quantity',
                    label: _('sale_backend.field.delivered'),
                    cell: (r) => String(r.quantity),
                  },
                ],
              }),
            }),
          ]
        : []),
      ...(invoices.length
        ? [
            section({
              title: _('sale_backend.invoices.title'),
              body: dataTable(_, {
                rows: invoices,
                id: (r) => String(r.id),
                columns: [
                  {
                    key: 'name',
                    label: _('sale_backend.field.name'),
                    cell: (r) =>
                      linkButton({
                        label: String(r.name),
                        href: `/admin/customer-invoices/${String(r.id)}`,
                        variant: 'tertiary',
                      }),
                    priority: 'primary',
                  },
                  { key: 'state', label: _('sale_backend.field.state'), cell: (r) => String(r.state) },
                  {
                    key: 'total',
                    label: _('sale_backend.field.amountTotal'),
                    cell: (r) => String(r.amountTotal),
                  },
                ],
              }),
            }),
          ]
        : []),
    ]),
  )
}
