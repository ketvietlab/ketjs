import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  DefinitionList,
  emptyState,
  formatMoney,
  FormCluster,
  FormPage,
  icon,
  inline,
  linkButton,
  RecordActions,
  RecordForm,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { ActionVariant, FormField, Frame } from '../../../ui/index.ts'
import { labelOf } from './shared.tsx'

type SaleDetailRow = Record<string, unknown>

export type SaleOrderDetail = SaleDetailRow & {
  id?: unknown
  name?: unknown
  state?: unknown
  locked?: unknown
  partnerId?: unknown
  partnerName?: unknown
  dateOrder?: unknown
  validityDate?: unknown
  clientOrderRef?: unknown
  warehouseId?: unknown
  warehouseName?: unknown
  pricelistName?: unknown
  paymentTermName?: unknown
  notes?: unknown
  invoiceStatus?: unknown
  amountUntaxed?: unknown
  amountTax?: unknown
  amountTotal?: unknown
  currency?: unknown
  lines?: SaleDetailRow[]
  moves?: SaleDetailRow[]
  invoices?: SaleDetailRow[]
}

export type SaleOrderDetailScreenOptions = {
  order: SaleOrderDetail
  action: string
  lineFields: FormField[]
  invoiceFields: FormField[]
  collaboration: JSXChild
  editor: JSXChild
  integration?: JSXChild
  printActions?: JSXChild
  locale?: string
  errors?: string[]
}

const stateTone = (state: string) =>
  state === 'sale' ? 'positive' : state === 'cancel' ? 'danger' : state === 'sent' ? 'info' : 'neutral'

const ActionForm = ({
  action,
  value,
  label,
  variant,
}: {
  action: string
  value: string
  label: string
  variant: ActionVariant
}): TemplateResult => (
  <RecordForm
    scope="sale-order"
    action={action}
    submit={label}
    submitVariant={variant}
    layout="inline"
    hidden={{ action: value }}
    fields={[]}
  />
)

const actionForms = (_: Translator, order: SaleOrderDetail, action: string): TemplateResult[] => {
  const state = String(order.state)
  const actions: TemplateResult[] = []
  if (state === 'draft')
    actions.push(
      <ActionForm action={action} value="send" label={_('sale_backend.action.send')} variant="secondary" />,
    )
  if (state === 'draft' || state === 'sent')
    actions.push(
      <ActionForm
        action={action}
        value="confirm"
        label={_('sale_backend.action.confirm')}
        variant="primary"
      />,
    )
  if (state === 'sale') {
    actions.push(
      <ActionForm action={action} value="sync" label={_('sale_backend.action.sync')} variant="primary" />,
    )
    actions.push(
      <ActionForm
        action={action}
        value={order.locked ? 'unlock' : 'lock'}
        label={order.locked ? _('sale_backend.action.unlock') : _('sale_backend.action.lock')}
        variant="secondary"
      />,
    )
  }
  if (state === 'cancel')
    actions.push(
      <ActionForm action={action} value="reset" label={_('sale_backend.action.reset')} variant="primary" />,
    )
  if (state !== 'cancel')
    actions.push(
      <ActionForm
        action={action}
        value="cancel"
        label={_('sale_backend.action.cancel')}
        variant="destructive"
      />,
    )
  return actions
}

const orderLineTable = (
  _: Translator,
  options: SaleOrderDetailScreenOptions,
  editable: boolean,
): TemplateResult => {
  const { order } = options
  const lines = order.lines ?? []
  return lines.length
    ? dataTable(_, {
        rows: lines,
        id: (row) => String(row.id),
        columns: [
          {
            key: 'product',
            label: _('sale_backend.field.product'),
            cell: (row) => String(row.name),
            priority: 'primary',
          },
          {
            key: 'ordered',
            label: _('sale_backend.field.quantity'),
            cell: (row) => String(row.productUomQty),
            align: 'end',
            kind: 'number',
          },
          {
            key: 'delivered',
            label: _('sale_backend.field.delivered'),
            cell: (row) => String(row.qtyDelivered),
            align: 'end',
            kind: 'number',
          },
          {
            key: 'invoiced',
            label: _('sale_backend.field.invoiced'),
            cell: (row) => String(row.qtyInvoiced),
            align: 'end',
            kind: 'number',
          },
          {
            key: 'price',
            label: _('sale_backend.field.priceUnit'),
            cell: (row) => formatMoney(_, row.priceUnit, order.currency),
            align: 'end',
            kind: 'currency',
          },
          {
            key: 'subtotal',
            label: _('sale_backend.field.subtotal'),
            cell: (row) => formatMoney(_, row.priceSubtotal, order.currency),
            align: 'end',
            kind: 'currency',
          },
          ...(editable
            ? [
                {
                  key: 'actions',
                  label: _('sale_backend.field.actions'),
                  align: 'end' as const,
                  cell: (row: SaleDetailRow) => (
                    <RecordActions
                      action={options.action}
                      hidden={{ action: 'remove-line', lineId: String(row.id) }}
                      actions={[
                        {
                          value: 'remove-line',
                          label: _('sale_backend.action.removeLine'),
                          variant: 'destructive' as const,
                        },
                      ]}
                    />
                  ),
                },
              ]
            : []),
        ],
      })
    : emptyState(_('sale_backend.lines.empty'), _('sale_backend.lines.emptyHint'), {
        icon: icon('shopping-bag'),
      })
}

const orderInformation = (_: Translator, order: SaleOrderDetail): TemplateResult => (
  <DefinitionList
    title={_('sale_backend.order.information.title')}
    items={[
      {
        key: 'customer',
        term: _('sale_backend.field.customer'),
        value: String(order.partnerName ?? order.partnerId),
      },
      {
        key: 'date',
        term: _('sale_backend.field.dateOrder'),
        value: String(order.dateOrder ?? '').slice(0, 10) || '—',
      },
      {
        key: 'validity',
        term: _('sale_backend.field.validityDate'),
        value: String(order.validityDate ?? '').slice(0, 10) || '—',
      },
      {
        key: 'reference',
        term: _('sale_backend.field.clientOrderRef'),
        value: String(order.clientOrderRef ?? '—'),
      },
      {
        key: 'warehouse',
        term: _('sale_backend.field.warehouse'),
        value: String(order.warehouseName ?? order.warehouseId),
      },
      {
        key: 'pricelist',
        term: _('sale_backend.field.pricelist'),
        value: String(order.pricelistName ?? '—'),
      },
      {
        key: 'payment-term',
        term: _('sale_backend.field.paymentTerm'),
        value: String(order.paymentTermName ?? '—'),
      },
      {
        key: 'notes',
        term: _('sale_backend.field.notes'),
        value: String(order.notes ?? '—'),
      },
    ]}
  />
)

const deliveryTable = (_: Translator, rows: SaleDetailRow[], locale: string): TemplateResult =>
  dataTable(_, {
    rows,
    id: (row) => String(row.id),
    columns: [
      {
        key: 'name',
        label: _('sale_backend.field.name'),
        cell: (row) =>
          linkButton({
            label: String(row.origin ?? row.id),
            href: `/admin/stock/transfers/${String(row.pickingId)}${locale}`,
            variant: 'tertiary',
          }),
        priority: 'primary',
      },
      {
        key: 'state',
        label: _('sale_backend.field.state'),
        cell: (row) => String(row.state),
      },
      {
        key: 'quantity',
        label: _('sale_backend.field.delivered'),
        cell: (row) => String(row.quantity),
        align: 'end',
        kind: 'number',
      },
    ],
  })

const invoiceTable = (
  _: Translator,
  rows: SaleDetailRow[],
  orderCurrency: unknown,
  locale: string,
): TemplateResult =>
  dataTable(_, {
    rows,
    id: (row) => String(row.id),
    columns: [
      {
        key: 'name',
        label: _('sale_backend.field.name'),
        cell: (row) =>
          linkButton({
            label: String(row.name),
            href: `/admin/accounting/customer-invoices/${String(row.id)}${locale}`,
            variant: 'tertiary',
          }),
        priority: 'primary',
      },
      {
        key: 'state',
        label: _('sale_backend.field.state'),
        cell: (row) => String(row.state),
      },
      {
        key: 'total',
        label: _('sale_backend.field.amountTotal'),
        cell: (row) => formatMoney(_, row.amountTotal, row.currency ?? orderCurrency),
        align: 'end',
        kind: 'currency',
      },
    ],
  })

export const orderDetailScreen = (
  _: Translator,
  options: SaleOrderDetailScreenOptions,
  frame: Frame,
  partial = false,
): TemplateResult => {
  const { order } = options
  const state = String(order.state)
  const editable = (state === 'draft' || state === 'sent') && !order.locked
  const moves = order.moves ?? []
  const invoices = order.invoices ?? []
  const forms: JSXChild[] = [
    ...actionForms(_, order, options.action),
    ...(options.printActions === undefined ? [] : [options.printActions]),
  ]
  const documentKind = state === 'sale' ? _('sale_backend.order.kicker') : _('sale_backend.quotation.kicker')
  const page = (
    <FormPage
      scope="sale-order-form-page"
      title={String(order.name)}
      description={`${documentKind} · ${String(order.partnerName ?? order.partnerId)}`}
      status={inline([
        badge(labelOf(_, 'state', order.state), stateTone(state), state),
        ...(order.locked ? [badge(_('sale_backend.order.locked'), 'warning', 'locked')] : []),
      ])}
      actions={
        forms.length ? <FormCluster forms={forms} label={_('sale_backend.order.actions.label')} /> : undefined
      }
      meta={inline([
        badge(
          `${_('sale_backend.field.amountUntaxed')}: ${formatMoney(_, order.amountUntaxed, order.currency)}`,
          'neutral',
        ),
        badge(
          `${_('sale_backend.field.amountTax')}: ${formatMoney(_, order.amountTax, order.currency)}`,
          'neutral',
        ),
        badge(
          `${_('sale_backend.field.amountTotal')}: ${formatMoney(_, order.amountTotal, order.currency)}`,
          'info',
        ),
        badge(
          `${_('sale_backend.field.invoiceStatus')}: ${labelOf(_, 'invoiceStatus', order.invoiceStatus)}`,
          order.invoiceStatus === 'to invoice' ? 'warning' : 'neutral',
        ),
      ])}
      controller={options.editor}
      body={stack(
        [
          options.integration,
          <Section
            title={_('sale_backend.order.information.title')}
            description={_('sale_backend.order.information.hint')}
            body={<Surface padding="compact" body={orderInformation(_, order)} />}
          />,
          <Section
            title={_('sale_backend.lines.title')}
            description={_('sale_backend.lines.hint')}
            body={orderLineTable(_, options, editable)}
          />,
          editable ? (
            <Section
              title={_('sale_backend.lines.add')}
              description={_('sale_backend.lines.addHint')}
              body={
                <Surface
                  padding="compact"
                  body={
                    <RecordForm
                      id="sale-order-line-form"
                      scope="sale-order"
                      action={options.action}
                      submit={_('sale_backend.action.addLine')}
                      submitVariant="secondary"
                      hidden={{ action: 'add-line' }}
                      fields={options.lineFields}
                      errors={options.errors}
                    />
                  }
                />
              }
            />
          ) : null,
          state === 'sale' && order.invoiceStatus === 'to invoice' ? (
            <Section
              title={_('sale_backend.invoice.title')}
              description={_('sale_backend.invoice.hint')}
              body={
                <Surface
                  padding="compact"
                  body={
                    <RecordForm
                      id="sale-order-invoice-form"
                      scope="sale-order"
                      action={options.action}
                      submit={_('sale_backend.action.createInvoice')}
                      submitVariant="primary"
                      hidden={{ action: 'invoice' }}
                      fields={options.invoiceFields}
                      errors={options.errors}
                    />
                  }
                />
              }
            />
          ) : null,
          moves.length ? (
            <Section
              title={_('sale_backend.deliveries.title')}
              body={deliveryTable(_, moves, options.locale ?? '')}
            />
          ) : null,
          invoices.length ? (
            <Section
              title={_('sale_backend.invoices.title')}
              body={invoiceTable(_, invoices, order.currency, options.locale ?? '')}
            />
          ) : null,
        ],
        'loose',
      )}
      aside={options.collaboration}
      asideLabel={_('sale_backend.order.collaboration.label')}
      slots={{
        header: 'sale.order-header',
        body: 'sale.order-body',
        ...(partial ? { fragmentTitle: String(order.name) } : {}),
      }}
    />
  )
  return partial ? page : shell(_, String(order.name), page, { ...frame, topbar: false, titled: false })
}
