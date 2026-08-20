import type { RelationDef } from 'ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'hospitality_core.Property': {
    countryRef: { belongsTo: 'address.Country', by: 'countryId' },
    divisionRef: { belongsTo: 'address.Division', by: 'divisionId' },
    buildings: { hasMany: 'hospitality_core.Building', by: 'propertyId' },
    floors: { hasMany: 'hospitality_core.Floor', by: 'propertyId' },
    roomTypes: { hasMany: 'hospitality_core.RoomType', by: 'propertyId' },
    rooms: { hasMany: 'hospitality_core.Room', by: 'propertyId' },
    amenities: { hasMany: 'hospitality_core.PropertyAmenity', by: 'propertyId' },
    contacts: { hasMany: 'hospitality_core.PropertyContact', by: 'propertyId' },
    propertyCharges: { hasMany: 'hospitality_core.PropertyCharge', by: 'propertyId' },
    extraLines: { hasMany: 'hospitality_core.ExtraLine', by: 'propertyId' },
    contentImages: { hasMany: 'hospitality_core.ContentImage', by: 'propertyId' },
    cancellationPolicy: {
      belongsTo: 'hospitality_core.CancellationPolicy',
      by: 'defaultCancellationPolicyId',
    },
  },
  'hospitality_core.Building': {
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
    floors: { hasMany: 'hospitality_core.Floor', by: 'buildingId' },
    rooms: { hasMany: 'hospitality_core.Room', by: 'buildingId' },
  },
  'hospitality_core.Floor': {
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
    building: { belongsTo: 'hospitality_core.Building', by: 'buildingId' },
    rooms: { hasMany: 'hospitality_core.Room', by: 'floorId' },
  },
  'hospitality_core.RoomType': {
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
    rooms: { hasMany: 'hospitality_core.Room', by: 'roomTypeId' },
    amenities: { hasMany: 'hospitality_core.RoomTypeAmenity', by: 'roomTypeId' },
    beds: { hasMany: 'hospitality_core.Bed', by: 'roomTypeId' },
    ratePlans: { hasMany: 'hospitality_core.RatePlan', by: 'roomTypeId' },
    availability: { hasMany: 'hospitality_core.AvailabilityLedger', by: 'roomTypeId' },
    restrictions: { hasMany: 'hospitality_core.Restriction', by: 'roomTypeId' },
    cancellationPolicy: { belongsTo: 'hospitality_core.CancellationPolicy', by: 'cancellationPolicyId' },
    contentImages: { hasMany: 'hospitality_core.ContentImage', by: 'roomTypeId' },
  },
  'hospitality_core.RatePlan': {
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
    roomType: { belongsTo: 'hospitality_core.RoomType', by: 'roomTypeId' },
  },
  'hospitality_core.AvailabilityLedger': {
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
    roomType: { belongsTo: 'hospitality_core.RoomType', by: 'roomTypeId' },
  },
  'hospitality_core.Restriction': {
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
    roomType: { belongsTo: 'hospitality_core.RoomType', by: 'roomTypeId' },
  },
  'hospitality_core.InventoryChange': {
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
    roomType: { belongsTo: 'hospitality_core.RoomType', by: 'roomTypeId' },
  },
  'hospitality_core.ContentImage': {
    attachment: { belongsTo: 'storage.Attachment', by: 'attachmentId' },
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
    roomType: { belongsTo: 'hospitality_core.RoomType', by: 'roomTypeId' },
  },
  'hospitality_core.ContentChange': {
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
  },
  'hospitality_core.Room': {
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
    roomType: { belongsTo: 'hospitality_core.RoomType', by: 'roomTypeId' },
    building: { belongsTo: 'hospitality_core.Building', by: 'buildingId' },
    floor: { belongsTo: 'hospitality_core.Floor', by: 'floorId' },
    cleaningTasks: { hasMany: 'hospitality_core.CleaningTask', by: 'roomId' },
  },
  'hospitality_core.Amenity': {
    category: { belongsTo: 'hospitality_core.AmenityCategory', by: 'categoryId' },
  },
  'hospitality_core.PropertyAmenity': {
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
    amenity: { belongsTo: 'hospitality_core.Amenity', by: 'amenityId' },
  },
  'hospitality_core.RoomTypeAmenity': {
    roomType: { belongsTo: 'hospitality_core.RoomType', by: 'roomTypeId' },
    amenity: { belongsTo: 'hospitality_core.Amenity', by: 'amenityId' },
  },
  'hospitality_core.Bed': {
    roomType: { belongsTo: 'hospitality_core.RoomType', by: 'roomTypeId' },
  },
  'hospitality_core.PropertyContact': {
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
  },
  'hospitality_core.PropertyCharge': {
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
  },
  'hospitality_core.Folio': {
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
    reservations: { hasMany: 'hospitality_core.Reservation', by: 'folioId' },
    stays: { hasMany: 'hospitality_core.Stay', by: 'folioId' },
    charges: { hasMany: 'hospitality_core.Charge', by: 'folioId' },
    extraLines: { hasMany: 'hospitality_core.ExtraLine', by: 'folioId' },
  },
  'hospitality_core.Reservation': {
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
    roomType: { belongsTo: 'hospitality_core.RoomType', by: 'roomTypeId' },
    folio: { belongsTo: 'hospitality_core.Folio', by: 'folioId' },
    stay: { belongsTo: 'hospitality_core.Stay', by: 'stayId' },
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
    extraLines: { hasMany: 'hospitality_core.ExtraLine', by: 'reservationId' },
  },
  'hospitality_core.Stay': {
    folio: { belongsTo: 'hospitality_core.Folio', by: 'folioId' },
    reservation: { belongsTo: 'hospitality_core.Reservation', by: 'reservationId' },
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
    roomType: { belongsTo: 'hospitality_core.RoomType', by: 'roomTypeId' },
    currentRoom: { belongsTo: 'hospitality_core.Room', by: 'currentRoomId' },
    assignments: { hasMany: 'hospitality_core.RoomAssignment', by: 'stayId' },
    guests: { hasMany: 'hospitality_core.StayGuest', by: 'stayId' },
    charges: { hasMany: 'hospitality_core.Charge', by: 'stayId' },
    documents: { hasMany: 'hospitality_core.GuestDocument', by: 'stayId' },
    extraLines: { hasMany: 'hospitality_core.ExtraLine', by: 'stayId' },
  },
  'hospitality_core.RoomAssignment': {
    stay: { belongsTo: 'hospitality_core.Stay', by: 'stayId' },
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
    room: { belongsTo: 'hospitality_core.Room', by: 'roomId' },
    roomType: { belongsTo: 'hospitality_core.RoomType', by: 'roomTypeId' },
  },
  'hospitality_core.StayGuest': {
    stay: { belongsTo: 'hospitality_core.Stay', by: 'stayId' },
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
  },
  'hospitality_core.Charge': {
    folio: { belongsTo: 'hospitality_core.Folio', by: 'folioId' },
    stay: { belongsTo: 'hospitality_core.Stay', by: 'stayId' },
    extraLine: { belongsTo: 'hospitality_core.ExtraLine', by: 'extraLineId' },
    product: { belongsTo: 'product.Product', by: 'productId' },
    uom: { belongsTo: 'uom.Unit', by: 'uomId' },
  },
  'hospitality_core.ExtraLine': {
    reservation: { belongsTo: 'hospitality_core.Reservation', by: 'reservationId' },
    stay: { belongsTo: 'hospitality_core.Stay', by: 'stayId' },
    folio: { belongsTo: 'hospitality_core.Folio', by: 'folioId' },
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
    product: { belongsTo: 'product.Product', by: 'productId' },
    uom: { belongsTo: 'uom.Unit', by: 'uomId' },
    charges: { hasMany: 'hospitality_core.Charge', by: 'extraLineId' },
  },
  'hospitality_core.GuestDocument': {
    stay: { belongsTo: 'hospitality_core.Stay', by: 'stayId' },
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
    frontAttachment: { belongsTo: 'storage.Attachment', by: 'frontAttachmentId' },
    backAttachment: { belongsTo: 'storage.Attachment', by: 'backAttachmentId' },
  },
  'hospitality_core.CleaningTask': {
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
    room: { belongsTo: 'hospitality_core.Room', by: 'roomId' },
    stay: { belongsTo: 'hospitality_core.Stay', by: 'stayId' },
  },
}
