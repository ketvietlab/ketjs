import type { RelationDef } from 'ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'hospitality_core.Property': {
    buildings: { hasMany: 'hospitality_core.Building', by: 'propertyId' },
    floors: { hasMany: 'hospitality_core.Floor', by: 'propertyId' },
    roomTypes: { hasMany: 'hospitality_core.RoomType', by: 'propertyId' },
    rooms: { hasMany: 'hospitality_core.Room', by: 'propertyId' },
    amenities: { hasMany: 'hospitality_core.PropertyAmenity', by: 'propertyId' },
    contacts: { hasMany: 'hospitality_core.PropertyContact', by: 'propertyId' },
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
    cancellationPolicy: { belongsTo: 'hospitality_core.CancellationPolicy', by: 'cancellationPolicyId' },
  },
  'hospitality_core.Room': {
    property: { belongsTo: 'hospitality_core.Property', by: 'propertyId' },
    roomType: { belongsTo: 'hospitality_core.RoomType', by: 'roomTypeId' },
    building: { belongsTo: 'hospitality_core.Building', by: 'buildingId' },
    floor: { belongsTo: 'hospitality_core.Floor', by: 'floorId' },
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
}
