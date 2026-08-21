import type { SectionDef } from 'ketjs'

export const sections: Record<string, SectionDef> = {
  'website_hospitality.stays': {
    title: 'Danh sách hạng phòng',
    settings: { propertyId: 'id?', heading: 'text?', limit: 'int?' },
  },
  'website_hospitality.booking': {
    title: 'Yêu cầu đặt phòng',
    settings: { heading: 'text?', roomTypeId: 'id?' },
  },
}
