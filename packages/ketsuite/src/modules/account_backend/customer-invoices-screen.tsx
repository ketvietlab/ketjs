import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  formatMoney,
  framed,
  icon,
  linkButton,
  recordForm as RecordForm,
  recordWorkspace as RecordWorkspace,
  section as Section,
  stack,
  surface as Surface,
} from '../../ui/index.ts'
import type { FormField, Frame } from '../../ui/index.ts'
import { labelOf } from './screens.ts'

type Row = Record<string, unknown>

export const customerInvoicesScreen = (
  _: Translator,
  options: {
    frame: Frame
    fields: FormField[]
    rows: Row[]
    action: string
    locale: string
    errors?: string[]
  },
): TemplateResult => {
  const draft = options.rows.filter((row) => row.state === 'draft').length
  const posted = options.rows.filter((row) => row.state === 'posted').length
  const unpaid = options.rows.filter((row) => row.paymentState === 'not_paid').length
  const table = options.rows.length ? (
    dataTable(_, {
      rows: options.rows,
      id: (row) => String(row.id),
      columns: [
        {
          key: 'name',
          label: _('account_backend.field.name'),
          priority: 'primary',
          cell: (row) =>
            linkButton({
              label: String(row.name),
              href: `/admin/customer-invoices/${String(row.id)}${options.locale}`,
              variant: 'tertiary',
            }),
        },
        { key: 'date', label: _('account_backend.field.date'), cell: (row) => String(row.date).slice(0, 10) },
        {
          key: 'type',
          label: _('account_backend.field.moveType'),
          cell: (row) => labelOf(_, 'moveType', row.moveType),
        },
        {
          key: 'state',
          label: _('account_backend.field.state'),
          cell: (row) =>
            badge(
              labelOf(_, 'moveState', row.state),
              row.state === 'posted' ? 'positive' : 'neutral',
              String(row.state),
            ),
        },
        {
          key: 'payment',
          label: _('account_backend.field.paymentState'),
          cell: (row) => labelOf(_, 'paymentState', row.paymentState),
        },
        {
          key: 'total',
          label: _('account_backend.field.amountTotal'),
          cell: (row) => formatMoney(_, row.amountTotal, row.currency),
          align: 'end',
          kind: 'currency',
        },
      ],
    })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(
        _('account_backend.customerInvoice.empty'),
        _('account_backend.customerInvoice.emptyHint'),
        {
          icon: icon('banknote'),
        },
      )}
    />
  )

  return framed(
    _,
    _('account_backend.customerInvoices.title'),
    options.frame,
    <RecordWorkspace
      kicker={_('account_backend.customerInvoice.kicker')}
      title={_('account_backend.customerInvoices.title')}
      subtitle={_('account_backend.customerInvoice.subtitle')}
      imageFallback={icon('banknote')}
      summary={[
        {
          id: 'total',
          label: _('account_backend.customerInvoice.summary.total'),
          value: options.rows.length,
        },
        { id: 'draft', label: _('account_backend.customerInvoice.summary.draft'), value: draft },
        { id: 'posted', label: _('account_backend.customerInvoice.summary.posted'), value: posted },
        { id: 'unpaid', label: _('account_backend.customerInvoice.summary.unpaid'), value: unpaid },
      ]}
      body={stack(
        [
          <Section
            title={_('account_backend.customerInvoice.create.title')}
            description={_('account_backend.customerInvoice.create.hint')}
            body={
              <Surface
                padding="compact"
                body={
                  <RecordForm
                    id="customer-invoice-create-form"
                    scope="account-customer-invoice"
                    action={options.action}
                    submit={_('account_backend.action.create')}
                    submitVariant="primary"
                    fields={options.fields}
                    errors={options.errors}
                  />
                }
              />
            }
          />,
          <Section
            title={_('account_backend.customerInvoice.list.title')}
            description={_('account_backend.customerInvoice.list.hint')}
            body={table}
          />,
        ],
        'loose',
      )}
    />,
  )
}
