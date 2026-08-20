import type { Translator } from 'ketjs'
import type { JSXChild, TemplateResult } from 'ketjs-view'
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
const empty = (_: Translator) => emptyState(_('pos_backend.empty'), _('pos_backend.emptyHint'))
export const labelOf = (_: Translator, group: string, value: unknown) => {
  const raw = String(value ?? ''),
    key = `pos_backend.${group}.${raw}`
  return _.resolves(key) ? _(key) : raw
}

export const dashboard = (
  _: Translator,
  sessions: AnyRow[],
  orders: AnyRow[],
  frame: Frame,
): TemplateResult =>
  framed(
    _,
    _('pos_backend.dashboard.title'),
    frame,
    cardGrid({
      items: [
        {
          id: 'open',
          title: _('pos_backend.dashboard.openSessions'),
          value: sessions.filter((r) => r.state !== 'closed').length,
          href: '/admin/pos/sessions',
        },
        {
          id: 'draft',
          title: _('pos_backend.dashboard.draftOrders'),
          value: orders.filter((r) => r.state === 'draft').length,
          href: '/admin/pos/orders?state=draft',
        },
        {
          id: 'paid',
          title: _('pos_backend.dashboard.paidOrders'),
          value: orders.filter((r) => ['paid', 'done'].includes(String(r.state))).length,
          href: '/admin/pos/orders',
        },
        {
          id: 'sales',
          title: _('pos_backend.dashboard.sales'),
          value: orders
            .filter((r) => ['paid', 'done'].includes(String(r.state)))
            .reduce((sum, r) => sum + Number(r.amountTotal), 0),
          href: '/admin/pos/orders',
        },
      ],
      id: (item) => item.id,
      card: (item) =>
        contentCard({
          title: item.title,
          href: item.href,
          body: metric({ label: item.title, value: String(item.value) }),
        }),
    }),
  )

export const configsScreen = (
  _: Translator,
  frame: Frame,
  rows: AnyRow[],
  fields: FormField[],
): TemplateResult =>
  framed(
    _,
    _('pos_backend.configs.title'),
    frame,
    stack([
      surface({
        body: recordForm({
          action: '/admin/pos/configurations',
          submit: _('pos_backend.action.saveConfig'),
          submitVariant: 'primary',
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
                label: _('pos_backend.field.name'),
                cell: (r) => String(r.name),
                priority: 'primary',
              },
              {
                key: 'warehouse',
                label: _('pos_backend.field.warehouse'),
                cell: (r) => String(r.warehouseName ?? r.warehouseId),
              },
              {
                key: 'difference',
                label: _('pos_backend.field.maximumDifference'),
                cell: (r) => String(r.maximumDifference),
              },
            ],
          })
        : empty(_),
    ]),
  )

export const methodsScreen = (
  _: Translator,
  frame: Frame,
  rows: AnyRow[],
  fields: FormField[],
  linkFields: FormField[],
): TemplateResult =>
  framed(
    _,
    _('pos_backend.methods.title'),
    frame,
    stack([
      surface({
        body: recordForm({
          action: '/admin/pos/payment-methods',
          submit: _('pos_backend.action.saveMethod'),
          submitVariant: 'secondary',
          hidden: { action: 'save' },
          fields,
        }),
      }),
      surface({
        body: recordForm({
          action: '/admin/pos/payment-methods',
          submit: _('pos_backend.action.linkMethod'),
          submitVariant: 'secondary',
          hidden: { action: 'link' },
          fields: linkFields,
        }),
      }),
      rows.length
        ? dataTable(_, {
            rows,
            id: (r) => String(r.id),
            columns: [
              {
                key: 'name',
                label: _('pos_backend.field.name'),
                cell: (r) => String(r.name),
                priority: 'primary',
              },
              {
                key: 'journal',
                label: _('pos_backend.field.journal'),
                cell: (r) => String(r.journalName ?? r.journalId),
              },
              {
                key: 'cash',
                label: _('pos_backend.field.isCash'),
                cell: (r) => (r.isCash ? _('pos_backend.yes') : _('pos_backend.no')),
              },
            ],
          })
        : empty(_),
    ]),
  )

export const sessionsScreen = (
  _: Translator,
  frame: Frame,
  rows: AnyRow[],
  fields: FormField[],
): TemplateResult =>
  framed(
    _,
    _('pos_backend.sessions.title'),
    frame,
    stack([
      surface({
        body: recordForm({
          action: '/admin/pos/sessions',
          submit: _('pos_backend.action.createSession'),
          submitVariant: 'primary',
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
                label: _('pos_backend.field.session'),
                cell: (r) =>
                  linkButton({
                    label: String(r.name),
                    href: `/admin/pos/sessions/${String(r.id)}`,
                    variant: 'tertiary',
                  }),
                priority: 'primary',
              },
              {
                key: 'config',
                label: _('pos_backend.field.config'),
                cell: (r) => String(r.configName ?? r.configId),
              },
              {
                key: 'state',
                label: _('pos_backend.field.state'),
                cell: (r) => badge(labelOf(_, 'sessionState', r.state), 'neutral', String(r.state)),
              },
              {
                key: 'start',
                label: _('pos_backend.field.startAt'),
                cell: (r) => String(r.startAt ?? '—').slice(0, 19),
              },
            ],
          })
        : empty(_),
    ]),
  )

export const sessionDetail = (
  _: Translator,
  frame: Frame,
  session: AnyRow,
  closeFields: FormField[],
  actionPath: string,
): TemplateResult => {
  const state = String(session.state),
    orders = (session.orders as AnyRow[] | undefined) ?? [],
    actions: Array<{
      value: string
      label: string
      variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive'
    }> = []
  if (state === 'opening_control')
    actions.push({ value: 'open', label: _('pos_backend.action.openSession'), variant: 'primary' })
  if (state === 'opened')
    actions.push({ value: 'closing', label: _('pos_backend.action.startClosing'), variant: 'primary' })
  return framed(
    _,
    String(session.name),
    frame,
    stack([
      cardGrid({
        items: [
          { id: 'state', title: _('pos_backend.field.state'), value: labelOf(_, 'sessionState', state) },
          { id: 'orders', title: _('pos_backend.field.orders'), value: String(orders.length) },
          {
            id: 'cash',
            title: _('pos_backend.field.expectedCash'),
            value: String(session.cashRegisterBalanceEnd),
          },
        ],
        id: (item) => item.id,
        card: (item) =>
          contentCard({ title: item.title, body: metric({ label: item.title, value: item.value }) }),
      }),
      ...(actions.length ? [surface({ body: recordActions({ action: actionPath, actions }) })] : []),
      ...(state === 'opened'
        ? [
            surface({
              body: linkButton({
                label: _('pos_backend.action.openRegister'),
                href: `/admin/pos/register/${String(session.id)}`,
                variant: 'primary',
              }),
            }),
          ]
        : []),
      ...(state === 'closing_control'
        ? [
            section({
              title: _('pos_backend.close.title'),
              body: surface({
                body: recordForm({
                  action: actionPath,
                  submit: _('pos_backend.action.closeSession'),
                  submitVariant: 'primary',
                  hidden: { action: 'close' },
                  fields: closeFields,
                }),
              }),
            }),
          ]
        : []),
      section({
        title: _('pos_backend.orders.title'),
        body: orders.length ? orderTable(_, orders) : empty(_),
      }),
    ]),
  )
}

const orderTable = (_: Translator, rows: AnyRow[]) =>
  dataTable(_, {
    rows,
    id: (r) => String(r.id),
    columns: [
      {
        key: 'reference',
        label: _('pos_backend.field.receipt'),
        cell: (r) =>
          linkButton({
            label: String(r.posReference),
            href: `/admin/pos/orders/${String(r.id)}`,
            variant: 'tertiary',
          }),
        priority: 'primary',
      },
      { key: 'customer', label: _('pos_backend.field.customer'), cell: (r) => String(r.partnerName ?? '—') },
      {
        key: 'state',
        label: _('pos_backend.field.state'),
        cell: (r) => badge(labelOf(_, 'orderState', r.state), 'neutral', String(r.state)),
      },
      {
        key: 'total',
        label: _('pos_backend.field.total'),
        cell: (r) => `${String(r.amountTotal)} ${String(r.currency)}`,
      },
    ],
  })

export const ordersScreen = (_: Translator, frame: Frame, rows: AnyRow[]): TemplateResult =>
  framed(_, _('pos_backend.orders.title'), frame, rows.length ? orderTable(_, rows) : empty(_))

export const registerScreen = (
  _: Translator,
  frame: Frame,
  _session: AnyRow,
  orders: AnyRow[],
  createFields: FormField[],
  actionPath: string,
): TemplateResult =>
  framed(
    _,
    _('pos_backend.register.title'),
    frame,
    stack([
      surface({
        body: recordForm({
          action: actionPath,
          submit: _('pos_backend.action.newOrder'),
          submitVariant: 'primary',
          fields: createFields,
        }),
      }),
      orders.length ? orderTable(_, orders) : empty(_),
    ]),
  )

export const orderDetail = (
  _: Translator,
  frame: Frame,
  order: AnyRow,
  lineFields: FormField[],
  paymentFields: FormField[],
  actionPath: string,
  integration?: JSXChild,
): TemplateResult => {
  const lines = (order.lines as AnyRow[] | undefined) ?? [],
    payments = (order.payments as AnyRow[] | undefined) ?? [],
    draft = order.state === 'draft'
  const actions: Array<{
    value: string
    label: string
    variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive'
  }> = []
  if (draft) {
    actions.push({ value: 'validate', label: _('pos_backend.action.validate'), variant: 'primary' })
    actions.push({ value: 'cancel', label: _('pos_backend.action.cancel'), variant: 'destructive' })
  }
  if (['paid', 'done'].includes(String(order.state)) && !order.isRefund)
    actions.push({ value: 'refund', label: _('pos_backend.action.refund') })
  return framed(
    _,
    String(order.posReference),
    frame,
    stack([
      cardGrid({
        items: [
          { id: 'state', title: _('pos_backend.field.state'), value: labelOf(_, 'orderState', order.state) },
          { id: 'customer', title: _('pos_backend.field.customer'), value: String(order.partnerName ?? '—') },
          {
            id: 'total',
            title: _('pos_backend.field.total'),
            value: `${String(order.amountTotal)} ${String(order.currency)}`,
          },
          { id: 'paid', title: _('pos_backend.field.paid'), value: String(order.amountPaid) },
        ],
        id: (item) => item.id,
        card: (item) =>
          contentCard({ title: item.title, body: metric({ label: item.title, value: item.value }) }),
      }),
      ...(integration === undefined ? [] : [integration]),
      ...(actions.length ? [surface({ body: recordActions({ action: actionPath, actions }) })] : []),
      section({
        title: _('pos_backend.lines.title'),
        body: lines.length
          ? dataTable(_, {
              rows: lines,
              id: (r) => String(r.id),
              columns: [
                {
                  key: 'product',
                  label: _('pos_backend.field.product'),
                  cell: (r) => String(r.name),
                  priority: 'primary',
                },
                { key: 'qty', label: _('pos_backend.field.qty'), cell: (r) => String(r.qty) },
                { key: 'price', label: _('pos_backend.field.priceUnit'), cell: (r) => String(r.priceUnit) },
                { key: 'discount', label: _('pos_backend.field.discount'), cell: (r) => String(r.discount) },
                {
                  key: 'subtotal',
                  label: _('pos_backend.field.subtotal'),
                  cell: (r) => String(r.priceSubtotalIncl),
                },
              ],
            })
          : empty(_),
      }),
      ...(draft && !order.isRefund
        ? [
            section({
              title: _('pos_backend.lines.add'),
              body: surface({
                body: recordForm({
                  action: actionPath,
                  submit: _('pos_backend.action.addProduct'),
                  submitVariant: 'secondary',
                  hidden: { action: 'line' },
                  fields: lineFields,
                }),
              }),
            }),
          ]
        : []),
      ...(draft
        ? [
            section({
              title: _('pos_backend.payments.title'),
              body: stack([
                ...(payments.length
                  ? [
                      dataTable(_, {
                        rows: payments,
                        id: (r) => String(r.id),
                        columns: [
                          {
                            key: 'method',
                            label: _('pos_backend.field.paymentMethod'),
                            cell: (r) => String(r.methodName ?? r.paymentMethodId),
                            priority: 'primary',
                          },
                          {
                            key: 'amount',
                            label: _('pos_backend.field.amount'),
                            cell: (r) => String(r.amount),
                          },
                        ],
                      }),
                    ]
                  : []),
                surface({
                  body: recordForm({
                    action: actionPath,
                    submit: _('pos_backend.action.addPayment'),
                    submitVariant: 'secondary',
                    hidden: { action: 'payment' },
                    fields: paymentFields,
                  }),
                }),
              ]),
            }),
          ]
        : []),
    ]),
  )
}
