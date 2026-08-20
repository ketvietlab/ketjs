import type { ModelDef } from 'ketjs'

/**
 * The operational and sellable hotel structure.
 *
 * The Odoo source spreads these records over core, content and inventory addons.
 * KetSuite keeps them together because a room without its sellable description is
 * not a useful bounded context. Accounting remains outside this boundary.
 */
export const models: Record<string, ModelDef> = {
  Property: {
    scope: 'company',
    fields: {
      id: 'id',
      code: 'text',
      name: 'text',
      publicName: 'text?',
      accommodationType: 'text',
      timezone: 'text',
      defaultCheckIn: 'text',
      defaultCheckOut: 'text',
      enforceTimes: 'bool',
      starRating: 'int',
      street: 'text?',
      street2: 'text?',
      city: 'text?',
      state: 'text?',
      country: 'text?',
      latitude: 'decimal?',
      longitude: 'decimal?',
      description: 'text?',
      houseRules: 'text?',
      childrenStayFree: 'bool',
      minimumGuestAge: 'int?',
      defaultCancellationPolicyId: 'ref:hospitality_core.CancellationPolicy?',
      active: 'bool',
    },
    indexes: {
      code_company: { fields: ['companyId', 'code'], unique: true },
      active_name: { fields: ['companyId', 'active', 'name'] },
    },
  },

  Building: {
    scope: 'company',
    fields: {
      id: 'id',
      propertyId: 'ref:hospitality_core.Property',
      code: 'text',
      name: 'text',
      sequence: 'int',
      active: 'bool',
    },
    indexes: { property_code: { fields: ['companyId', 'propertyId', 'code'], unique: true } },
  },

  Floor: {
    scope: 'company',
    fields: {
      id: 'id',
      propertyId: 'ref:hospitality_core.Property',
      buildingId: 'ref:hospitality_core.Building',
      code: 'text',
      name: 'text',
      sequence: 'int',
      active: 'bool',
    },
    indexes: { building_code: { fields: ['companyId', 'buildingId', 'code'], unique: true } },
  },

  RoomType: {
    scope: 'company',
    fields: {
      id: 'id',
      propertyId: 'ref:hospitality_core.Property',
      code: 'text',
      name: 'text',
      publicName: 'text?',
      description: 'text?',
      defaultCapacity: 'int',
      maxAdults: 'int',
      maxChildren: 'int',
      maxInfants: 'int',
      maxExtraBeds: 'int',
      sizeSqm: 'decimal?',
      viewType: 'text?',
      sharedBathroom: 'bool',
      baseRate: 'decimal',
      color: 'text?',
      cancellationPolicyId: 'ref:hospitality_core.CancellationPolicy?',
      published: 'bool',
      active: 'bool',
    },
    indexes: {
      property_code: { fields: ['companyId', 'propertyId', 'code'], unique: true },
      property_active: { fields: ['companyId', 'propertyId', 'active', 'name'] },
    },
  },

  Room: {
    scope: 'company',
    fields: {
      id: 'id',
      propertyId: 'ref:hospitality_core.Property',
      roomTypeId: 'ref:hospitality_core.RoomType',
      buildingId: 'ref:hospitality_core.Building?',
      floorId: 'ref:hospitality_core.Floor?',
      code: 'text',
      name: 'text',
      capacity: 'int',
      status: 'text',
      note: 'text?',
      active: 'bool',
    },
    indexes: {
      property_code: { fields: ['companyId', 'propertyId', 'code'], unique: true },
      property_status: { fields: ['companyId', 'propertyId', 'status', 'active'] },
      room_type: { fields: ['companyId', 'roomTypeId', 'active'] },
    },
  },

  AmenityCategory: {
    scope: 'company',
    fields: { id: 'id', name: 'text', sequence: 'int', active: 'bool' },
  },

  Amenity: {
    scope: 'company',
    fields: {
      id: 'id',
      categoryId: 'ref:hospitality_core.AmenityCategory?',
      code: 'text',
      name: 'text',
      scope: 'text',
      sequence: 'int',
      active: 'bool',
    },
    indexes: { code_company: { fields: ['companyId', 'code'], unique: true } },
  },

  PropertyAmenity: {
    scope: 'company',
    fields: {
      id: 'id',
      propertyId: 'ref:hospitality_core.Property',
      amenityId: 'ref:hospitality_core.Amenity',
    },
    indexes: {
      assignment: { fields: ['companyId', 'propertyId', 'amenityId'], unique: true },
    },
  },

  RoomTypeAmenity: {
    scope: 'company',
    fields: {
      id: 'id',
      roomTypeId: 'ref:hospitality_core.RoomType',
      amenityId: 'ref:hospitality_core.Amenity',
    },
    indexes: {
      assignment: { fields: ['companyId', 'roomTypeId', 'amenityId'], unique: true },
    },
  },

  Bed: {
    scope: 'company',
    fields: {
      id: 'id',
      roomTypeId: 'ref:hospitality_core.RoomType',
      type: 'text',
      quantity: 'int',
      roomName: 'text?',
    },
    indexes: { room_type: { fields: ['companyId', 'roomTypeId'] } },
  },

  CancellationPolicy: {
    scope: 'company',
    fields: {
      id: 'id',
      code: 'text',
      name: 'text',
      type: 'text',
      description: 'text?',
      freeCancellationHours: 'int',
      penaltyPercent: 'decimal',
      active: 'bool',
    },
    indexes: { code_company: { fields: ['companyId', 'code'], unique: true } },
  },

  PropertyContact: {
    scope: 'company',
    fields: {
      id: 'id',
      propertyId: 'ref:hospitality_core.Property',
      type: 'text',
      name: 'text',
      email: 'text?',
      phone: 'text?',
    },
    indexes: { property_type: { fields: ['companyId', 'propertyId', 'type'], unique: true } },
  },

  /** Operational account for one payer and one or more physical stays. */
  Folio: {
    scope: 'company',
    fields: {
      id: 'id',
      code: 'text',
      propertyId: 'ref:hospitality_core.Property',
      partnerId: 'ref:partner.Partner',
      state: 'text',
      amountTotal: 'decimal',
      version: 'int',
      openedAt: 'datetime',
      closedAt: 'datetime?',
    },
    indexes: {
      code_company: { fields: ['companyId', 'code'], unique: true },
      property_state: { fields: ['companyId', 'propertyId', 'state', 'openedAt'] },
    },
  },

  /** Commercial booking intent. Physical occupancy belongs to Stay. */
  Reservation: {
    scope: 'company',
    fields: {
      id: 'id',
      code: 'text',
      propertyId: 'ref:hospitality_core.Property',
      roomTypeId: 'ref:hospitality_core.RoomType',
      folioId: 'ref:hospitality_core.Folio',
      stayId: 'ref:hospitality_core.Stay?',
      partnerId: 'ref:partner.Partner',
      provider: 'text',
      externalId: 'text?',
      channelRef: 'text?',
      bookingType: 'text',
      checkIn: 'datetime',
      checkOut: 'datetime',
      adults: 'int',
      children: 'int',
      rate: 'decimal',
      quantity: 'decimal',
      billingMode: 'text',
      amountTotal: 'decimal',
      state: 'text',
      cancelReason: 'text?',
      createdAt: 'datetime',
      updatedAt: 'datetime',
    },
    indexes: {
      code_company: { fields: ['companyId', 'code'], unique: true },
      provider_external: {
        fields: ['companyId', 'propertyId', 'provider', 'externalId'],
        unique: true,
      },
      property_schedule: {
        fields: ['companyId', 'propertyId', 'state', 'checkIn', 'checkOut'],
      },
      room_type_schedule: {
        fields: ['companyId', 'roomTypeId', 'state', 'checkIn', 'checkOut'],
      },
    },
  },

  /** A physical occupancy. One reservation may create one stay in this version. */
  Stay: {
    scope: 'company',
    fields: {
      id: 'id',
      code: 'text',
      folioId: 'ref:hospitality_core.Folio',
      reservationId: 'ref:hospitality_core.Reservation?',
      partnerId: 'ref:partner.Partner',
      propertyId: 'ref:hospitality_core.Property',
      roomTypeId: 'ref:hospitality_core.RoomType',
      currentRoomId: 'ref:hospitality_core.Room?',
      bookingType: 'text',
      checkIn: 'datetime',
      checkOut: 'datetime',
      adults: 'int',
      children: 'int',
      billingMode: 'text',
      rate: 'decimal',
      state: 'text',
      checkedInAt: 'datetime?',
      checkedOutAt: 'datetime?',
    },
    indexes: {
      code_company: { fields: ['companyId', 'code'], unique: true },
      reservation: { fields: ['companyId', 'reservationId'], unique: true },
      property_state: { fields: ['companyId', 'propertyId', 'state', 'checkIn'] },
    },
  },

  /** Append-only room history; moving rooms closes one row and inserts another. */
  RoomAssignment: {
    scope: 'company',
    fields: {
      id: 'id',
      stayId: 'ref:hospitality_core.Stay',
      propertyId: 'ref:hospitality_core.Property',
      roomId: 'ref:hospitality_core.Room',
      roomTypeId: 'ref:hospitality_core.RoomType',
      startAt: 'datetime',
      endAt: 'datetime?',
      state: 'text',
      reason: 'text?',
    },
    indexes: {
      stay_state: { fields: ['companyId', 'stayId', 'state', 'startAt'] },
      room_schedule: { fields: ['companyId', 'roomId', 'startAt', 'endAt'] },
    },
  },

  StayGuest: {
    scope: 'company',
    fields: {
      id: 'id',
      stayId: 'ref:hospitality_core.Stay',
      propertyId: 'ref:hospitality_core.Property',
      partnerId: 'ref:partner.Partner?',
      displayName: 'text',
      primary: 'bool',
      primaryKey: 'text?',
    },
    indexes: {
      stay_partner: { fields: ['companyId', 'stayId', 'partnerId'], unique: true },
      stay_primary: { fields: ['companyId', 'stayId', 'primaryKey'], unique: true },
    },
  },

  /** Operational charge only. Accounting documents are a later integration. */
  Charge: {
    scope: 'company',
    fields: {
      id: 'id',
      folioId: 'ref:hospitality_core.Folio',
      stayId: 'ref:hospitality_core.Stay?',
      description: 'text',
      type: 'text',
      quantity: 'decimal',
      unitPrice: 'decimal',
      amount: 'decimal',
      occurredAt: 'datetime',
      sourceKey: 'text?',
      state: 'text',
    },
    indexes: {
      folio_date: { fields: ['companyId', 'folioId', 'occurredAt'] },
      source: { fields: ['companyId', 'sourceKey'], unique: true },
    },
  },

  /** PII-minimised identity data; scanned images are ordinary storage attachments. */
  GuestDocument: {
    scope: 'company',
    fields: {
      id: 'id',
      stayId: 'ref:hospitality_core.Stay?',
      partnerId: 'ref:partner.Partner',
      type: 'text',
      number: 'text?',
      fullName: 'text',
      dateOfBirth: 'datetime?',
      gender: 'text?',
      nationality: 'text?',
      permanentAddress: 'text?',
      issueDate: 'datetime?',
      issuePlace: 'text?',
      frontAttachmentId: 'ref:storage.Attachment?',
      backAttachmentId: 'ref:storage.Attachment?',
      ocrState: 'text',
      ocrRaw: 'json?',
    },
    indexes: {
      partner: { fields: ['companyId', 'partnerId'] },
      stay: { fields: ['companyId', 'stayId'] },
    },
  },
}
