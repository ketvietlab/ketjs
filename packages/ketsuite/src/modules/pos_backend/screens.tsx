import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  CardGrid,
  ContentCard,
  dataTable,
  DashboardPage,
  emptyState,
  formatMoney,
  ListScreen,
  linkButton,
  Metric,
  RecordActions,
  RecordForm,
  RecordScreen,
  Section,
  shell,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { FormField, Frame } from '../../ui/index.ts'
import { minorText, scaleOf, sumMoneyMinor } from '../account/money.ts'
import { selectionLabel } from '../backend/screen.ts'

type AnyRow = Record<string, unknown>
const empty = (_: Translator) => emptyState(_('pos_backend.empty'), _('pos_backend.emptyHint'))
/** A stable pos code in the reader's language; the code itself survives as data. */
export const labelOf = (_: Translator, group: string, value: unknown): string =>
  selectionLabel(_, 'pos_backend', group, value)

export const dashboard = (
  _: Translator,
  sessions: AnyRow[],
  orders: AnyRow[],
  frame: Frame,
): TemplateResult => {
  const paidOrders = orders.filter((row) => ['paid', 'done'].includes(String(row.state)))
  const currency = paidOrders[0]?.currency ?? 'VND'
  const scale = scaleOf(currency)
  const sales = minorText(
    sumMoneyMinor(
      paidOrders.map((row) => row.amountTotal),
      scale,
    ),
    scale,
  )
  return shell(
    _,
    _('pos_backend.dashboard.title'),
    <DashboardPage
      variant="operational"
      frame={frame}
      title={_('pos_backend.dashboard.title')}
      body={
        <CardGrid
          items={[
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
              value: paidOrders.length,
              href: '/admin/pos/orders',
            },
            {
              id: 'sales',
              title: _('pos_backend.dashboard.sales'),
              value: formatMoney(_, sales, currency),
              href: '/admin/pos/orders',
            },
          ]}
          id={(item) => item.id}
          card={(item) => <Metric label={item.title} value={String(item.value)} href={item.href} />}
        />
      }
    />,
    { ...frame, topbar: false },
  )
}

export const configsScreen = (
  _: Translator,
  frame: Frame,
  rows: AnyRow[],
  fields: FormField[],
): TemplateResult => (
  <ListScreen
    translator={_}
    title={_('pos_backend.configs.title')}
    frame={frame}
    body={stack([
      <Surface
        body={
          <RecordForm
            action="/admin/pos/configurations"
            submit={_('pos_backend.action.saveConfig')}
            submitVariant="primary"
            fields={fields}
          />
        }
      />,
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
                cell: (r) => formatMoney(_, r.maximumDifference, r.currency),
                align: 'end',
                kind: 'currency',
              },
            ],
          })
        : empty(_),
    ])}
  />
)

export const methodsScreen = (
  _: Translator,
  frame: Frame,
  rows: AnyRow[],
  fields: FormField[],
  linkFields: FormField[],
): TemplateResult => (
  <ListScreen
    translator={_}
    title={_('pos_backend.methods.title')}
    frame={frame}
    body={stack([
      <Surface
        body={
          <RecordForm
            action="/admin/pos/payment-methods"
            submit={_('pos_backend.action.saveMethod')}
            submitVariant="secondary"
            hidden={{ action: 'save' }}
            fields={fields}
          />
        }
      />,
      <Surface
        body={
          <RecordForm
            action="/admin/pos/payment-methods"
            submit={_('pos_backend.action.linkMethod')}
            submitVariant="secondary"
            hidden={{ action: 'link' }}
            fields={linkFields}
          />
        }
      />,
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
    ])}
  />
)

export const sessionsScreen = (
  _: Translator,
  frame: Frame,
  rows: AnyRow[],
  fields: FormField[],
): TemplateResult => (
  <ListScreen
    translator={_}
    title={_('pos_backend.sessions.title')}
    frame={frame}
    body={stack([
      <Surface
        body={
          <RecordForm
            action="/admin/pos/sessions"
            submit={_('pos_backend.action.createSession')}
            submitVariant="primary"
            fields={fields}
          />
        }
      />,
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
    ])}
  />
)

export const sessionDetail = (
  _: Translator,
  frame: Frame,
  session: AnyRow,
  closeFields: FormField[],
  actionPath: string,
  currency?: unknown,
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
  return (
    <RecordScreen
      translator={_}
      title={String(session.name)}
      frame={frame}
      body={stack([
        <CardGrid
          items={[
            { id: 'state', title: _('pos_backend.field.state'), value: labelOf(_, 'sessionState', state) },
            { id: 'orders', title: _('pos_backend.field.orders'), value: String(orders.length) },
            {
              id: 'cash',
              title: _('pos_backend.field.expectedCash'),
              value: formatMoney(_, session.cashRegisterBalanceEnd, orders[0]?.currency ?? currency),
            },
          ]}
          id={(item) => item.id}
          card={(item) => (
            <ContentCard title={item.title} body={<Metric label={item.title} value={item.value} />} />
          )}
        />,
        ...(actions.length
          ? [<Surface body={<RecordActions action={actionPath} actions={actions} />} />]
          : []),
        ...(state === 'opened'
          ? [
              <Surface
                body={linkButton({
                  label: _('pos_backend.action.openRegister'),
                  href: `/admin/pos/register/${String(session.id)}`,
                  variant: 'primary',
                })}
              />,
            ]
          : []),
        ...(state === 'closing_control'
          ? [
              <Section
                title={_('pos_backend.close.title')}
                body={
                  <Surface
                    body={
                      <RecordForm
                        action={actionPath}
                        submit={_('pos_backend.action.closeSession')}
                        submitVariant="primary"
                        hidden={{ action: 'close' }}
                        fields={closeFields}
                      />
                    }
                  />
                }
              />,
            ]
          : []),
        <Section
          title={_('pos_backend.orders.title')}
          body={orders.length ? orderTable(_, orders) : empty(_)}
        />,
      ])}
    />
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
        cell: (r) => formatMoney(_, r.amountTotal, r.currency),
        align: 'end',
        kind: 'currency',
      },
    ],
  })

export const ordersScreen = (_: Translator, frame: Frame, rows: AnyRow[]): TemplateResult => (
  <ListScreen
    translator={_}
    title={_('pos_backend.orders.title')}
    frame={frame}
    body={rows.length ? orderTable(_, rows) : empty(_)}
  />
)

export const registerScreen = (
  _: Translator,
  frame: Frame,
  _session: AnyRow,
  orders: AnyRow[],
  createFields: FormField[],
  actionPath: string,
): TemplateResult => (
  <RecordScreen
    translator={_}
    title={_('pos_backend.register.title')}
    frame={frame}
    body={stack([
      <Surface
        body={
          <RecordForm
            action={actionPath}
            submit={_('pos_backend.action.newOrder')}
            submitVariant="primary"
            fields={createFields}
          />
        }
      />,
      orders.length ? orderTable(_, orders) : empty(_),
    ])}
  />
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
  return (
    <RecordScreen
      translator={_}
      title={String(order.posReference)}
      frame={frame}
      body={stack([
        <CardGrid
          items={[
            {
              id: 'state',
              title: _('pos_backend.field.state'),
              value: labelOf(_, 'orderState', order.state),
            },
            {
              id: 'customer',
              title: _('pos_backend.field.customer'),
              value: String(order.partnerName ?? '—'),
            },
            {
              id: 'total',
              title: _('pos_backend.field.total'),
              value: formatMoney(_, order.amountTotal, order.currency),
            },
            {
              id: 'paid',
              title: _('pos_backend.field.paid'),
              value: formatMoney(_, order.amountPaid, order.currency),
            },
          ]}
          id={(item) => item.id}
          card={(item) => (
            <ContentCard title={item.title} body={<Metric label={item.title} value={item.value} />} />
          )}
        />,
        ...(integration === undefined ? [] : [integration]),
        ...(actions.length
          ? [<Surface body={<RecordActions action={actionPath} actions={actions} />} />]
          : []),
        <Section
          title={_('pos_backend.lines.title')}
          body={
            lines.length
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
                    {
                      key: 'price',
                      label: _('pos_backend.field.priceUnit'),
                      cell: (r) => formatMoney(_, r.priceUnit, order.currency),
                      align: 'end',
                      kind: 'currency',
                    },
                    {
                      key: 'discount',
                      label: _('pos_backend.field.discount'),
                      cell: (r) => String(r.discount),
                    },
                    {
                      key: 'subtotal',
                      label: _('pos_backend.field.subtotal'),
                      cell: (r) => formatMoney(_, r.priceSubtotalIncl, order.currency),
                      align: 'end',
                      kind: 'currency',
                    },
                  ],
                })
              : empty(_)
          }
        />,
        ...(draft && !order.isRefund
          ? [
              <Section
                title={_('pos_backend.lines.add')}
                body={
                  <Surface
                    body={
                      <RecordForm
                        action={actionPath}
                        submit={_('pos_backend.action.addProduct')}
                        submitVariant="secondary"
                        hidden={{ action: 'line' }}
                        fields={lineFields}
                      />
                    }
                  />
                }
              />,
            ]
          : []),
        ...(draft
          ? [
              <Section
                title={_('pos_backend.payments.title')}
                body={stack([
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
                              cell: (r) => formatMoney(_, r.amount, order.currency),
                              align: 'end',
                              kind: 'currency',
                            },
                          ],
                        }),
                      ]
                    : []),
                  <Surface
                    body={
                      <RecordForm
                        action={actionPath}
                        submit={_('pos_backend.action.addPayment')}
                        submitVariant="secondary"
                        hidden={{ action: 'payment' }}
                        fields={paymentFields}
                      />
                    }
                  />,
                ])}
              />,
            ]
          : []),
      ])}
    />
  )
}
