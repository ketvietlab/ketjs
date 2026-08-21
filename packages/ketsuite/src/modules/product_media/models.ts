import type { ModelDef } from '@ketvietlab/ketjs'

/** Ordered image metadata. Bytes and delivery remain owned by storage. */
export const models: Record<string, ModelDef> = {
  Media: {
    scope: 'company',
    fields: {
      id: 'id',
      attachmentId: 'ref:storage.Attachment',
      templateId: 'ref:product.Template?',
      productId: 'ref:product.Product?',
      targetKey: 'text',
      primarySlot: 'text?',
      alt: 'text?',
      sequence: 'int',
      primary: 'bool',
    },
    indexes: {
      attachment: { fields: ['companyId', 'attachmentId'], unique: true },
      one_primary: { fields: ['companyId', 'primarySlot'], unique: true },
      template_order: { fields: ['companyId', 'templateId', 'sequence'] },
      product_order: { fields: ['companyId', 'productId', 'sequence'] },
    },
  },
}
