import type { RelationDef } from '@ketvietlab/ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'product_media.Media': {
    attachment: { belongsTo: 'storage.Attachment', by: 'attachmentId' },
    template: { belongsTo: 'product.Template', by: 'templateId' },
    product: { belongsTo: 'product.Product', by: 'productId' },
  },
}
