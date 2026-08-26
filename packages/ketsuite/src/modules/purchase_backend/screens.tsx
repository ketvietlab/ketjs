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
import { missingSetup, rejection } from './screens/shared.tsx'

type AnyRow = Record<string, unknown>

/** A stable purchase code in the reader's language; the code itself survives as data. */
export const labelOf = (_: Translator, group: string, value: unknown): string =>
  selectionLabel(_, 'purchase_backend', group, value)

const pathOf = (order: AnyRow) =>
  ['draft', 'sent', 'to approve'].includes(String(order.state))
    ? `/admin/purchase/rfqs/${String(order.id)}`
    : `/admin/purchase/orders/${String(order.id)}`

const empty = (_: Translator) => emptyState(_('purchase_backend.empty'), _('purchase_backend.emptyHint'))

export const ordersScreen = (
  _: Translator,
  o: {
    title: string
    frame: Frame
    rows: AnyRow[]
    createFields?: FormField[]
    createAction?: string
    invalid?: string | null
    setup?: { pickingTypes: number; vendors: number }
    /** Where a record on this screen comes from, when it is not created here. */
    originPath?: string
  },
): TemplateResult => (
  <Framed
    translator={_}
    title={o.title}
    frame={o.frame}
    body={stack([
      rejection(_, o.invalid),
      o.setup ? missingSetup(_, o.setup) : null,
      ...(o.createFields
        ? [
            <Surface
              body={
                <RecordForm
                  id="rfq-create-form"
                  scope="purchase-rfq-create"
                  action={o.createAction ?? '/admin/purchase/rfqs'}
                  submit={_('purchase_backend.action.createRfq')}
                  submitVariant="primary"
                  fields={o.createFields}
                />
              }
            />,
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
        : o.setup && (!o.setup.vendors || !o.setup.pickingTypes)
          ? null
          : o.originPath
            ? emptyState(_('purchase_backend.orders.empty'), _('purchase_backend.orders.emptyHint'), {
                actions: linkButton({
                  label: _('purchase_backend.orders.openRequests'),
                  href: o.originPath,
                  variant: 'primary',
                }),
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
    actionPath?: string
    lineFields: FormField[]
    billFields: FormField[]
    printActions?: JSXChild
    invalid?: string | null
  },
): TemplateResult => {
  const path = o.actionPath ?? pathOf(o.order)
  const editable = ['draft', 'sent'].includes(String(o.order.state)) && !o.order.locked
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
  // Approving is not the only answer to a request under review, and refusing it
  // should not mean destroying it.
  if (['sent', 'to approve'].includes(state))
    actions.push({ value: 'reset', label: _('purchase_backend.action.resetToDraft') })
  if (state === 'purchase') {
    actions.push({ value: 'sync', label: _('purchase_backend.action.syncReceipts'), variant: 'primary' })
    actions.push({
      value: o.order.locked ? 'unlock' : 'lock',
      label: o.order.locked ? _('purchase_backend.action.unlock') : _('purchase_backend.action.lock'),
    })
  }
  // A locked order refuses cancellation, so offering the button only produced a
  // rejection notice.
  if (state !== 'cancel' && !o.order.locked)
    actions.push({ value: 'cancel', label: _('purchase_backend.action.cancel'), variant: 'destructive' })
  return (
    <Framed
      translator={_}
      title={String(o.order.name)}
      frame={o.frame}
      body={stack([
        rejection(_, o.invalid),
        <CardGrid
          items={[
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
          ]}
          id={(item) => item.id}
          card={(item) => (
            <ContentCard title={item.label} body={<Metric label={item.label} value={item.value} />} />
          )}
        />,
        ...(actions.length ? [<Surface body={<RecordActions action={path} actions={actions} />} />] : []),
        ...(o.printActions === undefined ? [] : [<Surface body={o.printActions} />]),
        <Section
          title={_('purchase_backend.lines.title')}
          body={
            lines.length
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
                    ...(editable
                      ? [
                          {
                            key: 'edit',
                            label: _('purchase_backend.lines.edit'),
                            cell: (row: AnyRow) => (
                              <RecordForm
                                layout="inline"
                                action={path}
                                submit={_('purchase_backend.action.updateLine')}
                                submitVariant="secondary"
                                hidden={{ action: 'update-line', lineId: String(row.id) }}
                                fields={[
                                  {
                                    name: 'productQty',
                                    label: _('purchase_backend.field.productQty'),
                                    type: 'decimal',
                                    value: String(row.productQty),
                                    required: true,
                                  },
                                  {
                                    name: 'priceUnit',
                                    label: _('purchase_backend.field.priceUnit'),
                                    type: 'decimal',
                                    value: String(row.priceUnit),
                                  },
                                ]}
                              />
                            ),
                          },
                          {
                            key: 'remove',
                            label: '',
                            cell: (row: AnyRow) => (
                              <RecordForm
                                layout="inline"
                                action={path}
                                submit={_('purchase_backend.action.removeLine')}
                                submitVariant="destructive"
                                hidden={{ action: 'remove-line', lineId: String(row.id) }}
                                fields={[]}
                              />
                            ),
                          },
                        ]
                      : []),
                  ],
                })
              : emptyState(_('purchase_backend.lines.empty'), _('purchase_backend.lines.emptyHint'))
          }
        />,
        ...(['draft', 'sent'].includes(state) && !o.order.locked
          ? [
              <Section
                title={_('purchase_backend.lines.add')}
                body={
                  <Surface
                    body={
                      <RecordForm
                        action={path}
                        submit={_('purchase_backend.action.addLine')}
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
        ...(state === 'purchase' && o.order.invoiceStatus === 'to invoice'
          ? [
              <Section
                title={_('purchase_backend.bill.title')}
                body={
                  <Surface
                    body={
                      <RecordForm
                        action={path}
                        submit={_('purchase_backend.action.createBill')}
                        submitVariant="primary"
                        hidden={{ action: 'bill' }}
                        fields={o.billFields}
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
                title={_('purchase_backend.receipts.title')}
                body={dataTable(_, {
                  rows: moves,
                  id: (row) => String(row.id),
                  columns: [
                    {
                      key: 'origin',
                      label: _('purchase_backend.field.name'),
                      cell: (row) =>
                        linkButton({
                          label: String(row.origin ?? row.id),
                          href: `/admin/stock/transfers/${String(row.pickingId)}`,
                          variant: 'tertiary',
                        }),
                      priority: 'primary',
                    },
                    {
                      key: 'state',
                      label: _('purchase_backend.field.state'),
                      cell: (row) => badge(labelOf(_, 'moveState', row.state), 'neutral'),
                    },
                    {
                      key: 'quantity',
                      label: _('purchase_backend.field.qtyReceived'),
                      cell: (row) => String(row.quantity),
                    },
                  ],
                })}
              />,
            ]
          : []),
        ...(bills.length
          ? [
              <Section
                title={_('purchase_backend.bills.title')}
                body={dataTable(_, {
                  rows: bills,
                  id: (row) => String(row.id),
                  columns: [
                    {
                      key: 'name',
                      label: _('purchase_backend.field.name'),
                      cell: (row) =>
                        linkButton({
                          label: String(row.name),
                          href: `/admin/accounting/vendor-bills/${String(row.id)}`,
                          variant: 'tertiary',
                        }),
                      priority: 'primary',
                    },
                    {
                      key: 'state',
                      label: _('purchase_backend.field.state'),
                      cell: (row) => badge(labelOf(_, 'billState', row.state), 'neutral'),
                    },
                    {
                      key: 'total',
                      label: _('purchase_backend.field.amountTotal'),
                      cell: (row) => formatMoney(_, row.amountTotal, row.currency ?? o.order.currency),
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
