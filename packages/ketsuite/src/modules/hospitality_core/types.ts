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
export const BOOKING_TYPES = ['nightly', 'hourly', 'weekly', 'monthly'] as const
export const BILLING_MODES = ['upfront', 'recurring'] as const
export const RESERVATION_STATES = ['draft', 'confirmed', 'checked_in', 'checked_out', 'cancelled'] as const
export const STAY_STATES = ['draft', 'checked_in', 'checked_out', 'cancelled'] as const
export const FOLIO_STATES = ['draft', 'open', 'closed', 'cancelled'] as const
export const ASSIGNMENT_STATES = ['active', 'closed'] as const
export const BOOKING_PROVIDERS = ['direct', 'booking', 'agoda', 'expedia', 'traveloka', 'airbnb'] as const
export const CHARGE_TYPES = ['room', 'minibar', 'spa', 'restaurant', 'service', 'discount'] as const
export const DOCUMENT_TYPES = ['cccd', 'cmnd', 'passport', 'other'] as const
export const GENDERS = ['male', 'female', 'other'] as const
export const OCR_STATES = ['pending', 'done', 'failed'] as const
export const CLEANING_TASK_TYPES = ['checkout_clean', 'daily_clean', 'maintenance', 'inspection'] as const
export const CLEANING_TASK_PRIORITIES = ['normal', 'urgent'] as const
export const CLEANING_TASK_STATES = ['todo', 'in_progress', 'done', 'cancelled'] as const

export type AccommodationType = (typeof ACCOMMODATION_TYPES)[number]
export type RoomStatus = (typeof ROOM_STATUSES)[number]
export type AmenityScope = (typeof AMENITY_SCOPES)[number]
export type BedType = (typeof BED_TYPES)[number]
export type CancellationPolicyType = (typeof CANCELLATION_POLICY_TYPES)[number]
export type ContactType = (typeof CONTACT_TYPES)[number]
export type BookingType = (typeof BOOKING_TYPES)[number]
export type BillingMode = (typeof BILLING_MODES)[number]
export type ReservationState = (typeof RESERVATION_STATES)[number]
export type StayState = (typeof STAY_STATES)[number]
export type FolioState = (typeof FOLIO_STATES)[number]
export type AssignmentState = (typeof ASSIGNMENT_STATES)[number]
export type BookingProvider = (typeof BOOKING_PROVIDERS)[number]
export type ChargeType = (typeof CHARGE_TYPES)[number]
export type DocumentType = (typeof DOCUMENT_TYPES)[number]
export type Gender = (typeof GENDERS)[number]
export type OcrState = (typeof OCR_STATES)[number]
export type CleaningTaskType = (typeof CLEANING_TASK_TYPES)[number]
export type CleaningTaskPriority = (typeof CLEANING_TASK_PRIORITIES)[number]
export type CleaningTaskState = (typeof CLEANING_TASK_STATES)[number]
