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
      longStayBillOnCheckIn: 'bool?',
      starRating: 'int',
      street1: 'text?',
      street2: 'text?',
      locality: 'text?',
      postalCode: 'text?',
      countryCode: 'text?',
      countryId: 'ref:address.Country?',
      divisionId: 'ref:address.Division?',
      divisionText: 'text?',
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

  /** A sellable price independent from room-type content. */
  RatePlan: {
    scope: 'company',
    fields: {
      id: 'id',
      propertyId: 'ref:hospitality_core.Property',
      roomTypeId: 'ref:hospitality_core.RoomType',
      code: 'text',
      name: 'text',
      rateType: 'text',
      amount: 'decimal',
      isDefault: 'bool',
      defaultKey: 'text?',
      mealPlan: 'text?',
      minStay: 'int',
      maxStay: 'int',
      active: 'bool',
    },
    indexes: {
      room_type_code: { fields: ['companyId', 'roomTypeId', 'code'], unique: true },
      active_property: { fields: ['companyId', 'propertyId', 'active', 'rateType', 'name'] },
      active_default: {
        fields: ['companyId', 'roomTypeId', 'rateType', 'defaultKey'],
        unique: true,
      },
    },
  },

  /**
   * Durable room-night capacity. `version` makes changes serialisable through
   * compare-and-set on every supported database adapter.
   */
  AvailabilityLedger: {
    scope: 'company',
    fields: {
      id: 'id',
      propertyId: 'ref:hospitality_core.Property',
      roomTypeId: 'ref:hospitality_core.RoomType',
      date: 'date',
      total: 'int',
      sold: 'int',
      blocked: 'int',
      available: 'int',
      version: 'int',
    },
    indexes: {
      room_night: { fields: ['companyId', 'propertyId', 'roomTypeId', 'date'], unique: true },
      availability: { fields: ['companyId', 'propertyId', 'date', 'available'] },
    },
  },

  /** Sales controls for one room type and one property-local calendar date. */
  Restriction: {
    scope: 'company',
    fields: {
      id: 'id',
      propertyId: 'ref:hospitality_core.Property',
      roomTypeId: 'ref:hospitality_core.RoomType',
      date: 'date',
      minLos: 'int',
      maxLos: 'int',
      closedToArrival: 'bool',
      closedToDeparture: 'bool',
      stopSell: 'bool',
      version: 'int',
    },
    indexes: {
      room_night: { fields: ['companyId', 'propertyId', 'roomTypeId', 'date'], unique: true },
      sales_control: { fields: ['companyId', 'propertyId', 'date', 'stopSell'] },
    },
  },

  /**
   * Append-only domain signal. Private channel adapters keep their own cursor and
   * rebuild provider payloads from current rate, inventory and restriction rows.
   */
  InventoryChange: {
    scope: 'company',
    fields: {
      id: 'id',
      propertyId: 'ref:hospitality_core.Property',
      roomTypeId: 'ref:hospitality_core.RoomType',
      kind: 'text',
      dateFrom: 'date',
      dateTo: 'date',
      aggregateId: 'text?',
      createdAt: 'datetime',
    },
    indexes: {
      property_cursor: { fields: ['companyId', 'propertyId', 'createdAt', 'id'] },
      room_type_cursor: { fields: ['companyId', 'roomTypeId', 'createdAt', 'id'] },
    },
  },

  /**
   * Ordered marketing images for a property or room type. Storage owns bytes;
   * this model owns hospitality captions, ordering and primary-image semantics.
   */
  ContentImage: {
    scope: 'company',
    fields: {
      id: 'id',
      attachmentId: 'ref:storage.Attachment',
      propertyId: 'ref:hospitality_core.Property?',
      roomTypeId: 'ref:hospitality_core.RoomType?',
      targetKey: 'text',
      primarySlot: 'text?',
      category: 'text',
      caption: 'text?',
      sequence: 'int',
      primary: 'bool',
      createdAt: 'datetime',
      updatedAt: 'datetime',
    },
    indexes: {
      attachment: { fields: ['companyId', 'attachmentId'], unique: true },
      one_primary: { fields: ['companyId', 'primarySlot'], unique: true },
      property_order: { fields: ['companyId', 'propertyId', 'sequence', 'id'] },
      room_type_order: { fields: ['companyId', 'roomTypeId', 'sequence', 'id'] },
    },
  },

  /**
   * Append-only content signal. Private OTA adapters consume a stable cursor and
   * rebuild provider payloads from current public hospitality records.
   */
  ContentChange: {
    scope: 'company',
    fields: {
      id: 'id',
      propertyId: 'ref:hospitality_core.Property',
      resourceType: 'text',
      resourceId: 'text',
      kind: 'text',
      createdAt: 'datetime',
    },
    indexes: {
      property_cursor: { fields: ['companyId', 'propertyId', 'createdAt', 'id'] },
      resource_cursor: {
        fields: ['companyId', 'propertyId', 'resourceType', 'resourceId', 'createdAt', 'id'],
      },
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

  /** Provider-visible property fees; accounting documents remain out of scope. */
  PropertyCharge: {
    scope: 'company',
    fields: {
      id: 'id',
      propertyId: 'ref:hospitality_core.Property',
      chargeType: 'text',
      name: 'text',
      amount: 'decimal',
      description: 'text?',
      active: 'bool',
    },
    indexes: {
      property_type_name: {
        fields: ['companyId', 'propertyId', 'chargeType', 'name'],
        unique: true,
      },
      property_active: { fields: ['companyId', 'propertyId', 'active', 'chargeType'] },
    },
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
      nextBillDate: 'date?',
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

  /**
   * One durable operational close per property and local calendar date. A run
   * may be retried, but recurring charges remain idempotent through Charge.sourceKey.
   */
  NightAuditRun: {
    scope: 'company',
    fields: {
      id: 'id',
      propertyId: 'ref:hospitality_core.Property',
      auditDate: 'date',
      state: 'text',
      inHouseCount: 'int',
      servicePosted: 'int',
      rentPosted: 'int',
      existingCount: 'int',
      totalAmount: 'decimal',
      attempt: 'int',
      requestedAt: 'datetime',
      startedAt: 'datetime?',
      completedAt: 'datetime?',
      error: 'text?',
    },
    indexes: {
      property_date: { fields: ['companyId', 'propertyId', 'auditDate'], unique: true },
      property_state: { fields: ['companyId', 'propertyId', 'state', 'auditDate'] },
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

  /**
   * Operational evidence for Vietnam's stay-notification procedure. The row
   * keeps masked identity metadata and a package hash, never a submitted PII payload.
   */
  StayNotice: {
    scope: 'company',
    fields: {
      id: 'id',
      propertyId: 'ref:hospitality_core.Property',
      stayId: 'ref:hospitality_core.Stay',
      stayGuestId: 'ref:hospitality_core.StayGuest',
      partnerId: 'ref:partner.Partner?',
      documentId: 'ref:hospitality_core.GuestDocument?',
      state: 'text',
      reason: 'text?',
      dueAt: 'datetime',
      guestName: 'text',
      documentType: 'text?',
      documentLast4: 'text?',
      issueCodes: 'json',
      attempt: 'int',
      preparedAt: 'datetime?',
      submissionChannel: 'text?',
      packageHash: 'text?',
      submittedAt: 'datetime?',
      submittedBy: 'text?',
      receiptRef: 'text?',
      confirmedAt: 'datetime?',
      confirmedBy: 'text?',
      createdAt: 'datetime',
      updatedAt: 'datetime',
    },
    indexes: {
      stay_guest: { fields: ['companyId', 'stayId', 'stayGuestId'], unique: true },
      property_state_due: { fields: ['companyId', 'propertyId', 'state', 'dueAt', 'id'] },
    },
  },

  /**
   * A priced service intention attached to one reservation or one stay. Charge
   * rows snapshot every materialised occurrence, so invoice integration can be
   * added later without changing the operational source of truth.
   */
  ExtraLine: {
    scope: 'company',
    fields: {
      id: 'id',
      reservationId: 'ref:hospitality_core.Reservation?',
      stayId: 'ref:hospitality_core.Stay?',
      folioId: 'ref:hospitality_core.Folio',
      propertyId: 'ref:hospitality_core.Property',
      productId: 'ref:product.Product',
      uomId: 'ref:uom.Unit?',
      description: 'text',
      quantity: 'decimal',
      unitPrice: 'decimal',
      recurrence: 'text',
      active: 'bool',
      createdAt: 'datetime',
      updatedAt: 'datetime',
    },
    indexes: {
      reservation_active: { fields: ['companyId', 'reservationId', 'active', 'createdAt'] },
      stay_active: { fields: ['companyId', 'stayId', 'active', 'createdAt'] },
      property_active: { fields: ['companyId', 'propertyId', 'active', 'createdAt'] },
    },
  },

  /** Operational charge only. Accounting documents are a later integration. */
  Charge: {
    scope: 'company',
    fields: {
      id: 'id',
      folioId: 'ref:hospitality_core.Folio',
      stayId: 'ref:hospitality_core.Stay?',
      extraLineId: 'ref:hospitality_core.ExtraLine?',
      nightAuditRunId: 'ref:hospitality_core.NightAuditRun?',
      productId: 'ref:product.Product?',
      uomId: 'ref:uom.Unit?',
      description: 'text',
      type: 'text',
      quantity: 'decimal',
      unitPrice: 'decimal',
      amount: 'decimal',
      occurredAt: 'datetime',
      serviceDate: 'date?',
      sourceKey: 'text?',
      state: 'text',
    },
    indexes: {
      folio_date: { fields: ['companyId', 'folioId', 'occurredAt'] },
      source: { fields: ['companyId', 'sourceKey'], unique: true },
      extra_line: { fields: ['companyId', 'extraLineId', 'occurredAt'] },
      night_audit: { fields: ['companyId', 'nightAuditRunId', 'occurredAt'] },
    },
  },

  /** Housekeeping work is durable and auditable; checkout creates one atomically. */
  CleaningTask: {
    scope: 'company',
    fields: {
      id: 'id',
      code: 'text',
      propertyId: 'ref:hospitality_core.Property',
      roomId: 'ref:hospitality_core.Room',
      stayId: 'ref:hospitality_core.Stay?',
      taskType: 'text',
      priority: 'text',
      state: 'text',
      assigneeId: 'text?',
      requestedAt: 'datetime',
      startedAt: 'datetime?',
      doneAt: 'datetime?',
      notes: 'text?',
    },
    indexes: {
      code_company: { fields: ['companyId', 'code'], unique: true },
      property_state: { fields: ['companyId', 'propertyId', 'state', 'priority', 'requestedAt'] },
      room_state: { fields: ['companyId', 'roomId', 'state', 'requestedAt'] },
      stay_type: { fields: ['companyId', 'stayId', 'taskType'], unique: true },
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
