import type { ModelDef } from '@ketvietlab/ketjs'

/**
 * Master data: one catalogue across every company in the tenant, by decision.
 *
 * The template/variant split follows the domain contract, including the name `Product` for the
 * variant. It reads oddly — a "product" here is one sellable combination, not the
 * thing a customer would call a product — but keeping the name makes the migration
 * map one to one, and a comment costs less than a translation table.
 */
export const models: Record<string, ModelDef> = {
  Brand: {
    scope: 'shared',
    fields: {
      id: 'id',
      name: 'text',
      active: 'bool',
    },
    indexes: { name: { fields: ['name'] } },
  },

  Category: {
    scope: 'shared',
    fields: {
      id: 'id',
      name: 'text',
      // Optional because the root has no parent, and a required self-reference
      // could never be satisfied by the first row.
      parentId: 'ref:product.Category?',
    },
  },

  Template: {
    scope: 'shared',
    timestamps: true,
    fields: {
      id: 'id',
      name: 'text',
      // 'goods' | 'service' — see types.ts. Validated on the way in rather than by
      // the column, because the type vocabulary is deliberately small.
      type: 'text',
      categoryId: 'ref:product.Category?',
      brandId: 'ref:product.Brand?',
      uomId: 'ref:uom.Unit?',
      origin: 'text?',
      description: 'text?',
      listPrice: 'decimal',
      saleOk: 'bool',
      purchaseOk: 'bool',
      active: 'bool',
    },
  },

  /** One sellable combination of a template. the domain contract calls this product.product. */
  Product: {
    scope: 'shared',
    timestamps: true,
    fields: {
      id: 'id',
      templateId: 'ref:product.Template',
      defaultCode: 'text?',
      barcode: 'text?',
      weight: 'decimal',
      volume: 'decimal',
      combinationKey: 'text',
      active: 'bool',
    },
    indexes: {
      template_combination: { fields: ['templateId', 'combinationKey'], unique: true },
      barcode_unique: { fields: ['barcode'], unique: true },
      default_code: { fields: ['defaultCode'] },
    },
  },

  Cost: {
    scope: 'company',
    fields: { id: 'id', productId: 'ref:product.Product', standardPrice: 'decimal' },
    indexes: { product_company: { fields: ['companyId', 'productId'], unique: true } },
  },

  TemplateUom: {
    scope: 'shared',
    fields: { id: 'id', templateId: 'ref:product.Template', uomId: 'ref:uom.Unit' },
    indexes: { template_uom: { fields: ['templateId', 'uomId'], unique: true } },
  },

  ProductUom: {
    scope: 'company',
    fields: { id: 'id', productId: 'ref:product.Product', uomId: 'ref:uom.Unit', barcode: 'text?' },
    indexes: {
      product_uom: { fields: ['companyId', 'productId', 'uomId'], unique: true },
      barcode_company: { fields: ['companyId', 'barcode'], unique: true },
    },
  },

  Attribute: {
    scope: 'shared',
    fields: {
      id: 'id',
      name: 'text',
      sequence: 'int',
      displayType: 'text',
      createVariant: 'text',
      active: 'bool',
    },
  },

  AttributeValue: {
    scope: 'shared',
    fields: { id: 'id', attributeId: 'ref:product.Attribute', name: 'text', sequence: 'int' },
  },

  TemplateAttributeLine: {
    scope: 'shared',
    fields: { id: 'id', templateId: 'ref:product.Template', attributeId: 'ref:product.Attribute' },
    indexes: { template_attribute: { fields: ['templateId', 'attributeId'], unique: true } },
  },

  TemplateAttributeValue: {
    scope: 'shared',
    fields: { id: 'id', lineId: 'ref:product.TemplateAttributeLine', valueId: 'ref:product.AttributeValue' },
    indexes: { line_value: { fields: ['lineId', 'valueId'], unique: true } },
  },

  /**
   * The join between a variant and the values that define it. An explicit model
   * rather than a hidden many-to-many: the framework has no magic for it, and a
   * join you can see is a join you can query, scope and migrate.
   */
  ProductValue: {
    scope: 'shared',
    fields: {
      id: 'id',
      productId: 'ref:product.Product',
      templateAttributeValueId: 'ref:product.TemplateAttributeValue',
    },
    indexes: { product_value: { fields: ['productId', 'templateAttributeValueId'], unique: true } },
  },
}
