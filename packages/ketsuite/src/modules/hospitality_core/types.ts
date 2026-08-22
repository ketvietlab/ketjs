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

/**
 * Statuses that take a room out of the sellable pool. A dirty or occupied room
 * is still sold tonight; a room under maintenance or out of order is not.
 */
export const OUT_OF_SERVICE_ROOM_STATUSES = ['maintenance', 'out_of_order'] as const

export const ROOM_VIEW_TYPES = [
  'city',
  'sea',
  'ocean',
  'garden',
  'pool',
  'mountain',
  'lake',
  'river',
  'courtyard',
] as const

export const AMENITY_SCOPES = ['property', 'room'] as const
export const BED_TYPES = ['single', 'double', 'queen', 'king', 'sofa', 'bunk'] as const
export const CANCELLATION_POLICY_TYPES = ['flexible', 'moderate', 'strict', 'non_refundable'] as const
export const CONTACT_TYPES = ['general', 'frontdesk', 'reservation'] as const
export const CONTENT_IMAGE_CATEGORIES = [
  'exterior',
  'lobby',
  'room',
  'bathroom',
  'restaurant',
  'pool',
  'other',
] as const
export const BOOKING_TYPES = ['nightly', 'hourly', 'weekly', 'monthly'] as const
export const RATE_TYPES = ['nightly', 'hourly', 'weekly', 'monthly'] as const
export const MEAL_PLANS = ['RO', 'BB', 'HB', 'FB', 'AI'] as const
export const BILLING_MODES = ['upfront', 'recurring'] as const
export const RESERVATION_STATES = [
  'draft',
  'confirmed',
  'checked_in',
  'checked_out',
  'no_show',
  'cancelled',
] as const
export const STAY_STATES = ['draft', 'checked_in', 'checked_out', 'no_show', 'cancelled'] as const
export const FOLIO_STATES = ['draft', 'open', 'closed', 'cancelled'] as const
export const ASSIGNMENT_STATES = ['active', 'closed'] as const
export const BOOKING_PROVIDERS = [
  'direct',
  'website',
  'booking',
  'agoda',
  'expedia',
  'traveloka',
  'airbnb',
] as const
export const CHARGE_TYPES = [
  'room',
  'minibar',
  'spa',
  'restaurant',
  'service',
  'cancellation',
  'discount',
] as const
export const PROPERTY_CHARGE_TYPES = ['parking', 'city_tax', 'internet', 'resort_fee', 'other'] as const
export const EXTRA_RECURRENCES = ['once', 'per_night', 'per_unit'] as const
export const DOCUMENT_TYPES = ['cccd', 'cmnd', 'passport', 'other'] as const
export const GENDERS = ['male', 'female', 'other'] as const
export const OCR_STATES = ['pending', 'done', 'failed'] as const
export const CLEANING_TASK_TYPES = ['checkout_clean', 'daily_clean', 'maintenance', 'inspection'] as const
export const CLEANING_TASK_PRIORITIES = ['normal', 'urgent'] as const
export const CLEANING_TASK_STATES = ['todo', 'in_progress', 'done', 'cancelled'] as const
export const NIGHT_AUDIT_STATES = ['queued', 'running', 'completed', 'failed'] as const
export const STAY_NOTICE_STATES = ['attention', 'ready', 'submitted', 'confirmed'] as const
export const STAY_NOTICE_REASONS = ['tourism', 'business', 'family', 'other'] as const
export const STAY_NOTICE_CHANNELS = ['online', 'vneid', 'email', 'phone', 'software'] as const

export type AccommodationType = (typeof ACCOMMODATION_TYPES)[number]
export type RoomStatus = (typeof ROOM_STATUSES)[number]
export type OutOfServiceRoomStatus = (typeof OUT_OF_SERVICE_ROOM_STATUSES)[number]
export type RoomViewType = (typeof ROOM_VIEW_TYPES)[number]
export type AmenityScope = (typeof AMENITY_SCOPES)[number]
export type BedType = (typeof BED_TYPES)[number]
export type CancellationPolicyType = (typeof CANCELLATION_POLICY_TYPES)[number]
export type ContactType = (typeof CONTACT_TYPES)[number]
export type ContentImageCategory = (typeof CONTENT_IMAGE_CATEGORIES)[number]
export type BookingType = (typeof BOOKING_TYPES)[number]
export type RateType = (typeof RATE_TYPES)[number]
export type MealPlan = (typeof MEAL_PLANS)[number]
export type BillingMode = (typeof BILLING_MODES)[number]
export type ReservationState = (typeof RESERVATION_STATES)[number]
export type StayState = (typeof STAY_STATES)[number]
export type FolioState = (typeof FOLIO_STATES)[number]
export type AssignmentState = (typeof ASSIGNMENT_STATES)[number]
export type BookingProvider = (typeof BOOKING_PROVIDERS)[number]
export type ChargeType = (typeof CHARGE_TYPES)[number]
export type PropertyChargeType = (typeof PROPERTY_CHARGE_TYPES)[number]
export type ExtraRecurrence = (typeof EXTRA_RECURRENCES)[number]
export type DocumentType = (typeof DOCUMENT_TYPES)[number]
export type Gender = (typeof GENDERS)[number]
export type OcrState = (typeof OCR_STATES)[number]
export type CleaningTaskType = (typeof CLEANING_TASK_TYPES)[number]
export type CleaningTaskPriority = (typeof CLEANING_TASK_PRIORITIES)[number]
export type CleaningTaskState = (typeof CLEANING_TASK_STATES)[number]
export type NightAuditState = (typeof NIGHT_AUDIT_STATES)[number]
export type StayNoticeState = (typeof STAY_NOTICE_STATES)[number]
export type StayNoticeReason = (typeof STAY_NOTICE_REASONS)[number]
export type StayNoticeChannel = (typeof STAY_NOTICE_CHANNELS)[number]
