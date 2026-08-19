import type { RelationDef } from 'ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'sale.Order': {
    lines: { hasMany: 'sale.OrderLine', by: 'orderId' },
    customer: { belongsTo: 'partner.Partner', by: 'partnerId' },
    warehouse: { belongsTo: 'stock.Warehouse', by: 'warehouseId' },
    pricelist: { belongsTo: 'pricing.Pricelist', by: 'pricelistId' },
    paymentTerm: { belongsTo: 'account.PaymentTerm', by: 'paymentTermId' },
  },
  'sale.OrderLine': {
    order: { belongsTo: 'sale.Order', by: 'orderId' },
    product: { belongsTo: 'product.Product', by: 'productId' },
    uom: { belongsTo: 'uom.Unit', by: 'productUomId' },
    tax: { belongsTo: 'account.Tax', by: 'taxId' },
  },
}
