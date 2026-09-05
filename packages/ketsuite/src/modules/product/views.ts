import type { ViewDef } from '@ketvietlab/ketjs'

/** The only shape of a product a theme is ever handed. */
export const views: Record<string, ViewDef> = {
  template: {
    of: 'product.Template',
    fields: ['id', 'name', 'type', 'description', 'listPrice', 'brandId', 'origin'],
  },
  variant: { of: 'product.Product', fields: ['id', 'defaultCode', 'barcode', 'weight', 'volume'] },
  category: { of: 'product.Category', fields: ['id', 'name'] },
  brand: { of: 'product.Brand', fields: ['id', 'name', 'active'] },
}
