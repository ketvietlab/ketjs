import type { RelationDef } from '@ketvietlab/ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'pos.Config': {
    warehouse: { belongsTo: 'stock.Warehouse', by: 'warehouseId' },
    pricelist: { belongsTo: 'pricing.Pricelist', by: 'pricelistId' },
    sessions: { hasMany: 'pos.Session', by: 'configId' },
    methods: { hasMany: 'pos.ConfigPaymentMethod', by: 'configId' },
  },
  'pos.PaymentMethod': {
    journal: { belongsTo: 'account.Journal', by: 'journalId' },
    configs: { hasMany: 'pos.ConfigPaymentMethod', by: 'paymentMethodId' },
  },
  'pos.ConfigPaymentMethod': {
    config: { belongsTo: 'pos.Config', by: 'configId' },
    paymentMethod: { belongsTo: 'pos.PaymentMethod', by: 'paymentMethodId' },
  },
  'pos.Session': {
    config: { belongsTo: 'pos.Config', by: 'configId' },
    orders: { hasMany: 'pos.Order', by: 'sessionId' },
  },
  'pos.Order': {
    session: { belongsTo: 'pos.Session', by: 'sessionId' },
    lines: { hasMany: 'pos.OrderLine', by: 'orderId' },
    payments: { hasMany: 'pos.Payment', by: 'orderId' },
    customer: { belongsTo: 'partner.Partner', by: 'partnerId' },
  },
  'pos.OrderLine': {
    order: { belongsTo: 'pos.Order', by: 'orderId' },
    product: { belongsTo: 'product.Product', by: 'productId' },
    uom: { belongsTo: 'uom.Unit', by: 'productUomId' },
    tax: { belongsTo: 'account.Tax', by: 'taxId' },
  },
  'pos.Payment': {
    order: { belongsTo: 'pos.Order', by: 'orderId' },
    paymentMethod: { belongsTo: 'pos.PaymentMethod', by: 'paymentMethodId' },
  },
}
