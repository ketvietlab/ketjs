import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  SiteProperty: {
    scope: 'company',
    fields: {
      id: 'id',
      siteId: 'ref:website.Site',
      propertyId: 'ref:hospitality_core.Property',
      active: 'bool',
    },
    indexes: {
      site_property: { fields: ['companyId', 'siteId', 'propertyId'], unique: true },
    },
  },
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
      dedupeKey: 'text?',
      createdAt: 'datetime',
    },
    indexes: {
      site_created: { fields: ['companyId', 'siteId', 'createdAt'] },
      site_status: { fields: ['companyId', 'siteId', 'status'] },
      site_dedupe: { fields: ['companyId', 'siteId', 'dedupeKey'], unique: true },
    },
  },
  BookingRateLimit: {
    scope: 'company',
    fields: {
      id: 'id',
      key: 'text',
      windowStartedAt: 'datetime',
      count: 'int',
    },
    indexes: { key: { fields: ['companyId', 'key'], unique: true } },
  },
}
