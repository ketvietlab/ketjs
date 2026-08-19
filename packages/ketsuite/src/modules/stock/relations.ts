import type { RelationDef } from 'ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'stock.Location': {
    parent: { belongsTo: 'stock.Location', by: 'parentId' },
    children: { hasMany: 'stock.Location', by: 'parentId' },
    warehouse: { belongsTo: 'stock.Warehouse', by: 'warehouseId' },
    quants: { hasMany: 'stock.Quant', by: 'locationId' },
  },
  'stock.Warehouse': {
    locations: { hasMany: 'stock.Location', by: 'warehouseId' },
  },
  'stock.Quant': {
    location: { belongsTo: 'stock.Location', by: 'locationId' },
    product: { belongsTo: 'product.Product', by: 'productId' },
  },
  'stock.Move': {
    source: { belongsTo: 'stock.Location', by: 'sourceId' },
    dest: { belongsTo: 'stock.Location', by: 'destId' },
    product: { belongsTo: 'product.Product', by: 'productId' },
  },
}
