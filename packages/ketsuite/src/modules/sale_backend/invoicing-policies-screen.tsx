import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  framedPage as Framed,
  icon,
  recordForm as RecordForm,
  recordWorkspace as RecordWorkspace,
  section as Section,
  stack,
  surface as Surface,
} from '../../ui/index.ts'
import type { Column, FormField, Frame } from '../../ui/index.ts'
import { labelOf } from './screens.tsx'

type ProductRow = Record<string, unknown>

export type InvoicingPoliciesScreenOptions = {
  frame: Frame
  fields: FormField[]
  rows: ProductRow[]
  action: string
  errors?: string[]
}

const columns = (_: Translator): Array<Column<ProductRow>> => [
  {
    key: 'name',
    label: _('sale_backend.field.product'),
    priority: 'primary',
    cell: (row) => String(row.name),
  },
  {
    key: 'policy',
    label: _('sale_backend.field.invoicePolicy'),
    priority: 'secondary',
    cell: (row) => {
      const policy = row.invoicePolicy ?? 'order'
      return badge(
        labelOf(_, 'invoicePolicy', policy),
        policy === 'delivery' ? 'info' : 'neutral',
        String(policy),
      )
    },
  },
]

export const invoicingPoliciesScreen = (
  _: Translator,
  options: InvoicingPoliciesScreenOptions,
): TemplateResult => {
  const ordered = options.rows.filter((row) => (row.invoicePolicy ?? 'order') === 'order').length
  const delivered = options.rows.filter((row) => row.invoicePolicy === 'delivery').length
  const table = options.rows.length ? (
    dataTable(_, { rows: options.rows, id: (row) => String(row.id), columns: columns(_) })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('sale_backend.policy.empty'), _('sale_backend.policy.emptyHint'), {
        icon: icon('shopping-bag'),
      })}
    />
  )

  return (
    <Framed
      translator={_}
      title={_('sale_backend.policies.title')}
      frame={options.frame}
      body={
        <RecordWorkspace
          kicker={_('sale_backend.policy.kicker')}
          title={_('sale_backend.policies.title')}
          subtitle={_('sale_backend.policy.subtitle')}
          imageFallback={icon('shopping-bag')}
          summary={[
            { id: 'total', label: _('sale_backend.policy.summary.total'), value: options.rows.length },
            { id: 'ordered', label: _('sale_backend.policy.summary.order'), value: ordered },
            { id: 'delivered', label: _('sale_backend.policy.summary.delivery'), value: delivered },
          ]}
          body={stack(
            [
              <Section
                title={_('sale_backend.policy.edit.title')}
                description={_('sale_backend.policy.edit.hint')}
                body={
                  <Surface
                    padding="compact"
                    body={
                      <RecordForm
                        id="invoicing-policy-form"
                        scope="sales-invoicing-policy"
                        action={options.action}
                        submit={_('sale_backend.action.savePolicy')}
                        submitVariant="primary"
                        errors={options.errors}
                        fields={options.fields}
                      />
                    }
                  />
                }
              />,
              <Section
                title={_('sale_backend.policy.products.title')}
                description={_('sale_backend.policy.products.hint')}
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
