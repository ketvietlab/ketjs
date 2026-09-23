// What the search-filter bar offers on the accounting lists.
//
// Every list here reads a bounded, already-authorised collection and narrows it
// in memory, so each spec covers exactly the columns its table renders, plus
// the enumerated states the old facet menus offered as presets.
//
// None of them declares a `defaultSort`. The order a list arrives in is the
// order the domain chose — entries and invoices newest first, accounts by code
// — and a spec that sorted again would quietly replace a deliberate order with
// its own. Sorting is offered; it is not imposed.
//
// Two fields are not on the rows the domain returns: an account's display name
// depends on the reader's language, and a document's partner is an id the list
// resolves through a name map. Their routes put `displayName` and `partnerName`
// on the rows before handing them over, which is cheaper than teaching every
// spec how to reach for them.
import {
  ACCOUNT_TYPES,
  JOURNAL_TYPES,
  MOVE_STATES,
  PARTNER_TYPES,
  PAYMENT_STATES,
  PAYMENT_TYPES,
  TAX_AMOUNT_TYPES,
  TAX_USES,
} from '../account/functions.ts'
import { defineRowList } from '../backend/row-list.ts'
import type { AnyRow, RowPreset } from '../backend/row-list.ts'

const CUSTOMER_INVOICE_TYPES = ['out_invoice', 'out_refund', 'out_receipt'] as const
const VENDOR_BILL_TYPES = ['in_invoice', 'in_refund', 'in_receipt'] as const
const CLOSE_STATES = ['open', 'soft_closed', 'hard_closed', 'reopened'] as const
const OPENING_STATES = ['pending', 'validated', 'posted', 'blocked'] as const

/** Presets over one enumerated field, labelled the way the screens label it. */
const statePresets = (
  field: string,
  group: string,
  selection: string,
  values: readonly string[],
): RowPreset[] =>
  values.map((value) => ({
    key: value,
    label: `account_backend.${selection}.${value}`,
    group,
    match: (row: AnyRow) => String(row[field] ?? '') === value,
  }))

/** Which side of the balance sheet, or the profit and loss, a type belongs to. */
const FAMILIES: Record<string, readonly string[]> = {
  asset: ['asset'],
  liability: ['liability', 'equity'],
  profit: ['income', 'expense'],
}

export const accountListSearch = defineRowList({
  key: 'account.accounts',
  searchable: [{ key: 'code' }, { key: 'displayName' }],
  filterable: [
    { key: 'code', label: 'account_backend.field.code', type: 'text' },
    { key: 'displayName', label: 'account_backend.field.name', type: 'text' },
    {
      key: 'accountType',
      label: 'account_backend.field.accountType',
      type: 'selection',
      choices: ACCOUNT_TYPES,
    },
    { key: 'reconcile', label: 'account_backend.field.reconcile', type: 'boolean' },
    // Declaring this is what gives the bar its archived toggle, which
    // supersedes the old status facet over the same field.
    { key: 'active', label: 'account_backend.field.active', type: 'boolean' },
  ],
  groupable: [{ key: 'accountType', label: 'account_backend.field.accountType' }],
  sortable: [
    { key: 'code', label: 'account_backend.field.code' },
    { key: 'displayName', label: 'account_backend.field.name' },
    { key: 'accountType', label: 'account_backend.field.accountType' },
  ],
  presets: Object.entries(FAMILIES).map(([family, prefixes]) => ({
    key: family,
    label: `account_backend.account.summary.${family}`,
    group: 'family',
    match: (row: AnyRow) => prefixes.some((prefix) => String(row.accountType ?? '').startsWith(prefix)),
  })),
})

export const journalListSearch = defineRowList({
  key: 'account.journals',
  searchable: [{ key: 'code' }, { key: 'name' }],
  filterable: [
    { key: 'code', label: 'account_backend.field.code', type: 'text' },
    { key: 'name', label: 'account_backend.field.name', type: 'text' },
    { key: 'type', label: 'account_backend.field.type', type: 'selection', choices: JOURNAL_TYPES },
    { key: 'active', label: 'account_backend.field.active', type: 'boolean' },
  ],
  groupable: [{ key: 'type', label: 'account_backend.field.type' }],
  sortable: [
    { key: 'code', label: 'account_backend.field.code' },
    { key: 'name', label: 'account_backend.field.name' },
    { key: 'type', label: 'account_backend.field.type' },
  ],
  presets: statePresets('type', 'type', 'journalType', JOURNAL_TYPES),
})

export const taxListSearch = defineRowList({
  key: 'account.taxes',
  searchable: [{ key: 'name' }, { key: 'description' }, { key: 'amount' }],
  filterable: [
    { key: 'name', label: 'account_backend.field.name', type: 'text' },
    { key: 'description', label: 'account_backend.field.description', type: 'text' },
    { key: 'amount', label: 'account_backend.field.amount', type: 'number' },
    {
      key: 'typeTaxUse',
      label: 'account_backend.field.typeTaxUse',
      type: 'selection',
      choices: TAX_USES,
    },
    {
      key: 'amountType',
      label: 'account_backend.field.amountType',
      type: 'selection',
      choices: TAX_AMOUNT_TYPES,
    },
    { key: 'priceInclude', label: 'account_backend.field.priceInclude', type: 'boolean' },
    { key: 'active', label: 'account_backend.field.active', type: 'boolean' },
  ],
  groupable: [
    { key: 'typeTaxUse', label: 'account_backend.field.typeTaxUse' },
    { key: 'amountType', label: 'account_backend.field.amountType' },
  ],
  sortable: [
    { key: 'name', label: 'account_backend.field.name' },
    { key: 'amount', label: 'account_backend.field.amount' },
  ],
  presets: [
    ...statePresets('typeTaxUse', 'use', 'taxUse', TAX_USES),
    ...statePresets('amountType', 'computation', 'taxAmountType', TAX_AMOUNT_TYPES),
    {
      key: 'included',
      label: 'account_backend.field.priceInclude',
      group: 'included',
      match: (row: AnyRow) => row.priceInclude === true,
    },
  ],
})

export const paymentTermListSearch = defineRowList({
  key: 'account.payment-terms',
  searchable: [{ key: 'name' }, { key: 'note' }],
  filterable: [
    { key: 'name', label: 'account_backend.field.name', type: 'text' },
    { key: 'note', label: 'account_backend.field.note', type: 'text' },
    { key: 'active', label: 'account_backend.field.active', type: 'boolean' },
  ],
  sortable: [{ key: 'name', label: 'account_backend.field.name' }],
})

/** The columns every document list shows: what it is called, when, and by whom. */
const documentFields = [
  { key: 'name', label: 'account_backend.field.name', type: 'text' as const },
  { key: 'ref', label: 'account_backend.field.ref', type: 'text' as const },
  { key: 'accountingDate', label: 'account_backend.field.accountingDate', type: 'date' as const },
  { key: 'partnerName', label: 'account_backend.field.partnerId', type: 'text' as const },
]

export const journalEntryListSearch = defineRowList({
  key: 'account.entries',
  searchable: [{ key: 'name' }, { key: 'ref' }, { key: 'accountingDate' }, { key: 'partnerName' }],
  filterable: [
    ...documentFields,
    { key: 'state', label: 'account_backend.field.state', type: 'selection', choices: MOVE_STATES },
  ],
  groupable: [{ key: 'state', label: 'account_backend.field.state' }],
  sortable: [
    { key: 'accountingDate', label: 'account_backend.field.accountingDate' },
    { key: 'name', label: 'account_backend.field.name' },
  ],
  presets: statePresets('state', 'state', 'moveState', MOVE_STATES),
})

/** Both invoice lists differ only in which document types they can hold. */
const invoiceList = (key: string, types: readonly string[]) =>
  defineRowList({
    key,
    searchable: [{ key: 'name' }, { key: 'ref' }, { key: 'accountingDate' }, { key: 'partnerName' }],
    filterable: [
      ...documentFields,
      { key: 'moveType', label: 'account_backend.field.moveType', type: 'selection', choices: types },
      { key: 'state', label: 'account_backend.field.state', type: 'selection', choices: MOVE_STATES },
      {
        key: 'paymentState',
        label: 'account_backend.field.paymentState',
        type: 'selection',
        choices: PAYMENT_STATES,
      },
      { key: 'amountTotal', label: 'account_backend.field.amountTotal', type: 'number' },
    ],
    groupable: [
      { key: 'state', label: 'account_backend.field.state' },
      { key: 'paymentState', label: 'account_backend.field.paymentState' },
      { key: 'moveType', label: 'account_backend.field.moveType' },
    ],
    sortable: [
      { key: 'accountingDate', label: 'account_backend.field.accountingDate' },
      { key: 'name', label: 'account_backend.field.name' },
      { key: 'amountTotal', label: 'account_backend.field.amountTotal' },
    ],
    presets: [
      ...statePresets('state', 'state', 'moveState', MOVE_STATES),
      ...statePresets('paymentState', 'payment', 'paymentState', PAYMENT_STATES),
      ...statePresets('moveType', 'type', 'moveType', types),
    ],
  })

export const customerInvoiceListSearch = invoiceList('account.customer-invoices', CUSTOMER_INVOICE_TYPES)
export const vendorBillListSearch = invoiceList('account.vendor-bills', VENDOR_BILL_TYPES)

export const paymentListSearch = defineRowList({
  key: 'account.payments',
  searchable: [
    { key: 'name' },
    { key: 'accountingDate' },
    { key: 'memo' },
    { key: 'paymentReference' },
    { key: 'partnerName' },
  ],
  filterable: [
    { key: 'name', label: 'account_backend.field.name', type: 'text' },
    { key: 'accountingDate', label: 'account_backend.field.accountingDate', type: 'date' },
    { key: 'partnerName', label: 'account_backend.field.partnerId', type: 'text' },
    {
      key: 'paymentType',
      label: 'account_backend.field.paymentType',
      type: 'selection',
      choices: PAYMENT_TYPES,
    },
    {
      key: 'partnerType',
      label: 'account_backend.field.partnerType',
      type: 'selection',
      choices: PARTNER_TYPES,
    },
    { key: 'state', label: 'account_backend.field.state', type: 'selection', choices: PAYMENT_STATES },
    { key: 'amount', label: 'account_backend.field.paymentAmount', type: 'number' },
  ],
  groupable: [
    { key: 'paymentType', label: 'account_backend.field.paymentType' },
    { key: 'partnerType', label: 'account_backend.field.partnerType' },
    { key: 'state', label: 'account_backend.field.state' },
  ],
  sortable: [
    { key: 'accountingDate', label: 'account_backend.field.accountingDate' },
    { key: 'amount', label: 'account_backend.field.paymentAmount' },
  ],
  presets: [
    ...statePresets('paymentType', 'paymentType', 'paymentType', PAYMENT_TYPES),
    ...statePresets('partnerType', 'partnerType', 'partnerType', PARTNER_TYPES),
    ...statePresets('state', 'state', 'paymentState', PAYMENT_STATES),
  ],
})

/**
 * The two ledger reports.
 *
 * Which account, which partner and which dates are the report's parameters and
 * stay in its own form: they change what is read, not which of the read lines
 * to show. The bar owns everything the lines themselves can answer.
 */
const ledgerLines = (key: string) =>
  defineRowList({
    key,
    // A ledger line carries its move's number, reference and date as well as
    // its own label, so the route flattens them onto the row.
    searchable: [
      { key: 'name' },
      { key: 'moveName' },
      { key: 'ref' },
      { key: 'accountId' },
      { key: 'accountName' },
    ],
    filterable: [
      { key: 'name', label: 'account_backend.field.name', type: 'text' },
      { key: 'ref', label: 'account_backend.field.ref', type: 'text' },
      { key: 'accountingDate', label: 'account_backend.field.accountingDate', type: 'date' },
      { key: 'debit', label: 'account_backend.field.debit', type: 'number' },
      { key: 'credit', label: 'account_backend.field.credit', type: 'number' },
    ],
    // No grouping: a ledger's own screen prints running totals over one flat
    // run of lines, and a grouped table would report them per group without
    // the report's summary agreeing.
    sortable: [
      { key: 'accountingDate', label: 'account_backend.field.accountingDate' },
      { key: 'debit', label: 'account_backend.field.debit' },
      { key: 'credit', label: 'account_backend.field.credit' },
    ],
  })

export const generalLedgerLineSearch = ledgerLines('account.general-ledger')
export const partnerLedgerLineSearch = ledgerLines('account.partner-statement')

export const openingBatchListSearch = defineRowList({
  key: 'account.opening-balances',
  searchable: [{ key: 'accountingDate' }, { key: 'state' }, { key: 'sourceChecksum' }],
  filterable: [
    { key: 'accountingDate', label: 'account_backend.field.accountingDate', type: 'date' },
    {
      key: 'state',
      label: 'account_backend.field.state',
      type: 'selection',
      choices: OPENING_STATES,
    },
  ],
  groupable: [{ key: 'state', label: 'account_backend.field.state' }],
  sortable: [{ key: 'accountingDate', label: 'account_backend.field.accountingDate' }],
  presets: statePresets('state', 'state', 'wave1.state', OPENING_STATES),
})

export const closePeriodListSearch = defineRowList({
  key: 'account.period-closes',
  searchable: [{ key: 'periodKey' }, { key: 'dateFrom' }, { key: 'dateTo' }, { key: 'state' }],
  filterable: [
    { key: 'periodKey', label: 'account_backend.close.period', type: 'text' },
    { key: 'dateFrom', label: 'account_backend.field.dateFrom', type: 'date' },
    { key: 'dateTo', label: 'account_backend.field.dateTo', type: 'date' },
    { key: 'state', label: 'account_backend.field.state', type: 'selection', choices: CLOSE_STATES },
  ],
  groupable: [{ key: 'state', label: 'account_backend.field.state' }],
  sortable: [{ key: 'periodKey', label: 'account_backend.close.period' }],
  presets: statePresets('state', 'state', 'wave1.state', CLOSE_STATES),
})

/** Every accounting list, for the seam that validates what a reader sends back. */
export const accountListSpecs = [
  { spec: accountListSearch, path: '/admin/accounting/accounts' },
  { spec: journalListSearch, path: '/admin/accounting/journals' },
  { spec: taxListSearch, path: '/admin/accounting/taxes' },
  { spec: paymentTermListSearch, path: '/admin/accounting/terms' },
  { spec: journalEntryListSearch, path: '/admin/accounting/entries' },
  { spec: customerInvoiceListSearch, path: '/admin/accounting/customer-invoices' },
  { spec: vendorBillListSearch, path: '/admin/accounting/vendor-bills' },
  { spec: paymentListSearch, path: '/admin/accounting/payments' },
  { spec: generalLedgerLineSearch, path: '/admin/accounting/general-ledger' },
  { spec: partnerLedgerLineSearch, path: '/admin/accounting/partner-statement' },
  { spec: openingBatchListSearch, path: '/admin/accounting/opening-balances' },
  { spec: closePeriodListSearch, path: '/admin/accounting/period-closes' },
] as const
