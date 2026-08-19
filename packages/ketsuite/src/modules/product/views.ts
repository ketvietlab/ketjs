import type { ViewDef } from 'ketjs'

/** The only shape of a product a theme is ever handed. */
export const views: Record<string, ViewDef> = {
  template: { of: 'product.Template', fields: ['id', 'name', 'type', 'description'] },
  variant: { of: 'product.Product', fields: ['id', 'sku', 'barcode'] },
  category: { of: 'product.Category', fields: ['id', 'name'] },
}
