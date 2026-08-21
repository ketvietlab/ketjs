import type { RelationDef } from '@ketvietlab/ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'pricing.Pricelist': { items: { hasMany: 'pricing.PricelistItem', by: 'pricelistId' } },
  'pricing.PricelistItem': {
    pricelist: { belongsTo: 'pricing.Pricelist', by: 'pricelistId' },
    basePricelist: { belongsTo: 'pricing.Pricelist', by: 'basePricelistId' },
    category: { belongsTo: 'product.Category', by: 'categoryId' },
    template: { belongsTo: 'product.Template', by: 'templateId' },
    product: { belongsTo: 'product.Product', by: 'productId' },
  },
}
