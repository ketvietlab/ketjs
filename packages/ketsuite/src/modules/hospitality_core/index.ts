import { defineModule } from 'ketjs'
import { functions } from './functions.ts'
import { housekeeping } from './housekeeping.ts'
import { content } from './content.ts'
import { inventory } from './inventory.ts'
import { nightAuditFunctions, nightAuditJobs } from './night-audit.ts'
import { operations } from './operations.ts'
import { services } from './services.ts'
import { stayNoticeFunctions, stayNoticeJobs } from './stay-notices.ts'
import { menus } from './menus.ts'
import { messages } from './messages.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { routes } from './routes.ts'

export default defineModule({
  name: 'hospitality_core',
  version: '0.1.0',
  depends: ['backend', 'storage', 'partner', 'address', 'uom', 'product'],
  app: true,
  title: 'Khách sạn',
  summary: 'Cơ sở lưu trú, loại phòng, phòng, tiện nghi và chính sách vận hành.',
  category: 'Khách sạn',
  models,
  relations,
  functions: {
    ...functions,
    ...inventory,
    ...operations,
    ...housekeeping,
    ...content,
    ...services,
    ...nightAuditFunctions,
    ...stayNoticeFunctions,
  },
  jobs: { ...nightAuditJobs, ...stayNoticeJobs },
  routes,
  menus,
  messages,
})

export {
  ACCOMMODATION_TYPES,
  AMENITY_SCOPES,
  BED_TYPES,
  CANCELLATION_POLICY_TYPES,
  CONTACT_TYPES,
  CONTENT_IMAGE_CATEGORIES,
  ROOM_STATUSES,
  ASSIGNMENT_STATES,
  BILLING_MODES,
  BOOKING_PROVIDERS,
  BOOKING_TYPES,
  RATE_TYPES,
  MEAL_PLANS,
  CHARGE_TYPES,
  PROPERTY_CHARGE_TYPES,
  EXTRA_RECURRENCES,
  DOCUMENT_TYPES,
  FOLIO_STATES,
  GENDERS,
  OCR_STATES,
  RESERVATION_STATES,
  STAY_STATES,
  CLEANING_TASK_PRIORITIES,
  CLEANING_TASK_STATES,
  CLEANING_TASK_TYPES,
  NIGHT_AUDIT_STATES,
  STAY_NOTICE_CHANNELS,
  STAY_NOTICE_REASONS,
  STAY_NOTICE_STATES,
} from './types.ts'
export type {
  AccommodationType,
  AmenityScope,
  BedType,
  CancellationPolicyType,
  ContactType,
  ContentImageCategory,
  RoomStatus,
  AssignmentState,
  BillingMode,
  BookingProvider,
  BookingType,
  RateType,
  MealPlan,
  ChargeType,
  PropertyChargeType,
  ExtraRecurrence,
  DocumentType,
  FolioState,
  Gender,
  OcrState,
  ReservationState,
  StayState,
  CleaningTaskPriority,
  CleaningTaskState,
  CleaningTaskType,
  NightAuditState,
  StayNoticeChannel,
  StayNoticeReason,
  StayNoticeState,
} from './types.ts'
