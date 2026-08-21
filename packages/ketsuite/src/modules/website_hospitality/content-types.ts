import type { ContentTypeDef } from 'ketjs'

export const contentTypes: Record<string, ContentTypeDef> = {
  stay: {
    label: 'content.stay',
    pluralLabel: 'content.stays',
    fields: { roomTypeId: 'id', featuredImage: 'id?', amenities: 'json?' },
    detailPath: '/stay/{slug}',
  },
}
