import type { RelationDef } from 'ketjs'

/**
 * Every relation is declared in both directions where both are useful, and each is
 * checked at compose against the key it travels on. None of them loads itself —
 * a caller asks with preload() or gets nothing.
 */
export const relations: Record<string, Record<string, RelationDef>> = {
  'product.Template': {
    variants: { hasMany: 'product.Product', by: 'templateId' },
    category: { belongsTo: 'product.Category', by: 'categoryId' },
  },
  'product.Product': {
    template: { belongsTo: 'product.Template', by: 'templateId' },
    values: { hasMany: 'product.ProductValue', by: 'productId' },
  },
  'product.Category': {
    children: { hasMany: 'product.Category', by: 'parentId' },
    parent: { belongsTo: 'product.Category', by: 'parentId' },
  },
  'product.Attribute': {
    values: { hasMany: 'product.AttributeValue', by: 'attributeId' },
  },
  'product.AttributeValue': {
    attribute: { belongsTo: 'product.Attribute', by: 'attributeId' },
  },
  'product.ProductValue': {
    product: { belongsTo: 'product.Product', by: 'productId' },
    value: { belongsTo: 'product.AttributeValue', by: 'attributeValueId' },
  },
}
