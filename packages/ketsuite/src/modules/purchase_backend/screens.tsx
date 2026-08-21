import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  badge,
  cardGrid,
  contentCard,
  dataTable,
  emptyState,
  formatMoney,
  framed,
  inline,
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

export const labelOf = (_: Translator, group: string, value: unknown): string => {
  const raw = String(value ?? '')
  const key = `purchase_backend.${group}.${raw}`
  return _.resolves(key) ? _(key) : raw
}

const pathOf = (order: AnyRow) =>
  ['draft', 'sent', 'to approve'].includes(String(order.state))
    ? `/admin/purchase/rfqs/${String(order.id)}`
    : `/admin/purchase/orders/${String(order.id)}`

const empty = (_: Translator) => emptyState(_('purchase_backend.empty'), _('purchase_backend.emptyHint'))
const localized = (path: string, localeSuffix: string): string =>
  localeSuffix ? `${path}${path.includes('?') ? '&' : '?'}${localeSuffix.slice(1)}` : path

export const dashboard = (
  _: Translator,
  orders: AnyRow[],
  frame: Frame,
  localeSuffix = '',
): TemplateResult => {
  const count = (states: string[]) => orders.filter((row) => states.includes(String(row.state))).length
  return framed(
    _,
    _('purchase_backend.dashboard.title'),
    frame,
    stack([
      inline([
        linkButton({
          label: _('purchase_backend.action.createRfq'),
          href: `${localized('/admin/purchase/rfqs', localeSuffix)}#rfq-create-form`,
          variant: 'primary',
        }),
      ]),
      cardGrid({
        items: [
          {
            id: 'draft',
            title: _('purchase_backend.dashboard.toSend'),
            value: count(['draft']),
            href: localized('/admin/purchase/rfqs?state=draft', localeSuffix),
          },
          {
            id: 'waiting',
            title: _('purchase_backend.dashboard.waiting'),
            value: count(['sent']),
            href: localized('/admin/purchase/rfqs?state=sent', localeSuffix),
          },
          {
            id: 'approval',
            title: _('purchase_backend.dashboard.toApprove'),
            value: count(['to approve']),
            href: localized('/admin/purchase/rfqs?state=to%20approve', localeSuffix),
          },
          {
            id: 'orders',
            title: _('purchase_backend.menu.orders'),
            value: count(['purchase']),
            href: localized('/admin/purchase/orders', localeSuffix),
          },
          {
            id: 'bill',
            title: _('purchase_backend.dashboard.toBill'),
            value: orders.filter((row) => row.invoiceStatus === 'to invoice').length,
            href: localized('/admin/purchase/orders', localeSuffix),
          },
        ],
        id: (item) => item.id,
        card: (item) =>
          contentCard({
            title: item.title,
            href: item.href,
            body: metric({ label: _('purchase_backend.dashboard.records'), value: String(item.value) }),
          }),
      }),
    ]),
  )
}

export const ordersScreen = (
  _: Translator,
  o: {
    title: string
    frame: Frame
    rows: AnyRow[]
    createFields?: FormField[]
    createAction?: string
  },
): TemplateResult =>
  framed(
    _,
    o.title,
    o.frame,
    stack([
      ...(o.createFields
        ? [
            surface({
              body: recordForm({
                id: 'rfq-create-form',
                scope: 'purchase-rfq-create',
                action: o.createAction ?? '/admin/purchase/rfqs',
                submit: _('purchase_backend.action.createRfq'),
                submitVariant: 'primary',
                fields: o.createFields,
              }),
            }),
          ]
        : []),
      o.rows.length
        ? dataTable(_, {
            rows: o.rows,
            id: (row) => String(row.id),
            columns: [
              {
                key: 'name',
                label: _('purchase_backend.field.name'),
                priority: 'primary',
                cell: (row) =>
                  linkButton({ label: String(row.name), href: pathOf(row), variant: 'tertiary' }),
              },
              {
                key: 'vendor',
                label: _('purchase_backend.field.vendor'),
                cell: (row) => String(row.partnerName ?? row.partnerId),
              },
              {
                key: 'date',
                label: _('purchase_backend.field.dateOrder'),
                cell: (row) => String(row.dateOrder).slice(0, 10),
              },
              {
                key: 'state',
                label: _('purchase_backend.field.state'),
                cell: (row) => badge(labelOf(_, 'state', row.state), 'neutral', String(row.state)),
              },
              {
                key: 'invoice',
                label: _('purchase_backend.field.invoiceStatus'),
                cell: (row) => labelOf(_, 'invoiceStatus', row.invoiceStatus),
              },
              {
                key: 'total',
                label: _('purchase_backend.field.amountTotal'),
                cell: (row) => formatMoney(_, row.amountTotal, row.currency),
                align: 'end',
                kind: 'currency',
              },
            ],
          })
        : empty(_),
    ]),
  )

export const supplierInfoScreen = (
  _: Translator,
  o: { frame: Frame; rows: AnyRow[]; fields: FormField[]; methodFields: FormField[]; currency?: unknown },
): TemplateResult =>
  framed(
    _,
    _('purchase_backend.pricelists.title'),
    o.frame,
    stack([
      surface({
        body: recordForm({
          action: '/admin/purchase/vendor-pricelists',
          submit: _('purchase_backend.action.addVendorPrice'),
          submitVariant: 'secondary',
          fields: o.fields,
        }),
      }),
      section({
        title: _('purchase_backend.method.title'),
        body: surface({
          body: recordForm({
            action: '/admin/purchase/vendor-pricelists',
            submit: _('purchase_backend.action.saveMethod'),
            submitVariant: 'primary',
            hidden: { action: 'method' },
            fields: o.methodFields,
          }),
        }),
      }),
      o.rows.length
        ? dataTable(_, {
            rows: o.rows,
            id: (row) => String(row.id),
            columns: [
              {
                key: 'vendor',
                label: _('purchase_backend.field.vendor'),
                cell: (row) => String(row.partnerName ?? row.partnerId),
                priority: 'primary',
              },
              {
                key: 'product',
                label: _('purchase_backend.field.product'),
                cell: (row) => String(row.productNameDisplay ?? row.productTemplateId),
              },
              { key: 'min', label: _('purchase_backend.field.minQty'), cell: (row) => String(row.minQty) },
              {
                key: 'price',
                label: _('purchase_backend.field.priceUnit'),
                cell: (row) => formatMoney(_, row.price, o.currency),
                align: 'end',
                kind: 'currency',
              },
              {
                key: 'discount',
                label: _('purchase_backend.field.discount'),
                cell: (row) => `${String(row.discount)}%`,
              },
              { key: 'delay', label: _('purchase_backend.field.delay'), cell: (row) => String(row.delay) },
            ],
          })
        : empty(_),
    ]),
  )

export const orderDetail = (
  _: Translator,
  o: {
    frame: Frame
    order: AnyRow
    actionPath?: string
    lineFields: FormField[]
    billFields: FormField[]
  },
): TemplateResult => {
  const path = o.actionPath ?? pathOf(o.order)
  const lines = (o.order.lines as AnyRow[] | undefined) ?? []
  const moves = (o.order.moves as AnyRow[] | undefined) ?? []
  const bills = (o.order.bills as AnyRow[] | undefined) ?? []
  const state = String(o.order.state)
  const actions: Array<{
    value: string
    label: string
    variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive'
  }> = []
  if (state === 'draft') actions.push({ value: 'send', label: _('purchase_backend.action.send') })
  if (['draft', 'sent'].includes(state)) {
    actions.push({ value: 'confirm', label: _('purchase_backend.action.confirm'), variant: 'primary' })
    actions.push({ value: 'request-approval', label: _('purchase_backend.action.requestApproval') })
  }
  if (state === 'to approve')
    actions.push({ value: 'approve', label: _('purchase_backend.action.approve'), variant: 'primary' })
  if (state === 'purchase') {
    actions.push({ value: 'sync', label: _('purchase_backend.action.syncReceipts'), variant: 'primary' })
    actions.push({
      value: o.order.locked ? 'unlock' : 'lock',
      label: o.order.locked ? _('purchase_backend.action.unlock') : _('purchase_backend.action.lock'),
    })
  }
  if (!['cancel'].includes(state))
    actions.push({ value: 'cancel', label: _('purchase_backend.action.cancel'), variant: 'destructive' })
  return framed(
    _,
    String(o.order.name),
    o.frame,
    stack([
      cardGrid({
        items: [
          {
            id: 'state',
            label: _('purchase_backend.field.state'),
            value: labelOf(_, 'state', o.order.state),
          },
          {
            id: 'vendor',
            label: _('purchase_backend.field.vendor'),
            value: String(o.order.partnerName ?? o.order.partnerId),
          },
          {
            id: 'arrival',
            label: _('purchase_backend.field.datePlanned'),
            value: String(o.order.datePlanned).slice(0, 10),
          },
          {
            id: 'billing',
            label: _('purchase_backend.field.invoiceStatus'),
            value: labelOf(_, 'invoiceStatus', o.order.invoiceStatus),
          },
          {
            id: 'total',
            label: _('purchase_backend.field.amountTotal'),
            value: formatMoney(_, o.order.amountTotal, o.order.currency),
          },
        ],
        id: (item) => item.id,
        card: (item) =>
          contentCard({ title: item.label, body: metric({ label: item.label, value: item.value }) }),
      }),
      ...(actions.length ? [surface({ body: recordActions({ action: path, actions }) })] : []),
      section({
        title: _('purchase_backend.lines.title'),
        body: lines.length
          ? dataTable(_, {
              rows: lines,
              id: (row) => String(row.id),
              columns: [
                {
                  key: 'name',
                  label: _('purchase_backend.field.product'),
                  cell: (row) => String(row.name),
                  priority: 'primary',
                },
                {
                  key: 'ordered',
                  label: _('purchase_backend.field.productQty'),
                  cell: (row) => String(row.productQty),
                },
                {
                  key: 'received',
                  label: _('purchase_backend.field.qtyReceived'),
                  cell: (row) => String(row.qtyReceived),
                },
                {
                  key: 'billed',
                  label: _('purchase_backend.field.qtyInvoiced'),
                  cell: (row) => String(row.qtyInvoiced),
                },
                {
                  key: 'price',
                  label: _('purchase_backend.field.priceUnit'),
                  cell: (row) => formatMoney(_, row.priceUnit, o.order.currency),
                  align: 'end',
                  kind: 'currency',
                },
                {
                  key: 'subtotal',
                  label: _('purchase_backend.field.subtotal'),
                  cell: (row) => formatMoney(_, row.priceSubtotal, o.order.currency),
                  align: 'end',
                  kind: 'currency',
                },
              ],
            })
          : empty(_),
      }),
      ...(['draft', 'sent'].includes(state) && !o.order.locked
        ? [
            section({
              title: _('purchase_backend.lines.add'),
              body: surface({
                body: recordForm({
                  action: path,
                  submit: _('purchase_backend.action.addLine'),
                  submitVariant: 'secondary',
                  hidden: { action: 'add-line' },
                  fields: o.lineFields,
                }),
              }),
            }),
          ]
        : []),
      ...(state === 'purchase' && o.order.invoiceStatus === 'to invoice'
        ? [
            section({
              title: _('purchase_backend.bill.title'),
              body: surface({
                body: recordForm({
                  action: path,
                  submit: _('purchase_backend.action.createBill'),
                  submitVariant: 'primary',
                  hidden: { action: 'bill' },
                  fields: o.billFields,
                }),
              }),
            }),
          ]
        : []),
      ...(moves.length
        ? [
            section({
              title: _('purchase_backend.receipts.title'),
              body: dataTable(_, {
                rows: moves,
                id: (row) => String(row.id),
                columns: [
                  {
                    key: 'origin',
                    label: _('purchase_backend.field.name'),
                    cell: (row) =>
                      linkButton({
                        label: String(row.origin ?? row.id),
                        href: `/admin/transfers/${String(row.pickingId)}`,
                        variant: 'tertiary',
                      }),
                    priority: 'primary',
                  },
                  {
                    key: 'state',
                    label: _('purchase_backend.field.state'),
                    cell: (row) => String(row.state),
                  },
                  {
                    key: 'quantity',
                    label: _('purchase_backend.field.qtyReceived'),
                    cell: (row) => String(row.quantity),
                  },
                ],
              }),
            }),
          ]
        : []),
      ...(bills.length
        ? [
            section({
              title: _('purchase_backend.bills.title'),
              body: dataTable(_, {
                rows: bills,
                id: (row) => String(row.id),
                columns: [
                  {
                    key: 'name',
                    label: _('purchase_backend.field.name'),
                    cell: (row) =>
                      linkButton({
                        label: String(row.name),
                        href: `/admin/vendor-bills/${String(row.id)}`,
                        variant: 'tertiary',
                      }),
                    priority: 'primary',
                  },
                  {
                    key: 'state',
                    label: _('purchase_backend.field.state'),
                    cell: (row) => String(row.state),
                  },
                  {
                    key: 'total',
                    label: _('purchase_backend.field.amountTotal'),
                    cell: (row) => formatMoney(_, row.amountTotal, row.currency ?? o.order.currency),
                    align: 'end',
                    kind: 'currency',
                  },
                ],
              }),
            }),
          ]
        : []),
    ]),
  )
}
