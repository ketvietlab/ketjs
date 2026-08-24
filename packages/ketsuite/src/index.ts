// KetSuite — the application suite that runs on Ket.
//
// Every module here is written against the same contract a third-party module has:
// published joints, declared effects, view models, the public entry point. If the
// suite ever needs something deeper, so does everyone else — and it should be
// exported rather than smuggled. The dependency audit enforces exactly that.

// website vertical
export { default as channelApi } from './modules/channel_api/index.ts'
export {
  CHANNEL_API_VERSION,
  channelCommandId,
  defineChannelRoute,
  openApiDocument,
  registerChannelIdentity,
  registerChannelRealm,
  routesOf as channelRoutesOf,
} from './modules/channel_api/index.ts'
export type {
  ChannelAccount,
  ChannelIdentities,
  ChannelIdentityFor,
  CustomerIdentity,
  StaffIdentity,
  ChannelAuth,
  ChannelIdentity,
  ChannelIdentityResolver,
  ChannelProfile,
  ChannelRequest,
  ChannelRouteSpec,
} from './modules/channel_api/index.ts'
export { default as website } from './modules/website/index.ts'
export { default as websiteMenu } from './modules/website_menu/index.ts'
export { default as websiteSeo } from './modules/website_seo/index.ts'
export { default as websiteSearch } from './modules/website_search/index.ts'
export { default as websiteForm } from './modules/website_form/index.ts'
export { default as websiteBackend } from './modules/website_backend/index.ts'
export { default as websiteHospitality } from './modules/website_hospitality/index.ts'
export { default as websiteRetail } from './modules/website_retail/index.ts'
export { default as paperTheme } from './themes/paper/index.ts'
export { default as hospitalityTheme } from './themes/hospitality/index.ts'
export { default as retailTheme } from './themes/retail/index.ts'
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
export { default as report } from './modules/report/index.ts'
export { REPORT_FILTERS } from './modules/report/routes.ts'
export { default as reportBackend } from './modules/report_backend/index.ts'
export { default as accountBackend } from './modules/account_backend/index.ts'
export { default as purchase } from './modules/purchase/index.ts'
export { default as purchaseBackend } from './modules/purchase_backend/index.ts'
export { default as sale } from './modules/sale/index.ts'
export { default as saleBackend } from './modules/sale_backend/index.ts'
export { default as pos } from './modules/pos/index.ts'
export { default as posBackend } from './modules/pos_backend/index.ts'
export { default as loyalty } from './modules/loyalty/index.ts'
export { default as loyaltySale } from './modules/loyalty_sale/index.ts'
export { default as loyaltyPos } from './modules/loyalty_pos/index.ts'
export { default as loyaltyBackend } from './modules/loyalty_backend/index.ts'
export { default as crm } from './modules/crm/index.ts'
export { default as crmSale } from './modules/crm_sale/index.ts'
export { default as crmBackend } from './modules/crm_backend/index.ts'
export { default as crmWebsite } from './modules/crm_website/index.ts'
/** Stable extension boundary for private modules that compose Sale commands in one transaction. */
export { functions as saleFunctionSpecs } from './modules/sale/functions.ts'
export {
  CASE_KINDS,
  TERMINAL_STATES,
  CASE_PRIORITIES,
  MESSAGE_VISIBILITIES,
  ASSIGNMENT_MODES,
} from './modules/crm/types.ts'
/**
 * Storing an upload is the one piece of an attachment a module cannot sensibly
 * reimplement — streaming, limits, checksums and object keys all live in
 * `storage`. An extension that owns records with photographs needs it.
 */
export { receiveAttachment } from './modules/storage/routes.ts'
export type { Attachment as StorageAttachment, UploadDefaults } from './modules/storage/routes.ts'

export {
  actorRequired as crmActorRequired,
  activeStage as crmActiveStage,
  addCaseMessage as crmAddCaseMessage,
  addTimeline as crmAddTimeline,
  canReadCase as crmCanReadCase,
  caseAudience as crmCaseAudience,
  caseDetail as crmCaseDetail,
  commandKey as crmCommandKey,
  ensureCrmDefaults,
  firstStage as crmFirstStage,
  invalid as crmInvalid,
  issue as crmIssue,
  n as crmNumber,
  normalized as crmNormalized,
  now as crmNow,
  ownedKinds as crmOwnedKinds,
  ownsKind as crmOwnsKind,
  saveCase as crmSaveCase,
  seededId as crmSeededId,
  serializeCaseList as crmSerializeCaseList,
  visibleCases as crmVisibleCases,
} from './modules/crm/index.ts'
export {
  APPLICATION_STATES,
  DISCOUNT_APPLICABILITY,
  DISCOUNT_MODES,
  LEDGER_OPERATIONS,
  LOYALTY_CHANNELS,
  POINT_MODES,
  PROGRAM_APPLIES_ON,
  PROGRAM_TRIGGERS,
  PROGRAM_TYPES,
  RESERVATION_STATES as LOYALTY_RESERVATION_STATES,
  REWARD_TYPES,
  TAX_MODES,
  WALLET_UNITS,
} from './modules/loyalty/types.ts'
export type {
  DiscountApplicability,
  DiscountMode,
  EligibilityResult,
  LedgerOperation,
  LoyaltyChannel,
  MembershipSummary,
  OrderLineSnapshot,
  OrderSnapshot,
  PointMode,
  ProgramAppliesOn,
  ProgramTrigger,
  ProgramType,
  RewardQuote,
  RewardType,
  TaxMode,
  WalletSummary,
  WalletUnit,
} from './modules/loyalty/types.ts'
export {
  ACCOUNT_TYPES,
  JOURNAL_TYPES,
  MOVE_TYPES,
  MOVE_STATES,
  PAYMENT_STATES,
  TAX_USES,
  TAX_AMOUNT_TYPES,
} from './modules/account/functions.ts'
export {
  TT99_ACCOUNTS,
  TT99_ACCOUNT_CHECKSUM,
  TT99_CATALOG_CHECKSUM,
  TT99_CODE,
  VIETNAM_TAXES,
} from './modules/account/tt99.ts'
export { PURCHASE_STATES, INVOICE_STATUSES, PURCHASE_METHODS } from './modules/purchase/functions.ts'
export { SALE_STATES, SALE_INVOICE_STATUSES, INVOICE_POLICIES } from './modules/sale/functions.ts'
export { POS_ORDER_STATES, POS_SESSION_STATES, POS_INVOICE_STATUSES } from './modules/pos/functions.ts'
export { default as address } from './modules/address/index.ts'
export {
  availableCatalogs as availableAddressCatalogs,
  loadCatalog as loadAddressCatalog,
} from './modules/address/loader.ts'
export {
  divisionPath,
  resolveAddress,
  snapshotAddress,
  validateAddress,
} from './modules/address/format.ts'
export type { AddressInput, AddressIssue, ResolvedAddress } from './modules/address/format.ts'
export { default as addressBackend } from './modules/address_backend/index.ts'
export { default as partner } from './modules/partner/index.ts'
export { default as partnerBackend } from './modules/partner_backend/index.ts'
export { default as accountPartner } from './modules/account_partner/index.ts'
export { default as accountPartnerBackend } from './modules/account_partner_backend/index.ts'
export { default as company } from './modules/company/index.ts'
export { default as companyBackend } from './modules/company_backend/index.ts'
export { default as hr } from './modules/hr/index.ts'
export { default as attendance } from './modules/attendance/index.ts'
export { default as hrBackend } from './modules/hr_backend/index.ts'
export { default as attendanceBackend } from './modules/attendance_backend/index.ts'
export {
  LEAVE_PORTIONS,
  LEAVE_STATES,
  ROSTER_STATES,
  SHIFT_STATES,
} from './modules/hr/types.ts'
export type { LeavePortion, LeaveState, RosterState, ShiftState } from './modules/hr/types.ts'
export { PERIOD_STATES, PUNCH_KINDS, PUNCH_SOURCES, REQUEST_STATES } from './modules/attendance/types.ts'
export type { PeriodState, PunchKind, PunchSource, RequestState } from './modules/attendance/types.ts'
export { default as storage } from './modules/storage/index.ts'
export { default as hospitalityCore } from './modules/hospitality_core/index.ts'
export { default as hospitalityBilling } from './modules/hospitality_billing/index.ts'
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
  RATE_TYPES,
  MEAL_PLANS,
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
  RateType,
  MealPlan,
  ChargeType,
  DocumentType,
  FolioState,
  Gender,
  OcrState,
  ReservationState,
  StayState,
} from './modules/hospitality_core/types.ts'
export { default as user } from './modules/user/index.ts'
export { default as userBackend } from './modules/user_backend/index.ts'
export { default as oauth } from './modules/oauth/index.ts'
export { default as oauthBackend } from './modules/oauth_backend/index.ts'
export { default as mail } from './modules/mail/index.ts'
export { default as mailBackend } from './modules/mail_backend/index.ts'
export { default as mailTransport } from './modules/mail_transport/index.ts'
export { default as mailTransportBackend } from './modules/mail_transport_backend/index.ts'
export { default as mailInbound } from './modules/mail_inbound/index.ts'
export { default as mailInboundBackend } from './modules/mail_inbound_backend/index.ts'
export { default as productMailBackend } from './modules/product_mail_backend/index.ts'
export { default as productVariantMailBackend } from './modules/product_variant_mail_backend/index.ts'
export { default as stockMailBackend } from './modules/stock_mail_backend/index.ts'
export { default as stockLotMailBackend } from './modules/stock_lot_mail_backend/index.ts'
export { default as saleMailBackend } from './modules/sale_mail_backend/index.ts'
export { default as accountMailBackend } from './modules/account_mail_backend/index.ts'
export { default as activity } from './modules/activity/index.ts'
export { default as activityBackend } from './modules/activity_backend/index.ts'
export { default as productActivityBackend } from './modules/product_activity_backend/index.ts'
export { default as productVariantActivityBackend } from './modules/product_variant_activity_backend/index.ts'
export { default as stockActivityBackend } from './modules/stock_activity_backend/index.ts'
export { default as stockLotActivityBackend } from './modules/stock_lot_activity_backend/index.ts'
export { default as saleActivityBackend } from './modules/sale_activity_backend/index.ts'
export { default as accountActivityBackend } from './modules/account_activity_backend/index.ts'
export { default as stockMailInbound } from './modules/stock_mail_inbound/index.ts'
export { default as calendar } from './modules/calendar/index.ts'
export { default as calendarActivity } from './modules/calendar_activity/index.ts'
export { default as calendarBackend } from './modules/calendar_backend/index.ts'
export { default as calendarMailTransport } from './modules/calendar_mail_transport/index.ts'
export { default as flow } from './modules/flow/index.ts'
export { default as flowBackend } from './modules/flow_backend/index.ts'
export { DEPENDENCY_RELATIONS, ISSUE_PRIORITIES, SPRINT_STATES } from './modules/flow/types.ts'
export type { DependencyRelation, IssuePriority, SprintState } from './modules/flow/types.ts'
export { hashPassword, verifyPassword, needsRehash } from './modules/user/password.ts'
export { permittedFor } from './modules/user/roles.ts'
export { resolveUserSession } from './modules/user/session-context.ts'
export {
  discoverOidc,
  exchangeOidcCode,
  oidcAuthorizationUrl,
  OauthProtocolError,
  pkceChallenge,
  verifyOidcIdToken,
} from './modules/oauth/protocol.ts'
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
