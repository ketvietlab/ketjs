import type { RelationDef } from 'ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'stock.Location': {
    parent: { belongsTo: 'stock.Location', by: 'parentId' },
    children: { hasMany: 'stock.Location', by: 'parentId' },
    warehouse: { belongsTo: 'stock.Warehouse', by: 'warehouseId' },
  },
  'stock.Picking': {
    pickingType: { belongsTo: 'stock.PickingType', by: 'pickingTypeId' },
    moves: { hasMany: 'stock.Move', by: 'pickingId' },
    backorders: { hasMany: 'stock.Picking', by: 'backorderId' },
  },
  'stock.Move': {
    picking: { belongsTo: 'stock.Picking', by: 'pickingId' },
    product: { belongsTo: 'product.Product', by: 'productId' },
    moveLines: { hasMany: 'stock.MoveLine', by: 'moveId' },
  },
  'stock.MoveLine': {
    move: { belongsTo: 'stock.Move', by: 'moveId' },
    lot: { belongsTo: 'stock.Lot', by: 'lotId' },
  },
  'stock.Quant': {
    product: { belongsTo: 'product.Product', by: 'productId' },
    location: { belongsTo: 'stock.Location', by: 'locationId' },
    lot: { belongsTo: 'stock.Lot', by: 'lotId' },
  },
  'stock.Rule': { route: { belongsTo: 'stock.Route', by: 'routeId' } },
  'stock.Route': { rules: { hasMany: 'stock.Rule', by: 'routeId' } },
  'stock.MoveLink': {
    origin: { belongsTo: 'stock.Move', by: 'originMoveId' },
    destination: { belongsTo: 'stock.Move', by: 'destinationMoveId' },
  },
}
