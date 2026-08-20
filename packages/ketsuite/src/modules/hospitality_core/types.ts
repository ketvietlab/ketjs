export const ACCOMMODATION_TYPES = [
  'hotel',
  'resort',
  'aparthotel',
  'hostel',
  'villa',
  'homestay',
  'boutique',
  'serviced_apartment',
] as const

export const ROOM_STATUSES = [
  'available',
  'occupied',
  'dirty',
  'cleaning',
  'maintenance',
  'out_of_order',
] as const

export const AMENITY_SCOPES = ['property', 'room'] as const
export const BED_TYPES = ['single', 'double', 'queen', 'king', 'sofa', 'bunk'] as const
export const CANCELLATION_POLICY_TYPES = ['flexible', 'moderate', 'strict', 'non_refundable'] as const
export const CONTACT_TYPES = ['general', 'frontdesk', 'reservation'] as const

export type AccommodationType = (typeof ACCOMMODATION_TYPES)[number]
export type RoomStatus = (typeof ROOM_STATUSES)[number]
export type AmenityScope = (typeof AMENITY_SCOPES)[number]
export type BedType = (typeof BED_TYPES)[number]
export type CancellationPolicyType = (typeof CANCELLATION_POLICY_TYPES)[number]
export type ContactType = (typeof CONTACT_TYPES)[number]
