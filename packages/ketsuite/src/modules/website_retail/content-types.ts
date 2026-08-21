import type { ContentTypeDef } from '@ketvietlab/ketjs'

export const contentTypes: Record<string, ContentTypeDef> = {
  product: {
    label: 'content.product',
    pluralLabel: 'content.products',
    fields: { productId: 'id', featuredImage: 'id?', badge: 'text?' },
    archivePath: '/shop',
    detailPath: '/shop/{slug}',
  },
}
