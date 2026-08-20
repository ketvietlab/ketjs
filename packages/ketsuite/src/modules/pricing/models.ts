import type { ModelDef } from 'ketjs'

export const models: Record<string, ModelDef> = {
  Pricelist: {
    scope: 'company',
    fields: { id: 'id', name: 'text', currency: 'text', sequence: 'int', active: 'bool' },
  },
  PricelistItem: {
    scope: 'company',
    fields: {
      id: 'id',
      pricelistId: 'ref:pricing.Pricelist',
      dateStart: 'datetime?',
      dateEnd: 'datetime?',
      minQuantity: 'decimal',
      appliedOn: 'text',
      categoryId: 'ref:product.Category?',
      templateId: 'ref:product.Template?',
      productId: 'ref:product.Product?',
      base: 'text',
      basePricelistId: 'ref:pricing.Pricelist?',
      computePrice: 'text',
      fixedPrice: 'decimal',
      percentPrice: 'decimal',
      priceDiscount: 'decimal',
      priceRound: 'decimal',
      priceSurcharge: 'decimal',
      priceMinMargin: 'decimal',
      priceMaxMargin: 'decimal',
    },
    indexes: {
      pricelist_order: { fields: ['companyId', 'pricelistId', 'appliedOn', 'minQuantity'] },
    },
  },
}
