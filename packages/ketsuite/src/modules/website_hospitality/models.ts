import type { ModelDef } from 'ketjs'

export const models: Record<string, ModelDef> = {
  BookingLead: {
    scope: 'company',
    fields: {
      id: 'id',
      siteId: 'ref:website.Site',
      roomTypeId: 'ref:hospitality_core.RoomType?',
      guestName: 'text',
      email: 'text',
      phone: 'text?',
      checkIn: 'date',
      checkOut: 'date',
      adults: 'int',
      children: 'int',
      note: 'text?',
      status: 'text',
      createdAt: 'datetime',
    },
    indexes: {
      site_created: { fields: ['companyId', 'siteId', 'createdAt'] },
      site_status: { fields: ['companyId', 'siteId', 'status'] },
    },
  },
}
