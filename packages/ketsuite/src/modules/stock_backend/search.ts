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

const TRANSFER_STATES = [
  'draft',
  'waiting',
  'confirmed',
  'partially_available',
  'assigned',
  'done',
  'cancel',
] as const

export const transferListSearch = defineRowList({
  key: 'stock.transfers',
  searchable: [
    { key: 'name' },
    { key: 'operationType' },
    { key: 'source' },
    { key: 'destination' },
    { key: 'scheduledDate' },
    { key: 'state' },
  ],
  filterable: [
    { key: 'name', label: 'stock_backend.transfer.list.col.reference', type: 'text' },
    { key: 'operationType', label: 'stock_backend.transfer.list.col.operationType', type: 'text' },
    { key: 'source', label: 'stock_backend.transfer.list.col.source', type: 'text' },
    { key: 'destination', label: 'stock_backend.transfer.list.col.destination', type: 'text' },
    { key: 'scheduledDate', label: 'stock_backend.transfer.list.col.scheduledDate', type: 'text' },
    {
      key: 'state',
      label: 'stock_backend.transfer.list.col.state',
      type: 'selection',
      choices: TRANSFER_STATES,
    },
  ],
  groupable: [
    { key: 'state', label: 'stock_backend.transfer.list.col.state' },
    { key: 'operationType', label: 'stock_backend.transfer.list.col.operationType' },
    { key: 'source', label: 'stock_backend.transfer.list.col.source' },
    { key: 'destination', label: 'stock_backend.transfer.list.col.destination' },
  ],
  sortable: [
    { key: 'name', label: 'stock_backend.transfer.list.col.reference' },
    { key: 'scheduledDate', label: 'stock_backend.transfer.list.col.scheduledDate' },
    { key: 'state', label: 'stock_backend.transfer.list.col.state' },
  ],
  presets: [
    // What a warehouse team opens the list for: what is still to do, what is
    // waiting on stock, and what is finished.
    {
      key: 'ready',
      label: 'stock_backend.state.assigned',
      group: 'state',
      match: (row) => row.state === 'assigned' || row.state === 'reserved',
    },
    {
      key: 'waiting',
      label: 'stock_backend.state.waiting',
      group: 'state',
      match: (row) => ['waiting', 'confirmed', 'partially_available'].includes(String(row.state)),
    },
    {
      key: 'draft',
      label: 'stock_backend.state.draft',
      group: 'state',
      match: (row) => row.state === 'draft',
    },
    { key: 'done', label: 'stock_backend.state.done', group: 'state', match: (row) => row.state === 'done' },
    {
      key: 'cancelled',
      label: 'stock_backend.state.cancel',
      group: 'state',
      match: (row) => row.state === 'cancel',
    },
  ],
  defaultSort: [{ key: 'scheduledDate', dir: 'asc' }],
})

const LOCATION_USAGES = [
  'internal',
  'view',
  'supplier',
  'customer',
  'inventory',
  'production',
  'transit',
] as const

export const locationListSearch = defineRowList({
  key: 'stock.locations',
  searchable: [{ key: 'completeName' }, { key: 'usage' }, { key: 'warehouse' }],
  filterable: [
    { key: 'completeName', label: 'stock_backend.location.col.location', type: 'text' },
    {
      key: 'usage',
      label: 'stock_backend.location.col.usage',
      type: 'selection',
      choices: LOCATION_USAGES,
    },
    { key: 'warehouse', label: 'stock_backend.location.col.warehouse', type: 'text' },
  ],
  groupable: [
    { key: 'usage', label: 'stock_backend.location.col.usage' },
    { key: 'warehouse', label: 'stock_backend.location.col.warehouse' },
  ],
  sortable: [
    { key: 'completeName', label: 'stock_backend.location.col.location' },
    { key: 'usage', label: 'stock_backend.location.col.usage' },
  ],
  presets: [
    // Internal and transit locations are the ones that hold company stock; the
    // rest are counterparties and accounting destinations.
    {
      key: 'stockHolding',
      label: 'stock_backend.location.filter.stockHolding',
      group: 'usage',
      match: (row) => ['internal', 'transit'].includes(String(row.usage)),
    },
    {
      key: 'counterparty',
      label: 'stock_backend.location.filter.counterparty',
      group: 'usage',
      match: (row) => ['supplier', 'customer'].includes(String(row.usage)),
    },
    {
      key: 'virtual',
      label: 'stock_backend.location.filter.virtual',
      group: 'usage',
      match: (row) => ['view', 'inventory', 'production'].includes(String(row.usage)),
    },
  ],
  defaultSort: [{ key: 'completeName', dir: 'asc' }],
})

const PICKING_CODES = ['incoming', 'outgoing', 'internal'] as const
const BACKORDER_POLICIES = ['ask', 'always', 'never'] as const

export const pickingTypeListSearch = defineRowList({
  key: 'stock.picking-types',
  searchable: [
    { key: 'name' },
    { key: 'code' },
    { key: 'warehouse' },
    { key: 'source' },
    { key: 'destination' },
  ],
  filterable: [
    { key: 'name', label: 'stock_backend.pickingType.col.name', type: 'text' },
    { key: 'code', label: 'stock_backend.pickingType.col.code', type: 'selection', choices: PICKING_CODES },
    { key: 'warehouse', label: 'stock_backend.pickingType.col.warehouse', type: 'text' },
    {
      key: 'createBackorder',
      label: 'stock_backend.pickingType.col.backorder',
      type: 'selection',
      choices: BACKORDER_POLICIES,
    },
  ],
  groupable: [
    { key: 'code', label: 'stock_backend.pickingType.col.code' },
    { key: 'warehouse', label: 'stock_backend.pickingType.col.warehouse' },
    { key: 'createBackorder', label: 'stock_backend.pickingType.col.backorder' },
  ],
  sortable: [
    { key: 'name', label: 'stock_backend.pickingType.col.name' },
    { key: 'code', label: 'stock_backend.pickingType.col.code' },
  ],
  presets: PICKING_CODES.map((code) => ({
    key: code,
    label: `stock_backend.pickingType.${code}`,
    group: 'code',
    match: (row: Record<string, unknown>) => row.code === code,
  })),
  defaultSort: [{ key: 'name', dir: 'asc' }],
})

export const lotListSearch = defineRowList({
  key: 'stock.lots',
  searchable: [{ key: 'name' }, { key: 'product' }, { key: 'reference' }],
  filterable: [
    { key: 'name', label: 'stock_backend.lot.list.col.name', type: 'text' },
    { key: 'product', label: 'stock_backend.lot.list.col.product', type: 'text' },
    { key: 'reference', label: 'stock_backend.lot.list.col.reference', type: 'text' },
    { key: 'onHandValue', label: 'stock_backend.lot.list.col.onHand', type: 'number' },
    // Naming `active` is what offers the reader archived lots at all.
    { key: 'active', label: 'stock_backend.lot.list.col.status', type: 'boolean' },
  ],
  groupable: [{ key: 'product', label: 'stock_backend.lot.list.col.product' }],
  sortable: [
    { key: 'name', label: 'stock_backend.lot.list.col.name' },
    { key: 'product', label: 'stock_backend.lot.list.col.product' },
    { key: 'onHandValue', label: 'stock_backend.lot.list.col.onHand' },
  ],
  presets: [
    {
      key: 'inStock',
      label: 'stock_backend.lot.filter.inStock',
      group: 'onHand',
      match: (row) => Number(row.onHandValue ?? 0) > 0,
    },
    {
      key: 'empty',
      label: 'stock_backend.lot.filter.empty',
      group: 'onHand',
      match: (row) => Number(row.onHandValue ?? 0) <= 0,
    },
  ],
  defaultSort: [{ key: 'name', dir: 'asc' }],
})

export const stockRouteListSearch = defineRowList({
  key: 'stock.routes',
  searchable: [{ key: 'name' }],
  filterable: [
    { key: 'name', label: 'stock_backend.stockRoute.list.col.name', type: 'text' },
    { key: 'sequence', label: 'stock_backend.stockRoute.list.col.sequence', type: 'number' },
    { key: 'ruleCount', label: 'stock_backend.stockRoute.list.col.rules', type: 'number' },
  ],
  sortable: [
    { key: 'sequence', label: 'stock_backend.stockRoute.list.col.sequence' },
    { key: 'name', label: 'stock_backend.stockRoute.list.col.name' },
  ],
  presets: [
    {
      key: 'configured',
      label: 'stock_backend.stockRoute.filter.configured',
      group: 'rules',
      match: (row) => Number(row.ruleCount ?? 0) > 0,
    },
    {
      key: 'unconfigured',
      label: 'stock_backend.stockRoute.filter.unconfigured',
      group: 'rules',
      match: (row) => Number(row.ruleCount ?? 0) === 0,
    },
  ],
  defaultSort: [{ key: 'sequence', dir: 'asc' }],
})

const TRIGGERS = ['auto', 'manual'] as const

export const replenishmentListSearch = defineRowList({
  key: 'stock.replenishment',
  searchable: [
    { key: 'product' },
    { key: 'warehouse' },
    { key: 'location' },
    { key: 'triggerLabel' },
    { key: 'replenishmentUom' },
  ],
  filterable: [
    { key: 'product', label: 'stock_backend.replenishment.col.product', type: 'text' },
    { key: 'warehouse', label: 'stock_backend.field.warehouse', type: 'text' },
    { key: 'location', label: 'stock_backend.field.location', type: 'text' },
    { key: 'trigger', label: 'stock_backend.field.trigger', type: 'selection', choices: TRIGGERS },
    { key: 'minQuantity', label: 'stock_backend.field.minQuantity', type: 'number' },
    { key: 'maxQuantity', label: 'stock_backend.field.maxQuantity', type: 'number' },
    { key: 'toOrder', label: 'stock_backend.replenishment.col.toOrder', type: 'number' },
  ],
  groupable: [
    { key: 'warehouse', label: 'stock_backend.field.warehouse' },
    { key: 'trigger', label: 'stock_backend.field.trigger' },
    { key: 'location', label: 'stock_backend.field.location' },
  ],
  sortable: [
    { key: 'product', label: 'stock_backend.replenishment.col.product' },
    { key: 'toOrder', label: 'stock_backend.replenishment.col.toOrder' },
  ],
  presets: [
    // A replenishment list is read to find what must be ordered now.
    {
      key: 'toOrder',
      label: 'stock_backend.replenishment.filter.toOrder',
      group: 'order',
      match: (row) => Number(row.toOrder ?? 0) > 0,
    },
    {
      key: 'covered',
      label: 'stock_backend.replenishment.filter.covered',
      group: 'order',
      match: (row) => Number(row.toOrder ?? 0) <= 0,
    },
    ...TRIGGERS.map((trigger) => ({
      key: trigger,
      label: `stock_backend.trigger.${trigger}`,
      group: 'trigger',
      match: (row: Record<string, unknown>) => row.trigger === trigger,
    })),
  ],
  defaultSort: [{ key: 'product', dir: 'asc' }],
})
