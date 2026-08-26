import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  formatMoney,
  Framed,
  icon,
  linkButton,
  RecordForm,
  RecordWorkspace,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { FormField, Frame } from '../../ui/index.ts'
import { labelOf } from './screens/shared.tsx'

type Row = Record<string, unknown>

export const paymentsScreen = (
  _: Translator,
  options: {
    frame: Frame
    fields: FormField[]
    rows: Row[]
    action: string
    openItems: number
    /** Where a payment's own journal entry lives, so the row is not a dead end. */
    entryHref?: (row: Row) => string
    errors?: string[]
  },
): TemplateResult => {
  const inbound = options.rows.filter((row) => row.paymentType === 'inbound').length
  const outbound = options.rows.filter((row) => row.paymentType === 'outbound').length
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
            options.entryHref && row.moveId
              ? linkButton({ label: String(row.name), href: options.entryHref(row), variant: 'tertiary' })
              : String(row.name),
        },
        { key: 'date', label: _('account_backend.field.date'), cell: (row) => String(row.date).slice(0, 10) },
        {
          key: 'type',
          label: _('account_backend.field.paymentType'),
          cell: (row) => labelOf(_, 'paymentType', row.paymentType),
        },
        {
          key: 'partner',
          label: _('account_backend.field.partnerType'),
          cell: (row) => labelOf(_, 'partnerType', row.partnerType),
        },
        {
          key: 'amount',
          label: _('account_backend.field.paymentAmount'),
          cell: (row) => formatMoney(_, row.amount, row.currency),
          align: 'end',
          kind: 'currency',
        },
        {
          key: 'state',
          label: _('account_backend.field.state'),
          cell: (row) =>
            badge(
              labelOf(_, 'paymentStatus', row.state),
              row.state === 'paid' ? 'positive' : 'neutral',
              String(row.state),
            ),
        },
      ],
    })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('account_backend.payment.empty'), _('account_backend.payment.emptyHint'), {
        icon: icon('credit-card'),
      })}
    />
  )

  return (
    <Framed
      translator={_}
      title={_('account_backend.payments.title')}
      frame={options.frame}
      body={
        <RecordWorkspace
          kicker={_('account_backend.payment.kicker')}
          title={_('account_backend.payments.title')}
          subtitle={_('account_backend.payment.subtitle')}
          imageFallback={icon('credit-card')}
          summary={[
            { id: 'total', label: _('account_backend.payment.summary.total'), value: options.rows.length },
            { id: 'inbound', label: _('account_backend.payment.summary.inbound'), value: inbound },
            { id: 'outbound', label: _('account_backend.payment.summary.outbound'), value: outbound },
            { id: 'open', label: _('account_backend.payment.summary.open'), value: options.openItems },
          ]}
          body={stack(
            [
              <Section
                title={_('account_backend.payment.create.title')}
                description={_('account_backend.payment.create.hint')}
                body={
                  <Surface
                    padding="compact"
                    body={
                      <RecordForm
                        id="payment-register-form"
                        scope="account-payment"
                        action={options.action}
                        submit={_('account_backend.action.registerPayment')}
                        submitVariant="primary"
                        fields={options.fields}
                        errors={options.errors}
                      />
                    }
                  />
                }
              />,
              <Section
                title={_('account_backend.payment.list.title')}
                description={_('account_backend.payment.list.hint')}
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
