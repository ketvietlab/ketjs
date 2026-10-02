// What the search-filter bar offers on the POS order list.
//
// The route used to ask `pos.listOrders` for one state; it now reads the shift's
// orders whole and narrows them in memory, so the bar's state presets accumulate
// the way they do on every other list and grouping by state or customer works.
import { defineRowList } from '../backend/row-list.ts'

const ORDER_STATES = ['draft', 'paid', 'done', 'cancel'] as const

export const posOrderListSearch = defineRowList({
  key: 'pos.orders',
  searchable: [{ key: 'posReference' }, { key: 'partnerName' }],
  filterable: [
    { key: 'posReference', label: 'pos_backend.field.receipt', type: 'text' },
    { key: 'partnerName', label: 'pos_backend.field.customer', type: 'text' },
    { key: 'state', label: 'pos_backend.field.state', type: 'selection', choices: ORDER_STATES },
    { key: 'amountTotal', label: 'pos_backend.field.total', type: 'number' },
  ],
  groupable: [
    { key: 'state', label: 'pos_backend.field.state' },
    { key: 'partnerName', label: 'pos_backend.field.customer' },
  ],
  sortable: [
    { key: 'posReference', label: 'pos_backend.field.receipt' },
    { key: 'amountTotal', label: 'pos_backend.field.total' },
  ],
  presets: ORDER_STATES.map((state) => ({
    key: state,
    label: `pos_backend.orderState.${state}`,
    group: 'state',
    match: (row: Record<string, unknown>) => row.state === state,
  })),
  defaultSort: [{ key: 'posReference', dir: 'asc' }],
})
