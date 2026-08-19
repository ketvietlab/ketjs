import type { ModelDef } from 'ketjs'

/**
 * Master data: one catalogue across every company in the tenant, by decision.
 *
 * The template/variant split follows Odoo, including the name `Product` for the
 * variant. It reads oddly — a "product" here is one sellable combination, not the
 * thing a customer would call a product — but keeping the name makes the migration
 * map one to one, and a comment costs less than a translation table.
 */
export const models: Record<string, ModelDef> = {
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
    fields: {
      id: 'id',
      name: 'text',
      // 'goods' | 'service' — see types.ts. Validated on the way in rather than by
      // the column, because the type vocabulary is deliberately small.
      type: 'text',
      categoryId: 'ref:product.Category?',
      // The unit this template is counted in. Optional so a service needs none,
      // and so existing rows survive the module arriving.
      uomId: 'ref:uom.Unit?',
      description: 'text?',
      active: 'bool',
    },
  },

  /** One sellable combination of a template. Odoo calls this product.product. */
  Product: {
    scope: 'shared',
    fields: {
      id: 'id',
      templateId: 'ref:product.Template',
      sku: 'text',
      barcode: 'text?',
      active: 'bool',
    },
  },

  Attribute: {
    scope: 'shared',
    fields: { id: 'id', name: 'text' },
  },

  AttributeValue: {
    scope: 'shared',
    fields: { id: 'id', attributeId: 'ref:product.Attribute', name: 'text' },
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
      attributeValueId: 'ref:product.AttributeValue',
    },
  },
}
