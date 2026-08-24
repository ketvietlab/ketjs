import type { RelationDef } from '@ketvietlab/ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'manufacturing.Bom': {
    product: { belongsTo: 'product.Product', by: 'productId' },
    lines: { hasMany: 'manufacturing.BomLine', by: 'bomId' },
    operations: { hasMany: 'manufacturing.Operation', by: 'bomId' },
    byproducts: { hasMany: 'manufacturing.Byproduct', by: 'bomId' },
  },
  'manufacturing.BomLine': {
    bom: { belongsTo: 'manufacturing.Bom', by: 'bomId' },
    product: { belongsTo: 'product.Product', by: 'productId' },
    operation: { belongsTo: 'manufacturing.Operation', by: 'operationId' },
  },
  'manufacturing.Byproduct': {
    bom: { belongsTo: 'manufacturing.Bom', by: 'bomId' },
    product: { belongsTo: 'product.Product', by: 'productId' },
  },
  'manufacturing.Operation': {
    bom: { belongsTo: 'manufacturing.Bom', by: 'bomId' },
    workCenter: { belongsTo: 'manufacturing.WorkCenter', by: 'workCenterId' },
  },
  'manufacturing.Production': {
    bom: { belongsTo: 'manufacturing.Bom', by: 'bomId' },
    product: { belongsTo: 'product.Product', by: 'productId' },
    moves: { hasMany: 'manufacturing.ProductionMove', by: 'productionId' },
    workOrders: { hasMany: 'manufacturing.WorkOrder', by: 'productionId' },
  },
  'manufacturing.ProductionMove': {
    production: { belongsTo: 'manufacturing.Production', by: 'productionId' },
    move: { belongsTo: 'stock.Move', by: 'moveId' },
  },
  'manufacturing.WorkOrder': {
    production: { belongsTo: 'manufacturing.Production', by: 'productionId' },
    operation: { belongsTo: 'manufacturing.Operation', by: 'operationId' },
    workCenter: { belongsTo: 'manufacturing.WorkCenter', by: 'workCenterId' },
  },
}
