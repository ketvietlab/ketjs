import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  CardGrid,
  ContentCard,
  dataTable,
  emptyState,
  formatMoney,
  Framed,
  linkButton,
  Metric,
  RecordActions,
  RecordForm,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { FormField, Frame } from '../../ui/index.ts'
import { selectionLabel } from '../backend/screen.ts'

type AnyRow = Record<string, unknown>
/** A stable sale code in the reader's language; the code itself survives as data. */
export const labelOf = (_: Translator, group: string, value: unknown): string =>
  selectionLabel(_, 'sale_backend', group, value)
const pathOf = (order: AnyRow) =>
  ['draft', 'sent'].includes(String(order.state))
    ? `/admin/sales/quotations/${String(order.id)}`
    : `/admin/sales/orders/${String(order.id)}`
const empty = (_: Translator) => emptyState(_('sale_backend.empty'), _('sale_backend.emptyHint'))

export const ordersScreen = (
  _: Translator,
  o: { title: string; frame: Frame; rows: AnyRow[]; fields?: FormField[] },
): TemplateResult => (
  <Framed
    translator={_}
    title={o.title}
    frame={o.frame}
    body={stack([
      ...(o.fields
        ? [
            <Surface
              body={
                <RecordForm
                  action="/admin/sales/quotations"
                  submit={_('sale_backend.action.create')}
                  submitVariant="primary"
                  fields={o.fields}
                />
              }
            />,
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
                cell: (r) => formatMoney(_, r.amountTotal, r.currency),
                align: 'end',
                kind: 'currency',
              },
            ],
          })
        : empty(_),
    ])}
  />
)

export const policyScreen = (
  _: Translator,
  frame: Frame,
  fields: FormField[],
  rows: AnyRow[],
): TemplateResult => (
  <Framed
    translator={_}
    title={_('sale_backend.policies.title')}
    frame={frame}
    body={stack([
      <Surface
        body={
          <RecordForm
            action="/admin/sales/invoicing-policies"
            submit={_('sale_backend.action.savePolicy')}
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
    ])}
  />
)

export const orderDetail = (
  _: Translator,
  o: {
    frame: Frame
    order: AnyRow
    actionPath: string
    lineFields: FormField[]
    invoiceFields: FormField[]
    integration?: JSXChild
  },
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
  return (
    <Framed
      translator={_}
      title={String(o.order.name)}
      frame={o.frame}
      body={stack([
        <CardGrid
          items={[
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
              value: formatMoney(_, o.order.amountTotal, o.order.currency),
            },
          ]}
          id={(item) => item.id}
          card={(item) => (
            <ContentCard title={item.label} body={<Metric label={item.label} value={item.value} />} />
          )}
        />,
        ...(o.integration === undefined ? [] : [o.integration]),
        ...(actions.length
          ? [<Surface body={<RecordActions action={o.actionPath} actions={actions} />} />]
          : []),
        <Section
          title={_('sale_backend.lines.title')}
          body={
            lines.length
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
                    {
                      key: 'price',
                      label: _('sale_backend.field.priceUnit'),
                      cell: (r) => formatMoney(_, r.priceUnit, o.order.currency),
                      align: 'end',
                      kind: 'currency',
                    },
                    {
                      key: 'subtotal',
                      label: _('sale_backend.field.subtotal'),
                      cell: (r) => formatMoney(_, r.priceSubtotal, o.order.currency),
                      align: 'end',
                      kind: 'currency',
                    },
                  ],
                })
              : empty(_)
          }
        />,
        ...(['draft', 'sent'].includes(state) && !o.order.locked
          ? [
              <Section
                title={_('sale_backend.lines.add')}
                body={
                  <Surface
                    body={
                      <RecordForm
                        action={o.actionPath}
                        submit={_('sale_backend.action.addLine')}
                        submitVariant="secondary"
                        hidden={{ action: 'add-line' }}
                        fields={o.lineFields}
                      />
                    }
                  />
                }
              />,
            ]
          : []),
        ...(state === 'sale' && o.order.invoiceStatus === 'to invoice'
          ? [
              <Section
                title={_('sale_backend.invoice.title')}
                body={
                  <Surface
                    body={
                      <RecordForm
                        action={o.actionPath}
                        submit={_('sale_backend.action.createInvoice')}
                        submitVariant="primary"
                        hidden={{ action: 'invoice' }}
                        fields={o.invoiceFields}
                      />
                    }
                  />
                }
              />,
            ]
          : []),
        ...(moves.length
          ? [
              <Section
                title={_('sale_backend.deliveries.title')}
                body={dataTable(_, {
                  rows: moves,
                  id: (r) => String(r.id),
                  columns: [
                    {
                      key: 'name',
                      label: _('sale_backend.field.name'),
                      cell: (r) =>
                        linkButton({
                          label: String(r.origin ?? r.id),
                          href: `/admin/stock/transfers/${String(r.pickingId)}`,
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
                })}
              />,
            ]
          : []),
        ...(invoices.length
          ? [
              <Section
                title={_('sale_backend.invoices.title')}
                body={dataTable(_, {
                  rows: invoices,
                  id: (r) => String(r.id),
                  columns: [
                    {
                      key: 'name',
                      label: _('sale_backend.field.name'),
                      cell: (r) =>
                        linkButton({
                          label: String(r.name),
                          href: `/admin/accounting/customer-invoices/${String(r.id)}`,
                          variant: 'tertiary',
                        }),
                      priority: 'primary',
                    },
                    { key: 'state', label: _('sale_backend.field.state'), cell: (r) => String(r.state) },
                    {
                      key: 'total',
                      label: _('sale_backend.field.amountTotal'),
                      cell: (r) => formatMoney(_, r.amountTotal, r.currency ?? o.order.currency),
                      align: 'end',
                      kind: 'currency',
                    },
                  ],
                })}
              />,
            ]
          : []),
      ])}
    />
  )
}
