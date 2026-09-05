import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  formatMoney,
  icon,
  inline,
  LinkButton,
  ListPage,
  listChrome,
  shell,
  Surface,
} from '../../../ui/index.ts'
import type { DataTable, Frame } from '../../../ui/index.ts'
import { labelOf } from './shared.tsx'

export type TaxListRow = Record<string, unknown>

export type TaxListSummary = {
  total: number
  sale: number
  purchase: number
  included: number
}

export type TaxesListScreenOptions = {
  frame: Frame
  rows: TaxListRow[]
  accounts: TaxListRow[]
  currency: unknown
  createHref: string
  rowHref: (row: TaxListRow) => string
  summary: TaxListSummary
  table?: Partial<DataTable<TaxListRow>>
}

export const taxListColumns = (
  _: Translator,
  accountCodes: ReadonlyMap<string, string>,
  currency: unknown,
) => [
  {
    key: 'name',
    label: _('account_backend.field.name'),
    priority: 'primary' as const,
    width: 'wide' as const,
    cell: (row: TaxListRow) => String(row.name),
  },
  {
    key: 'use',
    label: _('account_backend.field.typeTaxUse'),
    cell: (row: TaxListRow) => labelOf(_, 'taxUse', row.typeTaxUse),
  },
  {
    key: 'computation',
    label: _('account_backend.field.amountType'),
    cell: (row: TaxListRow) => labelOf(_, 'taxAmountType', row.amountType),
  },
  {
    key: 'amount',
    label: _('account_backend.field.amount'),
    cell: (row: TaxListRow) =>
      row.amountType === 'fixed' ? formatMoney(_, row.amount, currency) : `${String(row.amount)}%`,
    align: 'end' as const,
    kind: 'number' as const,
  },
  {
    key: 'account',
    label: _('account_backend.field.accountId'),
    cell: (row: TaxListRow) => (row.accountId ? (accountCodes.get(String(row.accountId)) ?? '—') : '—'),
  },
  {
    key: 'included',
    label: _('account_backend.field.priceInclude'),
    kind: 'status' as const,
    cell: (row: TaxListRow) =>
      badge(
        row.priceInclude ? _('account_backend.yes') : _('account_backend.no'),
        row.priceInclude ? 'positive' : 'neutral',
        row.priceInclude ? 'yes' : 'no',
      ),
  },
  {
    key: 'base',
    label: _('account_backend.column.includeBaseAmount'),
    kind: 'status' as const,
    cell: (row: TaxListRow) =>
      badge(
        row.includeBaseAmount ? _('account_backend.yes') : _('account_backend.no'),
        row.includeBaseAmount ? 'positive' : 'neutral',
        row.includeBaseAmount ? 'yes' : 'no',
      ),
  },
  {
    key: 'active',
    label: _('account_backend.field.active'),
    kind: 'status' as const,
    cell: (row: TaxListRow) =>
      badge(
        row.active ? _('account_backend.active') : _('account_backend.archived'),
        row.active ? 'positive' : 'neutral',
        row.active ? 'active' : 'archived',
      ),
  },
]

export const taxesListScreen = (_: Translator, options: TaxesListScreenOptions): TemplateResult => {
  const accountCodes = new Map(options.accounts.map((account) => [String(account.id), String(account.code)]))
  const status = [
    `${_('account_backend.tax.summary.total')}: ${String(options.summary.total)}`,
    `${_('account_backend.tax.summary.sale')}: ${String(options.summary.sale)}`,
    `${_('account_backend.tax.summary.purchase')}: ${String(options.summary.purchase)}`,
    `${_('account_backend.tax.summary.included')}: ${String(options.summary.included)}`,
  ].join(' · ')
  const table =
    options.rows.length || options.table?.groups?.length ? (
      dataTable(_, {
        rows: options.rows,
        id: (row) => String(row.id),
        rowHref: options.rowHref,
        columns: taxListColumns(_, accountCodes, options.currency),
        ...options.table,
      })
    ) : (
      <Surface
        padding="compact"
        body={emptyState(_('account_backend.tax.empty'), _('account_backend.tax.emptyHint'), {
          icon: icon('banknote'),
        })}
      />
    )

  return shell(
    _,
    _('account_backend.taxes.title'),
    <ListPage
      variant="operational"
      frame={options.frame}
      title={_('account_backend.taxes.title')}
      description={_('account_backend.tax.subtitle')}
      actions={inline([
        <LinkButton label={_('account_backend.action.create')} href={options.createHref} variant="primary" />,
        options.frame.extras?.['topbar.end'] ?? '',
      ])}
      controls={
        options.frame.chrome
          ? listChrome(
              _,
              _('account_backend.taxes.title'),
              {
                ...options.frame.chrome,
                layout: 'command',
                section: undefined,
                create: null,
                selection: null,
              },
              false,
            )
          : undefined
      }
      status={status}
      body={table}
    />,
    { ...options.frame, chrome: null, topbar: false },
  )
}
