// What the search-filter bar offers on the pricelist list.
//
// The route reads every pricelist and narrows it in memory, so the spec covers
// exactly the columns the table renders. `state` is a computed label rather than
// the stored `active` flag, so it stays a preset group of its own instead of
// borrowing the framework's archived toggle.
import { defineRowList } from '../backend/row-list.ts'

const PRICELIST_STATES = ['active', 'archived'] as const

export const pricelistListSearch = defineRowList({
  key: 'pricing.pricelists',
  searchable: [{ key: 'name' }, { key: 'currency' }, { key: 'sequence' }],
  filterable: [
    { key: 'name', label: 'pricing_backend.col.name', type: 'text' },
    { key: 'currency', label: 'pricing_backend.col.currency', type: 'text' },
    { key: 'state', label: 'pricing_backend.col.state', type: 'selection', choices: PRICELIST_STATES },
    { key: 'sequence', label: 'pricing_backend.col.sequence', type: 'number' },
  ],
  groupable: [
    { key: 'state', label: 'pricing_backend.col.state' },
    { key: 'currency', label: 'pricing_backend.col.currency' },
  ],
  sortable: [
    { key: 'name', label: 'pricing_backend.col.name' },
    { key: 'sequence', label: 'pricing_backend.col.sequence' },
  ],
  presets: PRICELIST_STATES.map((state) => ({
    key: state,
    label: `pricing_backend.state.${state}`,
    group: 'state',
    match: (row: Record<string, unknown>) => row.state === state,
  })),
  defaultSort: [{ key: 'sequence', dir: 'asc' }],
})
