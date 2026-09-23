// What the search-filter bar offers on the manufacturing lists.
//
// All three read a bounded collection the route already holds, so each spec
// covers exactly the columns its table renders. Production orders are the one
// list read by status, and so the one list with presets over a state.
import { defineRowList } from '../backend/row-list.ts'

const PRODUCTION_STATES = ['draft', 'confirmed', 'in_progress', 'to_close', 'done', 'cancelled'] as const

export const productionListSearch = defineRowList({
  key: 'manufacturing.orders',
  searchable: [{ key: 'name' }, { key: 'product' }],
  filterable: [
    { key: 'name', label: 'manufacturing_backend.field.name', type: 'text' },
    { key: 'product', label: 'manufacturing_backend.field.product', type: 'text' },
    { key: 'quantity', label: 'manufacturing_backend.field.quantity', type: 'number' },
    {
      key: 'state',
      label: 'manufacturing_backend.field.state',
      type: 'selection',
      choices: PRODUCTION_STATES,
    },
  ],
  groupable: [
    { key: 'state', label: 'manufacturing_backend.field.state' },
    { key: 'product', label: 'manufacturing_backend.field.product' },
  ],
  sortable: [
    { key: 'name', label: 'manufacturing_backend.field.name' },
    { key: 'product', label: 'manufacturing_backend.field.product' },
  ],
  presets: PRODUCTION_STATES.map((state) => ({
    key: state,
    label: `manufacturing_backend.state.${state}`,
    group: 'state',
    match: (row: Record<string, unknown>) => row.state === state,
  })),
  defaultSort: [{ key: 'name', dir: 'asc' }],
})

export const bomListSearch = defineRowList({
  key: 'manufacturing.boms',
  searchable: [{ key: 'code' }, { key: 'product' }],
  filterable: [
    { key: 'code', label: 'manufacturing_backend.field.code', type: 'text' },
    { key: 'product', label: 'manufacturing_backend.field.product', type: 'text' },
    { key: 'quantity', label: 'manufacturing_backend.field.quantity', type: 'number' },
  ],
  groupable: [{ key: 'product', label: 'manufacturing_backend.field.product' }],
  sortable: [
    { key: 'code', label: 'manufacturing_backend.field.code' },
    { key: 'product', label: 'manufacturing_backend.field.product' },
  ],
  defaultSort: [{ key: 'code', dir: 'asc' }],
})

export const workCenterListSearch = defineRowList({
  key: 'manufacturing.work-centers',
  searchable: [{ key: 'name' }, { key: 'code' }],
  filterable: [
    { key: 'name', label: 'manufacturing_backend.field.name', type: 'text' },
    { key: 'code', label: 'manufacturing_backend.field.code', type: 'text' },
    { key: 'capacity', label: 'manufacturing_backend.field.capacity', type: 'number' },
    { key: 'timeEfficiency', label: 'manufacturing_backend.field.efficiency', type: 'number' },
    { key: 'costPerHour', label: 'manufacturing_backend.field.cost', type: 'number' },
    { key: 'active', label: 'manufacturing_backend.field.state', type: 'boolean' },
  ],
  groupable: [{ key: 'active', label: 'manufacturing_backend.field.state' }],
  sortable: [
    { key: 'name', label: 'manufacturing_backend.field.name' },
    { key: 'capacity', label: 'manufacturing_backend.field.capacity' },
    { key: 'costPerHour', label: 'manufacturing_backend.field.cost' },
  ],
  // `active` being filterable is what gives the bar its archived toggle, and an
  // archived work center is hidden until the reader asks for it — so a preset
  // over the same field would only ever repeat what the toggle already decides.
  defaultSort: [{ key: 'name', dir: 'asc' }],
})
