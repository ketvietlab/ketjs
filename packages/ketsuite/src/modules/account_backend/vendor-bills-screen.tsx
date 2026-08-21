import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  formatMoney,
  framedPage as Framed,
  icon,
  linkButton,
  recordForm as RecordForm,
  recordWorkspace as RecordWorkspace,
  section as Section,
  stack,
  surface as Surface,
} from '../../ui/index.ts'
import type { FormField, Frame } from '../../ui/index.ts'
import { labelOf } from './screens.tsx'

type Row = Record<string, unknown>

export const vendorBillsScreen = (
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
              href: `/admin/vendor-bills/${String(row.id)}${options.locale}`,
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
      body={emptyState(_('account_backend.vendorBill.empty'), _('account_backend.vendorBill.emptyHint'), {
        icon: icon('banknote'),
      })}
    />
  )

  return (
    <Framed
      translator={_}
      title={_('account_backend.vendorBills.title')}
      frame={options.frame}
      body={
        <RecordWorkspace
          kicker={_('account_backend.vendorBill.kicker')}
          title={_('account_backend.vendorBills.title')}
          subtitle={_('account_backend.vendorBill.subtitle')}
          imageFallback={icon('banknote')}
          summary={[
            { id: 'total', label: _('account_backend.vendorBill.summary.total'), value: options.rows.length },
            { id: 'draft', label: _('account_backend.vendorBill.summary.draft'), value: draft },
            { id: 'posted', label: _('account_backend.vendorBill.summary.posted'), value: posted },
            { id: 'unpaid', label: _('account_backend.vendorBill.summary.unpaid'), value: unpaid },
          ]}
          body={stack(
            [
              <Section
                title={_('account_backend.vendorBill.create.title')}
                description={_('account_backend.vendorBill.create.hint')}
                body={
                  <Surface
                    padding="compact"
                    body={
                      <RecordForm
                        id="vendor-bill-create-form"
                        scope="account-vendor-bill"
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
                title={_('account_backend.vendorBill.list.title')}
                description={_('account_backend.vendorBill.list.hint')}
                body={table}
              />,
            ],
            'loose',
          )}
        />
      }
    />
  )
}
