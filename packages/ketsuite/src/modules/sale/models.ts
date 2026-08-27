import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  Sequence: { scope: 'company', fields: { id: 'id', nextNumber: 'int' } },
  Order: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      partnerId: 'ref:partner.Partner',
      clientOrderRef: 'text?',
      state: 'text',
      locked: 'bool',
      dateOrder: 'datetime',
      validityDate: 'datetime?',
      warehouseId: 'ref:stock.Warehouse',
      pricelistId: 'ref:pricing.Pricelist?',
      paymentTermId: 'ref:account.PaymentTerm?',
      currency: 'text',
      invoiceStatus: 'text',
      amountUntaxed: 'decimal',
      amountTax: 'decimal',
      amountTotal: 'decimal',
      notes: 'text?',
      revision: 'int?',
    },
    indexes: {
      company_name: { fields: ['companyId', 'name'], unique: true },
      // What the two list screens actually ask: this state (or these states),
      // newest first. Without it, a tenant with an imported history scans the
      // whole table for every page of quotations.
      state_date: { fields: ['companyId', 'state', 'dateOrder'] },
      partner: { fields: ['companyId', 'partnerId'] },
      invoice_status: { fields: ['companyId', 'invoiceStatus'] },
    },
  },
  OrderLine: {
    scope: 'company',
    fields: {
      id: 'id',
      orderId: 'ref:sale.Order',
      productId: 'ref:product.Product',
      name: 'text',
      productUomQty: 'decimal',
      productUomId: 'ref:uom.Unit',
      priceUnit: 'decimal',
      discount: 'decimal',
      taxId: 'ref:account.Tax?',
      taxIds: 'json?',
      taxEvidence: 'json?',
      quoteRevision: 'text?',
      qtyDelivered: 'decimal',
      qtyInvoiced: 'decimal',
      priceSubtotal: 'decimal',
      // Optional only for rows created before Wave 1B; every new line stores it.
      priceSubtotalIncl: 'decimal?',
      sequence: 'int',
    },
    indexes: { order_sequence: { fields: ['companyId', 'orderId', 'sequence'] } },
  },
}
