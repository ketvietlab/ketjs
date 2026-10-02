// What the search-filter bar offers on the purchasing lists.
//
// Requests for quotation and confirmed orders are two windows on one
// collection, so they share the columns and differ only in the presets each
// window can be in. The vendor price list is the third, and is read by vendor
// and by product, which is what it offers to group by.
import { defineRowList } from '../backend/row-list.ts'

const RFQ_STATES = ['draft', 'sent', 'to approve'] as const
const INVOICE_STATUSES = ['no', 'to invoice', 'invoiced'] as const

const orderFields = {
  searchable: [{ key: 'name' }, { key: 'partnerName' }],
  filterable: [
    { key: 'name', label: 'purchase_backend.field.name', type: 'text' as const },
    { key: 'partnerName', label: 'purchase_backend.field.vendor', type: 'text' as const },
    { key: 'dateOrder', label: 'purchase_backend.field.dateOrder', type: 'datetime' as const },
    { key: 'amountTotal', label: 'purchase_backend.field.amountTotal', type: 'number' as const },
  ],
  sortable: [
    { key: 'name', label: 'purchase_backend.field.name' },
    { key: 'dateOrder', label: 'purchase_backend.field.dateOrder' },
    { key: 'amountTotal', label: 'purchase_backend.field.amountTotal' },
  ],
  defaultSort: [{ key: 'dateOrder', dir: 'desc' as const }],
}

export const rfqListSearch = defineRowList({
  key: 'purchase.rfqs',
  ...orderFields,
  filterable: [
    ...orderFields.filterable,
    { key: 'state', label: 'purchase_backend.field.state', type: 'selection', choices: RFQ_STATES },
  ],
  groupable: [
    { key: 'state', label: 'purchase_backend.field.state' },
    { key: 'partnerName', label: 'purchase_backend.field.vendor' },
    { key: 'dateOrder', label: 'purchase_backend.field.dateOrder', intervals: ['day', 'week', 'month'] },
  ],
  presets: RFQ_STATES.map((state) => ({
    key: state.replace(' ', '-'),
    label: `purchase_backend.state.${state}`,
    group: 'state',
    match: (row: Record<string, unknown>) => row.state === state,
  })),
})

export const purchaseOrderListSearch = defineRowList({
  key: 'purchase.orders',
  ...orderFields,
  filterable: [
    ...orderFields.filterable,
    {
      key: 'invoiceStatus',
      label: 'purchase_backend.field.invoiceStatus',
      type: 'selection',
      choices: INVOICE_STATUSES,
    },
  ],
  groupable: [
    { key: 'invoiceStatus', label: 'purchase_backend.field.invoiceStatus' },
    { key: 'partnerName', label: 'purchase_backend.field.vendor' },
    { key: 'dateOrder', label: 'purchase_backend.field.dateOrder', intervals: ['day', 'week', 'month'] },
  ],
  presets: INVOICE_STATUSES.map((status) => ({
    key: status.replace(' ', '-'),
    label: `purchase_backend.invoiceStatus.${status}`,
    group: 'invoiceStatus',
    match: (row: Record<string, unknown>) => row.invoiceStatus === status,
  })),
})

export const vendorPricelistListSearch = defineRowList({
  key: 'purchase.vendor-pricelists',
  searchable: [{ key: 'partnerName' }, { key: 'productNameDisplay' }],
  filterable: [
    { key: 'partnerName', label: 'purchase_backend.field.vendor', type: 'text' },
    { key: 'productNameDisplay', label: 'purchase_backend.field.product', type: 'text' },
    { key: 'minQty', label: 'purchase_backend.field.minQty', type: 'number' },
    { key: 'price', label: 'purchase_backend.field.priceUnit', type: 'number' },
    { key: 'discount', label: 'purchase_backend.field.discount', type: 'number' },
    { key: 'delay', label: 'purchase_backend.field.delay', type: 'number' },
  ],
  groupable: [
    { key: 'partnerName', label: 'purchase_backend.field.vendor' },
    { key: 'productNameDisplay', label: 'purchase_backend.field.product' },
  ],
  sortable: [
    { key: 'partnerName', label: 'purchase_backend.field.vendor' },
    { key: 'price', label: 'purchase_backend.field.priceUnit' },
    { key: 'delay', label: 'purchase_backend.field.delay' },
  ],
  presets: [
    {
      // A line that only applies above a quantity is a different offer from one
      // that always applies, and that is the distinction buyers read for.
      key: 'tiered',
      label: 'purchase_backend.filter.tiered',
      group: 'minQty',
      match: (row) => Number(row.minQty ?? 0) > 0,
    },
    {
      key: 'discounted',
      label: 'purchase_backend.filter.discounted',
      group: 'discount',
      match: (row) => Number(row.discount ?? 0) > 0,
    },
  ],
  defaultSort: [{ key: 'partnerName', dir: 'asc' }],
})
