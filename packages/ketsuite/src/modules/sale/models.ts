import type { ModelDef } from 'ketjs'

export const models: Record<string, ModelDef> = {
  Sequence: { scope: 'company', fields: { id: 'id', nextNumber: 'int' } },
  Order: {
    scope: 'company',
    fields: {
      id: 'id', name: 'text', partnerId: 'ref:partner.Partner', clientOrderRef: 'text?',
      state: 'text', locked: 'bool', dateOrder: 'datetime', validityDate: 'datetime?',
      warehouseId: 'ref:stock.Warehouse', pricelistId: 'ref:pricing.Pricelist?',
      paymentTermId: 'ref:account.PaymentTerm?', currency: 'text', invoiceStatus: 'text',
      amountUntaxed: 'decimal', amountTax: 'decimal', amountTotal: 'decimal', notes: 'text?',
    },
    indexes: { company_name: { fields: ['companyId', 'name'], unique: true } },
  },
  OrderLine: {
    scope: 'company',
    fields: {
      id: 'id', orderId: 'ref:sale.Order', productId: 'ref:product.Product', name: 'text',
      productUomQty: 'decimal', productUomId: 'ref:uom.Unit', priceUnit: 'decimal', discount: 'decimal',
      taxId: 'ref:account.Tax?', qtyDelivered: 'decimal', qtyInvoiced: 'decimal',
      priceSubtotal: 'decimal', sequence: 'int',
    },
    indexes: { order_sequence: { fields: ['companyId', 'orderId', 'sequence'] } },
  },
}
