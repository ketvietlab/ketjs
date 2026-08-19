import type { RelationDef } from 'ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'purchase.Order': {
    lines: { hasMany: 'purchase.OrderLine', by: 'orderId' },
    vendor: { belongsTo: 'partner.Partner', by: 'partnerId' },
    pickingType: { belongsTo: 'stock.PickingType', by: 'pickingTypeId' },
  },
  'purchase.OrderLine': {
    order: { belongsTo: 'purchase.Order', by: 'orderId' },
    product: { belongsTo: 'product.Product', by: 'productId' },
    uom: { belongsTo: 'uom.Unit', by: 'productUomId' },
    tax: { belongsTo: 'account.Tax', by: 'taxId' },
  },
  'purchase.SupplierInfo': {
    vendor: { belongsTo: 'partner.Partner', by: 'partnerId' },
    template: { belongsTo: 'product.Template', by: 'productTemplateId' },
    product: { belongsTo: 'product.Product', by: 'productId' },
    uom: { belongsTo: 'uom.Unit', by: 'productUomId' },
  },
}
