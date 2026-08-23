import type { RelationDef } from '@ketvietlab/ketjs'

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
    // Declared for what hasMany brings with it: the framework auto-indexes the
    // foreign side, and `saleLineId` on both tables was queried by every
    // delivery sync and every order detail with no index behind it. `extend`
    // can add a field but not an index; the relation can.
    moves: { hasMany: 'stock.Move', by: 'saleLineId' },
    invoiceLines: { hasMany: 'account.MoveLine', by: 'saleLineId' },
    product: { belongsTo: 'product.Product', by: 'productId' },
    uom: { belongsTo: 'uom.Unit', by: 'productUomId' },
    tax: { belongsTo: 'account.Tax', by: 'taxId' },
  },
}
