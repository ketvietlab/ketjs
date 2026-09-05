import type { RelationDef } from '@ketvietlab/ketjs'

/**
 * Every relation is declared in both directions where both are useful, and each is
 * checked at compose against the key it travels on. None of them loads itself —
 * a caller asks with preload() or gets nothing.
 */
export const relations: Record<string, Record<string, RelationDef>> = {
  'product.Template': {
    variants: { hasMany: 'product.Product', by: 'templateId' },
    category: { belongsTo: 'product.Category', by: 'categoryId' },
    brand: { belongsTo: 'product.Brand', by: 'brandId' },
    uom: { belongsTo: 'uom.Unit', by: 'uomId' },
    uoms: { hasMany: 'product.TemplateUom', by: 'templateId' },
    attributeLines: { hasMany: 'product.TemplateAttributeLine', by: 'templateId' },
  },
  'product.Brand': {
    templates: { hasMany: 'product.Template', by: 'brandId' },
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
  'product.TemplateUom': {
    template: { belongsTo: 'product.Template', by: 'templateId' },
    uom: { belongsTo: 'uom.Unit', by: 'uomId' },
  },
  'product.ProductUom': {
    product: { belongsTo: 'product.Product', by: 'productId' },
    uom: { belongsTo: 'uom.Unit', by: 'uomId' },
  },
  'product.Cost': {
    product: { belongsTo: 'product.Product', by: 'productId' },
  },
  'product.TemplateAttributeLine': {
    template: { belongsTo: 'product.Template', by: 'templateId' },
    attribute: { belongsTo: 'product.Attribute', by: 'attributeId' },
    values: { hasMany: 'product.TemplateAttributeValue', by: 'lineId' },
  },
  'product.TemplateAttributeValue': {
    line: { belongsTo: 'product.TemplateAttributeLine', by: 'lineId' },
    value: { belongsTo: 'product.AttributeValue', by: 'valueId' },
  },
  'product.ProductValue': {
    product: { belongsTo: 'product.Product', by: 'productId' },
    value: { belongsTo: 'product.TemplateAttributeValue', by: 'templateAttributeValueId' },
  },
}
