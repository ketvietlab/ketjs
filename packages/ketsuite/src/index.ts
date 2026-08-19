// KetSuite — the application suite that runs on Ket.
//
// Every module here is written against the same contract a third-party module has:
// published joints, declared effects, view models, the public entry point. If the
// suite ever needs something deeper, so does everyone else — and it should be
// exported rather than smuggled. The dependency audit enforces exactly that.

// website vertical
export { default as website } from './modules/website/index.ts'
export { default as websiteMenu } from './modules/website_menu/index.ts'
export { default as websiteSeo } from './modules/website_seo/index.ts'
export { default as websiteSearch } from './modules/website_search/index.ts'
export { default as paperTheme } from './themes/paper/index.ts'
export type { SectionPlacement } from './modules/website/types.ts'

// units of measure — product depends on it
export { default as uom } from './modules/uom/index.ts'
export { convertQty, roundTo, compareQty, isZero, UomError } from './modules/uom/convert.ts'
export type { Unit } from './modules/uom/convert.ts'

// product vertical
export { default as product } from './modules/product/index.ts'
export { default as productMedia } from './modules/product_media/index.ts'
export { default as productBackend } from './modules/product_backend/index.ts'
export { default as pricing } from './modules/pricing/index.ts'
export { default as stock } from './modules/stock/index.ts'
export { default as stockBackend } from './modules/stock_backend/index.ts'
export { default as pricingBackend } from './modules/pricing_backend/index.ts'
export { default as account } from './modules/account/index.ts'
export { default as accountBackend } from './modules/account_backend/index.ts'
export { default as purchase } from './modules/purchase/index.ts'
export { default as purchaseBackend } from './modules/purchase_backend/index.ts'
export { default as sale } from './modules/sale/index.ts'
export { default as saleBackend } from './modules/sale_backend/index.ts'
export { default as pos } from './modules/pos/index.ts'
export { default as posBackend } from './modules/pos_backend/index.ts'
export {
  ACCOUNT_TYPES,
  JOURNAL_TYPES,
  MOVE_TYPES,
  MOVE_STATES,
  PAYMENT_STATES,
  TAX_USES,
  TAX_AMOUNT_TYPES,
} from './modules/account/functions.ts'
export { PURCHASE_STATES, INVOICE_STATUSES, PURCHASE_METHODS } from './modules/purchase/functions.ts'
export { SALE_STATES, SALE_INVOICE_STATUSES, INVOICE_POLICIES } from './modules/sale/functions.ts'
export { POS_ORDER_STATES, POS_SESSION_STATES, POS_INVOICE_STATUSES } from './modules/pos/functions.ts'
export { default as partner } from './modules/partner/index.ts'
export { default as company } from './modules/company/index.ts'
export { default as storage } from './modules/storage/index.ts'
export { default as hospitalityCore } from './modules/hospitality_core/index.ts'
export {
  ACCOMMODATION_TYPES,
  AMENITY_SCOPES,
  BED_TYPES,
  CANCELLATION_POLICY_TYPES,
  CONTACT_TYPES,
  ROOM_STATUSES,
  ASSIGNMENT_STATES,
  BILLING_MODES,
  BOOKING_PROVIDERS,
  BOOKING_TYPES,
  CHARGE_TYPES,
  DOCUMENT_TYPES,
  FOLIO_STATES,
  GENDERS,
  OCR_STATES,
  RESERVATION_STATES,
  STAY_STATES,
} from './modules/hospitality_core/types.ts'
export type {
  AccommodationType,
  AmenityScope,
  BedType,
  CancellationPolicyType,
  ContactType,
  RoomStatus,
  AssignmentState,
  BillingMode,
  BookingProvider,
  BookingType,
  ChargeType,
  DocumentType,
  FolioState,
  Gender,
  OcrState,
  ReservationState,
  StayState,
} from './modules/hospitality_core/types.ts'
export { default as user } from './modules/user/index.ts'
export { hashPassword, verifyPassword, needsRehash } from './modules/user/password.ts'
export { permittedFor } from './modules/user/roles.ts'
export { PARTNER_KINDS, PARTNER_ROLES, ADDRESS_USES } from './modules/partner/types.ts'
export type { PartnerKind, PartnerRole, AddressUse } from './modules/partner/types.ts'
export { PRODUCT_TYPES } from './modules/product/types.ts'
export type { ProductType } from './modules/product/types.ts'
export { mediaPanel } from './ui/media.tsx'
export type { MediaItem, MediaLabels, MediaPanelProps } from './ui/media.tsx'
export { scheduleBoard } from './ui/schedule.tsx'
export type { ScheduleDay, ScheduleEvent, ScheduleRow, ScheduleTone } from './ui/schedule.tsx'

// commerce — demo-grade scaffolding, kept until the vertical is written for real
export { default as catalog } from './modules/catalog/index.ts'
export { default as inventory } from './modules/inventory/index.ts'
export { default as checkout } from './modules/checkout/index.ts'
export { default as defaultTheme } from './themes/default/index.ts'
