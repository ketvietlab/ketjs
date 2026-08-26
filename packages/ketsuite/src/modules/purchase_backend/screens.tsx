import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  formatMoney,
  Framed,
  linkButton,
  RecordForm,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { FormField, Frame } from '../../ui/index.ts'
import { labelOf, missingSetup, purchaseOrderPath, rejection } from './screens/shared.tsx'

type AnyRow = Record<string, unknown>

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
                  linkButton({ label: String(row.name), href: purchaseOrderPath(row), variant: 'tertiary' }),
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
