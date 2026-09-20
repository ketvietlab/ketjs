// What the search-filter bar offers on each stock list.
//
// These lists read a complete, authorised collection and narrow it in memory,
// so a preset is a predicate rather than an expression — see `row-list.ts`. A
// spec describes only the columns its list actually shows, because a filter on
// a column the reader cannot see explains nothing about the rows that remain.
//
// Labels are message keys: the bar resolves one when the catalogue has it and
// otherwise shows the text as written.
import { defineRowList } from '../backend/row-list.ts'

const RECEPTION_STEPS = ['one_step', 'two_steps', 'three_steps'] as const
const DELIVERY_STEPS = ['ship_only', 'pick_ship', 'pick_pack_ship'] as const

export const warehouseListSearch = defineRowList({
  key: 'stock.warehouses',
  searchable: [{ key: 'name' }, { key: 'code' }],
  filterable: [
    { key: 'name', label: 'stock_backend.warehouse.col.name', type: 'text' },
    { key: 'code', label: 'stock_backend.warehouse.col.code', type: 'text' },
    {
      key: 'receptionSteps',
      label: 'stock_backend.warehouse.col.reception',
      type: 'selection',
      choices: RECEPTION_STEPS,
    },
    {
      key: 'deliverySteps',
      label: 'stock_backend.warehouse.col.delivery',
      type: 'selection',
      choices: DELIVERY_STEPS,
    },
  ],
  groupable: [
    { key: 'receptionSteps', label: 'stock_backend.warehouse.col.reception' },
    { key: 'deliverySteps', label: 'stock_backend.warehouse.col.delivery' },
  ],
  sortable: [
    { key: 'name', label: 'stock_backend.warehouse.col.name' },
    { key: 'code', label: 'stock_backend.warehouse.col.code' },
  ],
  presets: [
    // The step counts a warehouse is configured for, which is the question the
    // list is opened to answer far more often than any single warehouse's name.
    {
      key: 'directReception',
      label: 'stock_backend.receptionSteps.one_step',
      group: 'reception',
      match: (row) => row.receptionSteps === 'one_step',
    },
    {
      key: 'stagedReception',
      label: 'stock_backend.warehouse.filter.stagedReception',
      group: 'reception',
      match: (row) => row.receptionSteps !== 'one_step',
    },
    {
      key: 'directDelivery',
      label: 'stock_backend.deliverySteps.ship_only',
      group: 'delivery',
      match: (row) => row.deliverySteps === 'ship_only',
    },
    {
      key: 'stagedDelivery',
      label: 'stock_backend.warehouse.filter.stagedDelivery',
      group: 'delivery',
      match: (row) => row.deliverySteps !== 'ship_only',
    },
  ],
  defaultSort: [{ key: 'name', dir: 'asc' }],
})
