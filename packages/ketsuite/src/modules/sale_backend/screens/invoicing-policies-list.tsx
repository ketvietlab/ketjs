import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  icon,
  inline,
  LinkButton,
  ListPage,
  listChrome,
  shell,
} from '../../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../../ui/index.ts'
import { labelOf } from './shared.tsx'

export type InvoicingPolicyRow = Record<string, unknown>

export type InvoicingPoliciesListScreenOptions = {
  rows: InvoicingPolicyRow[]
  /** Locale-aware `/admin/sales/invoicing-policies/new` URL supplied by the route. */
  createHref: string
  total?: number
  table?: Partial<DataTable<InvoicingPolicyRow>>
}

export const invoicingPolicyColumns = (_: Translator): Array<Column<InvoicingPolicyRow>> => [
  {
    key: 'name',
    label: _('sale_backend.field.product'),
    priority: 'primary',
    width: 'wide',
    cell: (row) => String(row.name),
  },
  {
    key: 'policy',
    label: _('sale_backend.field.invoicePolicy'),
    priority: 'secondary',
    kind: 'status',
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

export const invoicingPoliciesListScreen = (
  _: Translator,
  options: InvoicingPoliciesListScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const total = options.total ?? options.rows.length
  const ordered = options.rows.filter((row) => (row.invoicePolicy ?? 'order') === 'order').length
  const delivered = options.rows.filter((row) => row.invoicePolicy === 'delivery').length
  const summary = [
    `${_('sale_backend.policy.summary.total')}: ${String(total)}`,
    `${_('sale_backend.policy.summary.order')}: ${String(ordered)}`,
    `${_('sale_backend.policy.summary.delivery')}: ${String(delivered)}`,
  ].join(' · ')

  return shell(
    _,
    _('sale_backend.policies.title'),
    <ListPage
      title={_('sale_backend.policies.title')}
      description={_('sale_backend.policy.subtitle')}
      actions={inline([
        <LinkButton
          label={_('sale_backend.action.savePolicy')}
          href={options.createHref}
          variant="primary"
        />,
        frame.extras?.['topbar.end'] ?? '',
      ])}
      controls={
        frame.chrome
          ? listChrome(
              _,
              _('sale_backend.policies.title'),
              { ...frame.chrome, layout: 'command', section: undefined, create: null },
              false,
            )
          : undefined
      }
      status={summary}
      body={
        options.rows.length || options.table?.groups?.length
          ? dataTable(_, {
              rows: options.rows,
              id: (row) => String(row.id),
              columns: invoicingPolicyColumns(_),
              ...options.table,
            })
          : emptyState(_('sale_backend.policy.empty'), _('sale_backend.policy.emptyHint'), {
              icon: icon('shopping-bag'),
            })
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
