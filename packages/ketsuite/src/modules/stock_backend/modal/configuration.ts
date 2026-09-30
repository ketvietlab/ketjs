/** Shared declaration for the small stock configuration records, not stock movements. */
export type ConfigurationField = {
  name: string
  label: string
  required?: boolean
  defaultValue?: string
  choices?: readonly string[]
  choiceLabel?: string
  lookup?: 'locations' | 'warehouses' | 'products' | 'units' | 'routes' | 'pickingTypes'
  type?: 'text' | 'textarea' | 'number' | 'decimal'
}
export type Configuration = {
  kind: string
  title: string
  read: string
  save: string
  fields: ConfigurationField[]
}
export const stockConfigurations: Record<string, Configuration> = {
  warehouse: {
    kind: 'stock.warehouse',
    title: 'warehouse.create.title',
    read: 'stock.listWarehouses',
    save: 'stock.saveWarehouse',
    fields: [
      { name: 'name', label: 'warehouse.field.name', required: true },
      { name: 'code', label: 'warehouse.field.code', required: true },
      {
        name: 'receptionSteps',
        label: 'field.receptionSteps',
        defaultValue: 'one_step',
        choices: ['one_step', 'two_steps', 'three_steps'],
        choiceLabel: 'receptionSteps',
      },
      {
        name: 'deliverySteps',
        label: 'field.deliverySteps',
        defaultValue: 'ship_only',
        choices: ['ship_only', 'pick_ship', 'pick_pack_ship'],
        choiceLabel: 'deliverySteps',
      },
    ],
  },
  location: {
    kind: 'stock.location',
    title: 'location.create.title',
    read: 'stock.listLocations',
    save: 'stock.saveLocation',
    fields: [
      { name: 'name', label: 'location.field.name', required: true },
      {
        name: 'usage',
        label: 'field.usage',
        required: true,
        defaultValue: 'internal',
        choices: ['internal', 'view', 'supplier', 'customer', 'inventory', 'production', 'transit'],
        choiceLabel: 'usage',
      },
      { name: 'parentId', label: 'field.parentLocation', lookup: 'locations' },
      { name: 'warehouseId', label: 'field.warehouse', lookup: 'warehouses' },
    ],
  },
  'picking-type': {
    kind: 'stock.pickingType',
    title: 'pickingType.create.title',
    read: 'stock.listPickingTypes',
    save: 'stock.savePickingType',
    fields: [
      { name: 'name', label: 'pickingType.field.name', required: true },
      {
        name: 'code',
        label: 'pickingType.field.code',
        required: true,
        defaultValue: 'internal',
        choices: ['incoming', 'outgoing', 'internal'],
        choiceLabel: 'pickingType',
      },
      { name: 'warehouseId', label: 'field.warehouse', lookup: 'warehouses' },
      { name: 'defaultLocationSrcId', label: 'field.sourceLocation', lookup: 'locations' },
      { name: 'defaultLocationDestId', label: 'field.destinationLocation', lookup: 'locations' },
      {
        name: 'createBackorder',
        label: 'field.backorder',
        defaultValue: 'ask',
        choices: ['ask', 'always', 'never'],
        choiceLabel: 'backorder',
      },
    ],
  },
  lot: {
    kind: 'stock.lot',
    title: 'lot.create.title',
    read: 'stock.listLots',
    save: 'stock.saveLot',
    fields: [
      { name: 'productId', label: 'lot.field.product', lookup: 'products', required: true },
      { name: 'name', label: 'field.lotSerial', required: true },
      { name: 'ref', label: 'lot.field.reference' },
      { name: 'note', label: 'lot.field.description', type: 'textarea' },
    ],
  },
  route: {
    kind: 'stock.route',
    title: 'stockRoute.create.title',
    read: 'stock.listRoutes',
    save: 'stock.saveRoute',
    fields: [
      { name: 'name', label: 'stockRoute.field.name', required: true },
      { name: 'sequence', label: 'field.sequence', type: 'number', defaultValue: '10' },
    ],
  },
  replenishment: {
    kind: 'stock.replenishment',
    title: 'replenishment.create.title',
    read: 'stock.listOrderpoints',
    save: 'stock.saveOrderpoint',
    fields: [
      { name: 'productId', label: 'field.product', lookup: 'products', required: true },
      { name: 'warehouseId', label: 'field.warehouse', lookup: 'warehouses', required: true },
      { name: 'locationId', label: 'field.location', lookup: 'locations', required: true },
      {
        name: 'trigger',
        label: 'field.trigger',
        choices: ['auto', 'manual'],
        choiceLabel: 'trigger',
        defaultValue: 'manual',
      },
      { name: 'minQuantity', label: 'field.minQuantity', type: 'decimal', defaultValue: '0', required: true },
      { name: 'maxQuantity', label: 'field.maxQuantity', type: 'decimal', defaultValue: '0', required: true },
      { name: 'replenishmentUomId', label: 'field.replenishmentUom', lookup: 'units' },
      { name: 'routeId', label: 'field.route', lookup: 'routes' },
    ],
  },
}
