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
}
