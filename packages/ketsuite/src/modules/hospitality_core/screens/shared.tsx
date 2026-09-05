import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  CardGrid,
  code,
  dataTable,
  DatePicker,
  DefinitionList,
  emptyState,
  formatDateTime,
  formatMoney,
  FormCluster,
  RecordScreen,
  icon,
  inline,
  linkButton,
  MediaPanel,
  Metric,
  modalForm,
  ModalSheet,
  modalWorkspace,
  Notice,
  person,
  RecordActions,
  RecordForm,
  RecordWorkspace,
  ScheduleBoard,
  Section,
  stack,
  Surface,
  WorkspaceScreen,
} from '../../../ui/index.ts'
import type { Column, FormField, Frame } from '../../../ui/index.ts'
import { addCalendarDays, dateKeyIn, zonedMidnight } from '../calendar.ts'
import {
  ACCOMMODATION_TYPES,
  BOOKING_PROVIDERS,
  CANCELLATION_POLICY_TYPES,
  CHARGE_TYPES,
  DOCUMENT_TYPES,
  GENDERS,
  ROOM_STATUSES,
  ROOM_VIEW_TYPES,
} from '../types.ts'

export {
  badge,
  CardGrid,
  code,
  dataTable,
  DatePicker,
  DefinitionList,
  emptyState,
  formatDateTime,
  formatMoney,
  FormCluster,
  RecordScreen,
  icon,
  inline,
  linkButton,
  MediaPanel,
  Metric,
  modalForm,
  ModalSheet,
  modalWorkspace,
  Notice,
  person,
  RecordActions,
  RecordForm,
  RecordWorkspace,
  ScheduleBoard,
  Section,
  stack,
  Surface,
  WorkspaceScreen,
  addCalendarDays,
  dateKeyIn,
  zonedMidnight,
  ACCOMMODATION_TYPES,
  BOOKING_PROVIDERS,
  CHARGE_TYPES,
  DOCUMENT_TYPES,
  GENDERS,
  ROOM_STATUSES,
  ROOM_VIEW_TYPES,
}
export type { Translator, TemplateResult, Column, FormField, Frame }

export const providerName = (_: Translator, provider: string): string =>
  BOOKING_PROVIDERS.includes(provider as (typeof BOOKING_PROVIDERS)[number])
    ? _(`hospitality_core.provider.${provider}`)
    : provider.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

export type PropertyRow = {
  id: string
  companyId?: string
  branchId?: string | null
  code: string
  name: string
  accommodationType: string
  starRating: number
  city?: string | null
  country?: string | null
  addressLine?: string | null
  publicName?: string | null
  description?: string | null
  active: boolean
  rooms: number
  availableRooms: number
  attentionRooms: number
}

export type PropertyDetail = {
  id: string
  companyId: string
  branchId?: string | null
  code: string
  name: string
  publicName?: string | null
  accommodationType: string
  timezone: string
  defaultCheckIn: string
  defaultCheckOut: string
  enforceTimes: boolean
  allowHourly?: boolean | null
  allowWeekly?: boolean | null
  allowMonthly?: boolean | null
  longStayBillOnCheckIn?: boolean | null
  starRating: number
  street1?: string | null
  street2?: string | null
  locality?: string | null
  postalCode?: string | null
  countryCode?: string | null
  countryId?: string | null
  divisionId?: string | null
  divisionText?: string | null
  addressLine?: string | null
  latitude?: string | number | null
  longitude?: string | number | null
  description?: string | null
  houseRules?: string | null
  childrenStayFree: boolean
  minimumGuestAge?: number | null
  defaultCancellationPolicyId?: string | null
  defaultCancellationPolicy?: { code?: string; name?: string } | null
  active: boolean
  buildings?: Array<{ id?: string }>
  floors?: Array<{ id?: string }>
  roomTypes?: Array<{ id?: string }>
  rooms?: RoomRow[]
  contacts?: Array<{ id?: string }>
}

export type PropertyFormValues = Pick<
  PropertyDetail,
  | 'id'
  | 'branchId'
  | 'code'
  | 'name'
  | 'publicName'
  | 'accommodationType'
  | 'timezone'
  | 'defaultCheckIn'
  | 'defaultCheckOut'
  | 'enforceTimes'
  | 'allowHourly'
  | 'allowWeekly'
  | 'allowMonthly'
  | 'longStayBillOnCheckIn'
  | 'starRating'
  | 'description'
  | 'houseRules'
  | 'childrenStayFree'
  | 'minimumGuestAge'
  | 'defaultCancellationPolicyId'
>

export type BranchChoice = {
  id: string
  code: string
  name: string
  active: boolean
}

export type BuildingRow = {
  id: string
  propertyId: string
  code: string
  name: string
  sequence: number
  active: boolean
  floors?: Array<{ id?: string; active?: boolean }>
  rooms?: Array<{ id?: string; active?: boolean }>
}

export type BuildingDetail = BuildingRow & {
  property?: { code?: string; name?: string; active?: boolean } | null
  floors: FloorRow[]
  rooms: RoomRow[]
}

export type BuildingFormValues = Pick<BuildingRow, 'id' | 'propertyId' | 'code' | 'name' | 'sequence'>

export type FloorRow = {
  id: string
  propertyId: string
  buildingId: string
  code: string
  name: string
  sequence: number
  active: boolean
  building?: { code?: string; name?: string } | null
  rooms?: Array<{ id?: string; active?: boolean }>
}

export type FloorDetail = FloorRow & {
  property?: { code?: string; name?: string; active?: boolean } | null
  building?: { id?: string; code?: string; name?: string; active?: boolean } | null
  rooms: RoomRow[]
}

export type FloorFormValues = Pick<
  FloorRow,
  'id' | 'propertyId' | 'buildingId' | 'code' | 'name' | 'sequence'
>

export type RoomRow = {
  id: string
  propertyId: string
  code: string
  name: string
  roomTypeId: string
  buildingId?: string | null
  floorId?: string | null
  capacity: number
  status: string
  note?: string | null
  active: boolean
  roomType?: { code?: string; name?: string } | null
  property?: { code?: string; name?: string } | null
  building?: { code?: string; name?: string } | null
  floor?: { code?: string; name?: string } | null
  currentStay?: {
    id?: string
    code?: string
    checkIn?: string
    checkOut?: string
    partner?: { name?: string } | null
  } | null
}

export type RoomDetail = RoomRow & {
  property?: { id?: string; code?: string; name?: string } | null
  roomType?: { id?: string; code?: string; name?: string } | null
  building?: { id?: string; code?: string; name?: string } | null
  floor?: { id?: string; code?: string; name?: string } | null
}

export type RoomFormValues = Pick<
  RoomDetail,
  'id' | 'propertyId' | 'roomTypeId' | 'buildingId' | 'floorId' | 'code' | 'name' | 'capacity'
>

export type RoomStatusSummary = {
  available: number
  occupied: number
  dirty: number
  cleaning: number
  maintenance: number
  outOfOrder: number
}

export type RoomTypeRow = {
  id: string
  propertyId?: string
  code: string
  name: string
  publicName?: string | null
  description?: string | null
  defaultCapacity: number
  maxAdults?: number
  maxChildren?: number
  maxInfants?: number
  maxExtraBeds?: number
  sizeSqm?: string | number | null
  viewType?: string | null
  sharedBathroom?: boolean
  baseRate: string | number
  published: boolean
  active: boolean
  rooms?: unknown[]
}

export type RoomTypeDetail = Omit<
  RoomTypeRow,
  'propertyId' | 'maxAdults' | 'maxChildren' | 'maxInfants' | 'maxExtraBeds' | 'viewType' | 'sharedBathroom'
> & {
  propertyId: string
  maxAdults: number
  maxChildren: number
  maxInfants: number
  maxExtraBeds: number
  viewType?: string | null
  sharedBathroom: boolean
  allowHourly?: boolean | null
  allowWeekly?: boolean | null
  allowMonthly?: boolean | null
  minHourlyHours?: number | null
  color?: string | null
  cancellationPolicyId?: string | null
  property?: { id?: string; code?: string; name?: string } | null
  rooms?: RoomRow[]
  beds?: Array<{ id?: string; type?: string; quantity?: number }>
  ratePlans?: Array<{ id?: string; code?: string; name?: string; active?: boolean }>
  cancellationPolicy?: { id?: string; code?: string; name?: string } | null
}

export type RoomTypeFormValues = Pick<
  RoomTypeDetail,
  | 'id'
  | 'propertyId'
  | 'code'
  | 'name'
  | 'publicName'
  | 'description'
  | 'defaultCapacity'
  | 'maxAdults'
  | 'maxChildren'
  | 'maxInfants'
  | 'maxExtraBeds'
  | 'sizeSqm'
  | 'viewType'
  | 'sharedBathroom'
  | 'allowHourly'
  | 'allowWeekly'
  | 'allowMonthly'
  | 'minHourlyHours'
  | 'baseRate'
  | 'color'
  | 'cancellationPolicyId'
  | 'published'
>

export type ContentImageRow = {
  id: string
  attachmentId: string
  propertyId?: string | null
  roomTypeId?: string | null
  category: string
  caption?: string | null
  sequence: number
  primary: boolean
  attachment?: { id?: string; name?: string } | null
}

export type ContentCompleteness = {
  completed: number
  total: number
  percent: number
}

export type NightAuditPreview = {
  propertyId: string
  auditDate: string
  inHouseCount: number
  serviceDue: number
  rentDue: number
  existingCount: number
  estimatedAmount: string | number
}

export type NightAuditRow = {
  id: string
  propertyId: string
  auditDate: string
  state: string
  inHouseCount: number
  servicePosted: number
  rentPosted: number
  existingCount: number
  totalAmount: string | number
  attempt: number
  requestedAt: string
  startedAt?: string | null
  completedAt?: string | null
  error?: string | null
}

export type StayNoticeRow = {
  id: string
  propertyId: string
  stayId: string
  stayGuestId: string
  state: string
  reason?: string | null
  dueAt: string
  guestName: string
  documentType?: string | null
  documentLast4?: string | null
  issueCodes: string[]
  attempt: number
  preparedAt?: string | null
  submissionChannel?: string | null
  submittedAt?: string | null
  submittedBy?: string | null
  receiptRef?: string | null
  confirmedAt?: string | null
  confirmedBy?: string | null
}

export type AmenityRow = { id: string; code: string; name: string; scope: string }
export type PolicyRow = {
  id: string
  code: string
  name: string
  type: string
  freeCancellationHours: number
  penaltyPercent: string | number
}

export type RatePlanRow = {
  id: string
  propertyId: string
  roomTypeId: string
  code: string
  name: string
  rateType: string
  amount: string | number
  isDefault: boolean
  mealPlan?: string | null
  minStay: number
  maxStay: number
  active: boolean
  roomType?: { code?: string; name?: string } | null
}

export type InventoryRow = {
  id: string
  propertyId: string
  roomTypeId: string
  date: string
  total: number
  sold: number
  blocked: number
  available: number
  minLos: number
  maxLos: number
  closedToArrival: boolean
  closedToDeparture: boolean
  stopSell: boolean
  persisted: boolean
}

export type CleaningTaskRow = {
  id: string
  code: string
  propertyId: string
  roomId: string
  stayId?: string | null
  taskType: string
  priority: string
  state: string
  requestedAt: string
  startedAt?: string | null
  doneAt?: string | null
  notes?: string | null
  room?: { code?: string; name?: string; status?: string } | null
  property?: { code?: string; name?: string } | null
  stay?: { code?: string } | null
  assigneeId?: string | null
}

export type CleaningTaskSummary = {
  todo: number
  inProgress: number
  done: number
  cancelled: number
}

export type ReservationRow = {
  id: string
  code: string
  partnerId: string
  provider: string
  roomTypeId: string
  bookingType: string
  checkIn: string
  checkOut: string
  adults: number
  children: number
  amountTotal: string | number
  state: string
  partner?: { name?: string } | null
  roomType?: { name?: string } | null
}

export type ReservationDetail = ReservationRow & {
  propertyId: string
  folioId: string
  stayId?: string | null
  billingMode: string
  rate: string | number
  quantity: string | number
  cancelReason?: string | null
  noShowAt?: string | null
  noShowReason?: string | null
  createdAt: string
  updatedAt: string
  folio?: { code?: string; state?: string } | null
  stay?: StayRow | null
}

export type ReservationQuote = {
  ok: boolean
  ratePlanId?: string | null
  bookingType?: string | null
  billingMode?: string | null
  checkIn?: string | null
  checkOut?: string | null
  rate?: string | number | null
  quantity?: string | number | null
  amountTotal?: string | number | null
  minimumAvailable?: number | null
  errors?: Array<{ messageKey?: string; params?: Record<string, unknown> }>
}

export type ReservationIntakeValues = {
  id: string
  code: string
  propertyId: string
  roomTypeId: string
  partnerId: string
  bookingType: string
  checkIn: string
  checkOut: string
  adults: number
  children: number
  rate: string
}

export type ReservationAmendmentValues = {
  partnerId: string
  roomTypeId: string
  checkIn: string
  checkOut: string
  adults: number
  children: number
  rate: string
}

export type StayRow = {
  id: string
  code: string
  folioId: string
  propertyId: string
  reservationId?: string | null
  partnerId: string
  roomTypeId: string
  currentRoomId?: string | null
  bookingType: string
  checkIn: string
  checkOut: string
  adults: number
  children: number
  billingMode: string
  rate: string | number
  nextBillDate?: string | null
  state: string
  checkedInAt?: string | null
  checkedOutAt?: string | null
  partner?: { name?: string } | null
  roomType?: { name?: string } | null
  currentRoom?: { name?: string; code?: string } | null
  reservation?: { id?: string; code?: string } | null
  assignments?: StayAssignmentRow[]
  guests?: StayGuestRow[]
}

export type StayAssignmentRow = {
  id: string
  roomId: string
  roomTypeId: string
  startAt: string
  endAt?: string | null
  state: string
  reason?: string | null
  roomName?: string
}

export type StayGuestRow = {
  id: string
  partnerId?: string | null
  displayName: string
  primary: boolean
}

export type GuestDocumentRow = {
  id: string
  stayId?: string | null
  partnerId: string
  type: string
  numberLast4?: string | null
  fullName: string
  nationality?: string | null
  ocrState: string
  dateOfBirthPresent: boolean
}

export type FolioRow = {
  id: string
  code: string
  propertyId: string
  partnerId: string
  state: string
  amountTotal: string | number
  version: number
  openedAt: string
  closedAt?: string | null
  partner?: { name?: string } | null
  stays?: FolioStayRow[]
  charges?: FolioChargeRow[]
}

export type FolioStayRow = {
  id: string
  code: string
  currentRoomId?: string | null
  checkIn: string
  checkOut: string
  state: string
}

export type FolioChargeRow = {
  id: string
  stayId?: string | null
  description: string
  type: string
  quantity: string | number
  unitPrice: string | number
  amount: string | number
  occurredAt: string
  state: string
  voidedAt?: string | null
  voidReason?: string | null
}

export type PropertyChargeRow = {
  id: string
  propertyId: string
  chargeType: string
  name: string
  amount: string | number
  description?: string | null
  active: boolean
}

export type ServiceProductRow = {
  id: string
  code?: string | null
  name: string
  unitPrice: string | number
  uomId?: string | null
}

export type ExtraLineRow = {
  id: string
  reservationId?: string | null
  stayId?: string | null
  folioId: string
  propertyId: string
  productId: string
  uomId?: string | null
  description: string
  quantity: string | number
  unitPrice: string | number
  recurrence: string
  active: boolean
  productName: string
  productCode?: string | null
  reservation?: { code?: string } | null
  stay?: { code?: string } | null
  materializedCount: number
  materializedAmount: string | number
}

export type ServiceChargeRow = {
  id: string
  folioId: string
  stayId?: string | null
  extraLineId: string
  description: string
  quantity: string | number
  unitPrice: string | number
  amount: string | number
  occurredAt: string
  serviceDate?: string | null
  state: string
  productName: string
  folio?: { code?: string } | null
  stay?: { code?: string } | null
}

export type TapeChart = {
  timezone: string
  from: string
  to: string
  rooms: Array<RoomRow & { roomType?: { name?: string } | null }>
  events: Array<{
    id: string
    stayId: string
    roomId?: string | null
    guest: string
    provider: string
    state: string
    start: string
    end: string
  }>
}

export const statusTone = (status: string): 'positive' | 'warning' | 'danger' | 'info' | 'neutral' => {
  if (status === 'available') return 'positive'
  if (status === 'dirty' || status === 'cleaning') return 'warning'
  if (status === 'maintenance' || status === 'out_of_order') return 'danger'
  if (status === 'occupied') return 'info'
  return 'neutral'
}

export const workflowTone = (status: string): 'positive' | 'warning' | 'danger' | 'info' | 'neutral' => {
  if (status === 'confirmed' || status === 'checked_in' || status === 'open') return 'positive'
  if (status === 'draft') return 'warning'
  if (status === 'cancelled' || status === 'no_show') return 'danger'
  if (status === 'checked_out' || status === 'closed') return 'neutral'
  return 'info'
}

export const cleaningTone = (state: string): 'positive' | 'warning' | 'danger' | 'info' | 'neutral' => {
  if (state === 'todo') return 'warning'
  if (state === 'in_progress') return 'info'
  if (state === 'done') return 'positive'
  return 'neutral'
}

export const noticeTone = (state: string): 'positive' | 'warning' | 'info' | 'neutral' => {
  if (state === 'attention') return 'warning'
  if (state === 'ready' || state === 'submitted') return 'info'
  if (state === 'confirmed') return 'positive'
  return 'neutral'
}

export const calendarDate = (value: string, locale: string, timezone: string): string =>
  formatDateTime(locale, new Date(value), {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
  })

export const dateTime = (value: string, locale: string, timezone: string): string =>
  formatDateTime(locale, new Date(value), {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

export const guestName = (row: { partnerId: string; partner?: { name?: string } | null }): string =>
  row.partner?.name ?? row.partnerId

export const propertyColumns = (_: Translator): Array<Column<PropertyRow>> => [
  { key: 'code', label: _('hospitality_core.col.code'), cell: (row) => code(row.code), kind: 'identifier' },
  { key: 'name', label: _('hospitality_core.col.name'), cell: (row) => row.name, priority: 'primary' },
  {
    key: 'type',
    label: _('hospitality_core.col.type'),
    cell: (row) => badge(_(`hospitality_core.accommodation.${row.accommodationType}`)),
    kind: 'status',
  },
  {
    key: 'location',
    label: _('hospitality_core.col.location'),
    cell: (row) => row.addressLine || [row.city, row.country].filter(Boolean).join(', ') || '—',
  },
  {
    key: 'rooms',
    label: _('hospitality_core.col.rooms'),
    cell: (row) => String(row.rooms),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'stars',
    label: _('hospitality_core.col.stars'),
    cell: (row) => String(row.starRating),
    align: 'end',
    kind: 'number',
  },
]

export const roomColumns = (_: Translator): Array<Column<RoomRow>> => [
  { key: 'code', label: _('hospitality_core.col.code'), cell: (row) => code(row.code), kind: 'identifier' },
  { key: 'name', label: _('hospitality_core.col.name'), cell: (row) => row.name, priority: 'primary' },
  {
    key: 'roomType',
    label: _('hospitality_core.col.roomType'),
    cell: (row) => row.roomType?.name ?? code(row.roomTypeId),
  },
  {
    key: 'location',
    label: _('hospitality_core.col.location'),
    cell: (row) =>
      [row.building?.name ?? row.building?.code, row.floor?.name ?? row.floor?.code]
        .filter(Boolean)
        .join(' · ') || '—',
  },
  {
    key: 'capacity',
    label: _('hospitality_core.col.capacity'),
    cell: (row) => String(row.capacity),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'status',
    label: _('hospitality_core.col.status'),
    cell: (row) => badge(_(`hospitality_core.roomStatus.${row.status}`), statusTone(row.status), row.status),
    kind: 'status',
    priority: 'primary',
  },
]

export const buildingColumns = (_: Translator): Array<Column<BuildingRow>> => [
  { key: 'code', label: _('hospitality_core.col.code'), cell: (row) => code(row.code), kind: 'identifier' },
  { key: 'name', label: _('hospitality_core.col.name'), cell: (row) => row.name, priority: 'primary' },
  {
    key: 'floors',
    label: _('hospitality_core.room.metric.floors'),
    cell: (row) => String(row.floors?.filter((floor) => floor.active !== false).length ?? 0),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'rooms',
    label: _('hospitality_core.col.rooms'),
    cell: (row) => String(row.rooms?.filter((room) => room.active !== false).length ?? 0),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'active',
    label: _('hospitality_core.col.status'),
    cell: (row) =>
      badge(
        _(row.active ? 'hospitality_core.value.active' : 'hospitality_core.value.inactive'),
        row.active ? 'positive' : 'neutral',
      ),
    kind: 'status',
  },
]

export const floorColumns = (_: Translator): Array<Column<FloorRow>> => [
  { key: 'code', label: _('hospitality_core.col.code'), cell: (row) => code(row.code), kind: 'identifier' },
  { key: 'name', label: _('hospitality_core.col.name'), cell: (row) => row.name, priority: 'primary' },
  {
    key: 'building',
    label: _('hospitality_core.room.field.building'),
    cell: (row) => row.building?.name ?? row.building?.code ?? code(row.buildingId),
  },
  {
    key: 'sequence',
    label: _('hospitality_core.room.field.sequence'),
    cell: (row) => String(row.sequence),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'rooms',
    label: _('hospitality_core.col.rooms'),
    cell: (row) => String(row.rooms?.filter((room) => room.active !== false).length ?? 0),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'active',
    label: _('hospitality_core.col.status'),
    cell: (row) =>
      badge(
        _(row.active ? 'hospitality_core.value.active' : 'hospitality_core.value.inactive'),
        row.active ? 'positive' : 'neutral',
      ),
    kind: 'status',
  },
]

export const roomTypeColumns = (_: Translator): Array<Column<RoomTypeRow>> => [
  { key: 'code', label: _('hospitality_core.col.code'), cell: (row) => code(row.code), kind: 'identifier' },
  { key: 'name', label: _('hospitality_core.col.name'), cell: (row) => row.name, priority: 'primary' },
  {
    key: 'capacity',
    label: _('hospitality_core.col.capacity'),
    cell: (row) => String(row.defaultCapacity),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'rooms',
    label: _('hospitality_core.col.rooms'),
    cell: (row) => String(row.rooms?.length ?? 0),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'baseRate',
    label: _('hospitality_core.col.baseRate'),
    cell: (row) => formatMoney(_, row.baseRate),
    align: 'end',
    kind: 'currency',
  },
  {
    key: 'published',
    label: _('hospitality_core.col.published'),
    cell: (row) =>
      badge(
        _(row.published ? 'hospitality_core.value.yes' : 'hospitality_core.value.no'),
        row.published ? 'positive' : 'neutral',
      ),
    kind: 'status',
  },
]

export const amenityColumns = (_: Translator): Array<Column<AmenityRow>> => [
  { key: 'code', label: _('hospitality_core.col.code'), cell: (row) => code(row.code), kind: 'identifier' },
  { key: 'name', label: _('hospitality_core.col.name'), cell: (row) => row.name, priority: 'primary' },
  {
    key: 'scope',
    label: _('hospitality_core.col.scope'),
    cell: (row) => badge(_(`hospitality_core.amenityScope.${row.scope}`)),
    kind: 'status',
  },
]

export const policyColumns = (_: Translator): Array<Column<PolicyRow>> => [
  { key: 'code', label: _('hospitality_core.col.code'), cell: (row) => code(row.code), kind: 'identifier' },
  { key: 'name', label: _('hospitality_core.col.name'), cell: (row) => row.name, priority: 'primary' },
  {
    key: 'policy',
    label: _('hospitality_core.col.policy'),
    cell: (row) => badge(_(`hospitality_core.policy.${row.type}`)),
    kind: 'status',
  },
  {
    key: 'freeCancellation',
    label: _('hospitality_core.col.freeCancellation'),
    cell: (row) => _('hospitality_core.value.hours', { count: row.freeCancellationHours }),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'penalty',
    label: _('hospitality_core.col.penalty'),
    cell: (row) => _('hospitality_core.value.percent', { count: Number(row.penaltyPercent) }),
    align: 'end',
    kind: 'number',
  },
]

export const ratePlanColumns = (_: Translator): Array<Column<RatePlanRow>> => [
  { key: 'code', label: _('hospitality_core.col.code'), cell: (row) => code(row.code), kind: 'identifier' },
  { key: 'name', label: _('hospitality_core.col.name'), cell: (row) => row.name, priority: 'primary' },
  {
    key: 'roomType',
    label: _('hospitality_core.col.roomType'),
    cell: (row) => row.roomType?.name ?? row.roomType?.code ?? code(row.roomTypeId),
  },
  {
    key: 'rateType',
    label: _('hospitality_core.col.rateType'),
    cell: (row) => badge(_(`hospitality_core.bookingType.${row.rateType}`)),
    kind: 'status',
  },
  {
    key: 'amount',
    label: _('hospitality_core.col.amount'),
    cell: (row) => formatMoney(_, row.amount),
    align: 'end',
    kind: 'currency',
  },
  {
    key: 'mealPlan',
    label: _('hospitality_core.col.mealPlan'),
    cell: (row) => (row.mealPlan ? _(`hospitality_core.mealPlan.${row.mealPlan}`) : '—'),
  },
  {
    key: 'los',
    label: _('hospitality_core.col.los'),
    cell: (row) => `${row.minStay || '—'} / ${row.maxStay || '∞'}`,
    align: 'end',
    kind: 'number',
  },
  {
    key: 'default',
    label: _('hospitality_core.col.default'),
    cell: (row) =>
      badge(
        _(row.isDefault ? 'hospitality_core.value.yes' : 'hospitality_core.value.no'),
        row.isDefault ? 'positive' : 'neutral',
      ),
    kind: 'status',
  },
  {
    key: 'active',
    label: _('hospitality_core.col.status'),
    cell: (row) =>
      badge(
        _(row.active ? 'hospitality_core.value.active' : 'hospitality_core.value.inactive'),
        row.active ? 'positive' : 'neutral',
      ),
    kind: 'status',
  },
]

export const inventoryColumns = (_: Translator): Array<Column<InventoryRow>> => [
  { key: 'date', label: _('hospitality_core.col.date'), cell: (row) => row.date, kind: 'date' },
  {
    key: 'total',
    label: _('hospitality_core.col.total'),
    cell: (row) => String(row.total),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'sold',
    label: _('hospitality_core.col.sold'),
    cell: (row) => String(row.sold),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'blocked',
    label: _('hospitality_core.col.blocked'),
    cell: (row) => String(row.blocked),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'available',
    label: _('hospitality_core.col.available'),
    cell: (row) => String(row.available),
    align: 'end',
    kind: 'number',
    priority: 'primary',
  },
  {
    key: 'los',
    label: _('hospitality_core.col.los'),
    cell: (row) => `${row.minLos || '—'} / ${row.maxLos || '∞'}`,
    align: 'end',
    kind: 'number',
  },
  {
    key: 'restrictions',
    label: _('hospitality_core.col.restrictions'),
    cell: (row) => {
      const values = [
        ...(row.stopSell ? [_('hospitality_core.restriction.stopSell')] : []),
        ...(row.closedToArrival ? ['CTA'] : []),
        ...(row.closedToDeparture ? ['CTD'] : []),
      ]
      return values.length
        ? badge(values.join(' · '), row.stopSell ? 'danger' : 'warning')
        : badge(_('hospitality_core.restriction.open'), 'positive')
    },
    kind: 'status',
  },
]

export const cleaningTaskColumns = (
  _: Translator,
  locale: string,
  timezone: string,
): Array<Column<CleaningTaskRow>> => [
  { key: 'code', label: _('hospitality_core.col.code'), cell: (row) => code(row.code), kind: 'identifier' },
  {
    key: 'room',
    label: _('hospitality_core.col.room'),
    cell: (row) => row.room?.name ?? row.room?.code ?? '—',
    priority: 'primary',
  },
  {
    key: 'status',
    label: _('hospitality_core.col.status'),
    cell: (row) =>
      badge(_(`hospitality_core.cleaningState.${row.state}`), cleaningTone(row.state), row.state),
    kind: 'status',
    priority: 'primary',
  },
  {
    key: 'priority',
    label: _('hospitality_core.col.priority'),
    cell: (row) =>
      badge(
        _(`hospitality_core.cleaningPriority.${row.priority}`),
        row.priority === 'urgent' ? 'danger' : 'neutral',
      ),
    kind: 'status',
  },
  {
    key: 'type',
    label: _('hospitality_core.col.type'),
    cell: (row) => _(`hospitality_core.cleaningType.${row.taskType}`),
  },
  {
    key: 'assignee',
    label: _('hospitality_core.col.assignee'),
    cell: (row) => row.assigneeId ?? '—',
  },
  {
    key: 'requestedAt',
    label: _('hospitality_core.col.requestedAt'),
    cell: (row) => dateTime(row.requestedAt, locale, timezone),
    kind: 'date',
  },
]

export const PROPERTY_TIMEZONES = [
  'Asia/Ho_Chi_Minh',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Jakarta',
  'Asia/Manila',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Europe/London',
  'America/New_York',
  'UTC',
] as const

export const propertyFormFields = (
  _: Translator,
  values: PropertyFormValues,
  policies: readonly PolicyRow[],
  branches: readonly BranchChoice[],
): FormField[] => {
  const timezones = [...new Set([values.timezone, ...PROPERTY_TIMEZONES])]
  return [
    { name: 'code', label: _('hospitality_core.property.field.code'), value: values.code, required: true },
    { name: 'name', label: _('hospitality_core.property.field.name'), value: values.name, required: true },
    {
      name: 'publicName',
      label: _('hospitality_core.property.field.publicName'),
      value: values.publicName,
      help: _('hospitality_core.property.field.publicNameHint'),
    },
    {
      name: 'branchId',
      label: _('hospitality_core.property.field.branch'),
      type: 'select',
      value: values.branchId,
      help: _('hospitality_core.property.field.branchHint'),
      options: [
        { value: '', label: _('hospitality_core.property.value.noBranch') },
        ...branches.map((branch) => ({
          value: branch.id,
          label: `${branch.code} · ${branch.name}`,
        })),
      ],
    },
    {
      name: 'accommodationType',
      label: _('hospitality_core.property.field.accommodationType'),
      type: 'select',
      value: values.accommodationType,
      required: true,
      options: ACCOMMODATION_TYPES.map((value) => ({
        value,
        label: _(`hospitality_core.accommodation.${value}`),
      })),
    },
    {
      name: 'starRating',
      label: _('hospitality_core.property.field.starRating'),
      type: 'number',
      value: values.starRating,
      required: true,
      step: '1',
      help: _('hospitality_core.property.field.starRatingHint'),
    },
    {
      name: 'timezone',
      label: _('hospitality_core.property.field.timezone'),
      type: 'select',
      value: values.timezone,
      required: true,
      options: timezones.map((value) => ({ value, label: value })),
    },
    {
      name: 'defaultCheckIn',
      label: _('hospitality_core.property.field.defaultCheckIn'),
      type: 'time',
      value: values.defaultCheckIn,
      required: true,
      step: '60',
    },
    {
      name: 'defaultCheckOut',
      label: _('hospitality_core.property.field.defaultCheckOut'),
      type: 'time',
      value: values.defaultCheckOut,
      required: true,
      step: '60',
    },
    {
      name: 'enforceTimes',
      label: _('hospitality_core.property.field.enforceTimes'),
      type: 'checkbox',
      value: values.enforceTimes,
      help: _('hospitality_core.property.field.enforceTimesHint'),
    },
    {
      name: 'allowHourly',
      label: _('hospitality_core.property.field.allowHourly'),
      type: 'checkbox',
      value: values.allowHourly !== false,
      help: _('hospitality_core.property.field.allowHourlyHint'),
    },
    {
      name: 'allowWeekly',
      label: _('hospitality_core.property.field.allowWeekly'),
      type: 'checkbox',
      value: values.allowWeekly === true,
      help: _('hospitality_core.property.field.allowWeeklyHint'),
    },
    {
      name: 'allowMonthly',
      label: _('hospitality_core.property.field.allowMonthly'),
      type: 'checkbox',
      value: values.allowMonthly === true,
      help: _('hospitality_core.property.field.allowMonthlyHint'),
    },
    {
      name: 'longStayBillOnCheckIn',
      label: _('hospitality_core.property.field.longStayBillOnCheckIn'),
      type: 'checkbox',
      value: values.longStayBillOnCheckIn === true,
      help: _('hospitality_core.property.field.longStayBillOnCheckInHint'),
    },
    {
      name: 'childrenStayFree',
      label: _('hospitality_core.property.field.childrenStayFree'),
      type: 'checkbox',
      value: values.childrenStayFree,
    },
    {
      name: 'minimumGuestAge',
      label: _('hospitality_core.property.field.minimumGuestAge'),
      type: 'number',
      value: values.minimumGuestAge,
      step: '1',
    },
    {
      name: 'defaultCancellationPolicyId',
      label: _('hospitality_core.property.field.defaultCancellationPolicy'),
      type: 'select',
      value: values.defaultCancellationPolicyId,
      options: [
        { value: '', label: _('hospitality_core.property.value.noDefaultPolicy') },
        ...choices(policies),
      ],
    },
    {
      name: 'description',
      label: _('hospitality_core.property.field.description'),
      type: 'textarea',
      value: values.description,
      span: 'full',
    },
    {
      name: 'houseRules',
      label: _('hospitality_core.property.field.houseRules'),
      type: 'textarea',
      value: values.houseRules,
      span: 'full',
    },
  ]
}

export const propertyForm = (
  _: Translator,
  values: PropertyFormValues,
  policies: readonly PolicyRow[],
  branches: readonly BranchChoice[],
  locale: string,
  action: string,
  submit: string,
  cancelHref: string,
): TemplateResult => (
  <RecordForm
    action={action}
    fields={propertyFormFields(_, values, policies, branches)}
    hidden={{ id: values.id, lang: locale }}
    submit={submit}
    submitVariant="primary"
    cancelHref={cancelHref}
    cancelLabel={_('hospitality_core.action.cancel')}
  />
)

export const propertyFeedback = (
  _: Translator,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult | null => {
  if (status === 'created' || status === 'saved')
    return (
      <Notice
        title={_(`hospitality_core.property.feedback.${status}`)}
        message={_('hospitality_core.property.feedback.savedHint')}
        tone="positive"
      />
    )
  if (errors.length)
    return <Notice title={_('hospitality_core.feedback.invalid')} message={errors.join(' ')} tone="danger" />
  return null
}

export const roomFeedback = (
  _: Translator,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult | null => {
  if (
    status === 'building-created' ||
    status === 'floor-created' ||
    status === 'created' ||
    status === 'saved' ||
    status === 'archived' ||
    status === 'restored'
  )
    return (
      <Notice
        title={_(`hospitality_core.room.feedback.${status}`)}
        message={_(
          status === 'archived' || status === 'restored'
            ? `hospitality_core.room.feedback.${status}Hint`
            : 'hospitality_core.room.feedback.savedHint',
        )}
        tone="positive"
      />
    )
  if (status === 'invalid' || errors.length)
    return (
      <Notice
        title={_('hospitality_core.feedback.invalid')}
        message={errors.join(' ') || _('hospitality_core.feedback.invalidHint')}
        tone="danger"
      />
    )
  return null
}

export const roomFormFields = (
  _: Translator,
  values: RoomFormValues,
  properties: readonly PropertyRow[],
  roomTypes: readonly RoomTypeRow[],
  buildings: readonly BuildingRow[],
  floors: readonly FloorRow[],
): FormField[] => [
  {
    name: 'propertyId',
    label: _('hospitality_core.room.field.property'),
    type: 'select',
    value: values.propertyId,
    options: choices(properties),
    required: true,
    disabled: true,
  },
  {
    name: 'roomTypeId',
    label: _('hospitality_core.room.field.roomType'),
    type: 'select',
    value: values.roomTypeId,
    options: choices(roomTypes),
    required: true,
  },
  {
    name: 'code',
    label: _('hospitality_core.room.field.code'),
    value: values.code,
    required: true,
    help: _('hospitality_core.room.field.codeHint'),
  },
  {
    name: 'name',
    label: _('hospitality_core.room.field.name'),
    value: values.name,
    required: true,
  },
  {
    name: 'buildingId',
    label: _('hospitality_core.room.field.building'),
    type: 'select',
    value: values.buildingId,
    options: [{ value: '', label: _('hospitality_core.room.value.noBuilding') }, ...choices(buildings)],
  },
  {
    name: 'floorId',
    label: _('hospitality_core.room.field.floor'),
    type: 'select',
    value: values.floorId,
    options: [
      { value: '', label: _('hospitality_core.room.value.noFloor') },
      ...floors.map((floor) => ({
        value: floor.id,
        label: `${floor.building?.name ?? floor.building?.code ?? ''}${floor.building ? ' · ' : ''}${floor.name}`,
      })),
    ],
    help: _('hospitality_core.room.field.floorHint'),
  },
  {
    name: 'capacity',
    label: _('hospitality_core.room.field.capacity'),
    type: 'number',
    value: values.capacity,
    required: true,
    step: '1',
  },
]

export const roomForm = (
  _: Translator,
  values: RoomFormValues,
  properties: readonly PropertyRow[],
  roomTypes: readonly RoomTypeRow[],
  buildings: readonly BuildingRow[],
  floors: readonly FloorRow[],
  locale: string,
  action: string,
  submit: string,
  cancelHref: string,
): TemplateResult => (
  <RecordForm
    action={action}
    fields={roomFormFields(_, values, properties, roomTypes, buildings, floors)}
    hidden={{
      lang: locale,
      propertyId: values.propertyId,
    }}
    submit={submit}
    submitVariant="primary"
    cancelHref={cancelHref}
    cancelLabel={_('hospitality_core.action.cancel')}
  />
)

export const locationFeedback = (
  _: Translator,
  resource: 'building' | 'floor',
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult | null => {
  if (status === 'saved' || status === 'archived' || status === 'restored')
    return (
      <Notice
        title={_(`hospitality_core.${resource}.feedback.${status}`)}
        message={_(`hospitality_core.${resource}.feedback.${status}Hint`)}
        tone="positive"
      />
    )
  if (errors.length)
    return <Notice title={_('hospitality_core.feedback.invalid')} message={errors.join(' ')} tone="danger" />
  return null
}

export const buildingForm = (_: Translator, values: BuildingFormValues, locale: string): TemplateResult => (
  <RecordForm
    action={`/admin/hospitality/buildings/${encodeURIComponent(values.id)}?lang=${encodeURIComponent(locale)}`}
    hidden={{ propertyId: values.propertyId }}
    submit={_('hospitality_core.building.action.save')}
    submitVariant="primary"
    fields={[
      {
        name: 'code',
        label: _('hospitality_core.building.field.code'),
        value: values.code,
        required: true,
      },
      {
        name: 'name',
        label: _('hospitality_core.building.field.name'),
        value: values.name,
        required: true,
      },
      {
        name: 'sequence',
        label: _('hospitality_core.building.field.sequence'),
        type: 'number',
        value: values.sequence,
        step: '1',
      },
    ]}
  />
)

export const floorForm = (_: Translator, values: FloorFormValues, locale: string): TemplateResult => (
  <RecordForm
    action={`/admin/hospitality/levels/${encodeURIComponent(values.id)}?lang=${encodeURIComponent(locale)}`}
    hidden={{ propertyId: values.propertyId, buildingId: values.buildingId }}
    submit={_('hospitality_core.floor.action.save')}
    submitVariant="primary"
    fields={[
      {
        name: 'code',
        label: _('hospitality_core.floor.field.code'),
        value: values.code,
        required: true,
      },
      {
        name: 'name',
        label: _('hospitality_core.floor.field.name'),
        value: values.name,
        required: true,
      },
      {
        name: 'sequence',
        label: _('hospitality_core.floor.field.sequence'),
        type: 'number',
        value: values.sequence,
        step: '1',
      },
    ]}
  />
)

export const cleaningTaskFeedback = (
  _: Translator,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult | null => {
  if (status === 'started' || status === 'completed' || status === 'cancelled')
    return (
      <Notice
        title={_(`hospitality_core.housekeeping.feedback.${status}`)}
        message={_(`hospitality_core.housekeeping.feedback.${status}Hint`)}
        tone={status === 'cancelled' ? 'warning' : 'positive'}
      />
    )
  if (errors.length)
    return <Notice title={_('hospitality_core.feedback.invalid')} message={errors.join(' ')} tone="danger" />
  return null
}

export const housekeepingRoomColumns = (_: Translator): Array<Column<RoomRow>> => [
  { key: 'code', label: _('hospitality_core.col.code'), cell: (row) => code(row.code), kind: 'identifier' },
  { key: 'name', label: _('hospitality_core.col.name'), cell: (row) => row.name, priority: 'primary' },
  {
    key: 'status',
    label: _('hospitality_core.col.status'),
    cell: (row) => badge(_(`hospitality_core.roomStatus.${row.status}`), statusTone(row.status), row.status),
    kind: 'status',
    priority: 'primary',
  },
  {
    key: 'roomType',
    label: _('hospitality_core.col.roomType'),
    cell: (row) => row.roomType?.name ?? row.roomType?.code ?? code(row.roomTypeId),
  },
  {
    key: 'location',
    label: _('hospitality_core.col.location'),
    cell: (row) =>
      [row.building?.name ?? row.building?.code, row.floor?.name ?? row.floor?.code]
        .filter(Boolean)
        .join(' · ') || '—',
  },
  {
    key: 'note',
    label: _('hospitality_core.housekeeping.field.notes'),
    cell: (row) => row.note || '—',
  },
]

export const housekeepingRoomFeedback = (
  _: Translator,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult | null => {
  if (status === 'updated')
    return (
      <Notice
        title={_('hospitality_core.housekeeping.rooms.feedback.updated')}
        message={_('hospitality_core.housekeeping.rooms.feedback.updatedHint')}
        tone="positive"
      />
    )
  if (errors.length)
    return <Notice title={_('hospitality_core.feedback.invalid')} message={errors.join(' ')} tone="danger" />
  return null
}

export const roomTypeFormFields = (
  _: Translator,
  values: RoomTypeFormValues,
  properties: readonly PropertyRow[],
  policies: readonly PolicyRow[],
  creating: boolean,
): FormField[] => [
  {
    name: 'propertyId',
    label: _('hospitality_core.roomType.field.property'),
    type: 'select',
    value: values.propertyId,
    options: choices(properties),
    required: true,
    disabled: !creating,
  },
  {
    name: 'code',
    label: _('hospitality_core.roomType.field.code'),
    value: values.code,
    required: true,
    help: _('hospitality_core.roomType.field.codeHint'),
  },
  {
    name: 'name',
    label: _('hospitality_core.roomType.field.name'),
    value: values.name,
    required: true,
  },
  {
    name: 'publicName',
    label: _('hospitality_core.roomType.field.publicName'),
    value: values.publicName,
  },
  {
    name: 'defaultCapacity',
    label: _('hospitality_core.roomType.field.defaultCapacity'),
    type: 'number',
    value: values.defaultCapacity,
    required: true,
    step: '1',
  },
  {
    name: 'maxAdults',
    label: _('hospitality_core.roomType.field.maxAdults'),
    type: 'number',
    value: values.maxAdults,
    required: true,
    step: '1',
  },
  {
    name: 'maxChildren',
    label: _('hospitality_core.roomType.field.maxChildren'),
    type: 'number',
    value: values.maxChildren,
    required: true,
    step: '1',
  },
  {
    name: 'maxInfants',
    label: _('hospitality_core.roomType.field.maxInfants'),
    type: 'number',
    value: values.maxInfants,
    required: true,
    step: '1',
  },
  {
    name: 'maxExtraBeds',
    label: _('hospitality_core.roomType.field.maxExtraBeds'),
    type: 'number',
    value: values.maxExtraBeds,
    required: true,
    step: '1',
  },
  {
    name: 'sizeSqm',
    label: _('hospitality_core.roomType.field.sizeSqm'),
    type: 'decimal',
    value: values.sizeSqm,
  },
  {
    name: 'viewType',
    label: _('hospitality_core.roomType.field.viewType'),
    type: 'select',
    value: values.viewType,
    options: [
      { value: '', label: _('hospitality_core.roomType.value.noViewType') },
      ...ROOM_VIEW_TYPES.map((value) => ({
        value,
        label: _(`hospitality_core.roomType.view.${value}`),
      })),
    ],
  },
  {
    name: 'sharedBathroom',
    label: _('hospitality_core.roomType.field.sharedBathroom'),
    type: 'checkbox',
    value: values.sharedBathroom,
  },
  {
    name: 'allowHourly',
    label: _('hospitality_core.roomType.field.allowHourly'),
    type: 'checkbox',
    value: values.allowHourly !== false,
    help: _('hospitality_core.roomType.field.allowHourlyHint'),
  },
  {
    name: 'minHourlyHours',
    label: _('hospitality_core.roomType.field.minHourlyHours'),
    type: 'number',
    value: values.minHourlyHours ?? 2,
    step: '1',
  },
  {
    name: 'allowWeekly',
    label: _('hospitality_core.roomType.field.allowWeekly'),
    type: 'checkbox',
    value: values.allowWeekly === true,
  },
  {
    name: 'allowMonthly',
    label: _('hospitality_core.roomType.field.allowMonthly'),
    type: 'checkbox',
    value: values.allowMonthly === true,
  },
  {
    name: 'baseRate',
    label: _('hospitality_core.roomType.field.baseRate'),
    type: 'decimal',
    value: values.baseRate,
    required: true,
    help: _('hospitality_core.roomType.field.baseRateHint'),
  },
  {
    name: 'color',
    label: _('hospitality_core.roomType.field.color'),
    type: 'color',
    value: values.color || '#2563eb',
  },
  {
    name: 'cancellationPolicyId',
    label: _('hospitality_core.roomType.field.cancellationPolicy'),
    type: 'select',
    value: values.cancellationPolicyId,
    options: [{ value: '', label: _('hospitality_core.roomType.value.inheritPolicy') }, ...choices(policies)],
  },
  {
    name: 'published',
    label: _('hospitality_core.roomType.field.published'),
    type: 'checkbox',
    value: values.published,
    help: _('hospitality_core.roomType.field.publishedHint'),
  },
  {
    name: 'description',
    label: _('hospitality_core.roomType.field.description'),
    type: 'textarea',
    value: values.description,
    span: 'full',
  },
]

export const roomTypeForm = (
  _: Translator,
  values: RoomTypeFormValues,
  properties: readonly PropertyRow[],
  policies: readonly PolicyRow[],
  locale: string,
  action: string,
  submit: string,
  cancelHref: string,
  creating: boolean,
): TemplateResult => (
  <RecordForm
    action={action}
    fields={roomTypeFormFields(_, values, properties, policies, creating)}
    hidden={{
      lang: locale,
      ...(!creating ? { propertyId: values.propertyId } : {}),
    }}
    submit={submit}
    submitVariant="primary"
    cancelHref={cancelHref}
    cancelLabel={_('hospitality_core.action.cancel')}
  />
)

export const roomTypeFeedback = (
  _: Translator,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult | null => {
  if (status === 'created' || status === 'saved')
    return (
      <Notice
        title={_(`hospitality_core.roomType.feedback.${status}`)}
        message={_('hospitality_core.roomType.feedback.savedHint')}
        tone="positive"
      />
    )
  if (errors.length)
    return <Notice title={_('hospitality_core.feedback.invalid')} message={errors.join(' ')} tone="danger" />
  return null
}

/**
 * An empty screen that names the missing prerequisite should also open it.
 * Telling an operator "create a property first" and then leaving them to find
 * the menu is how a set-up flow turns into a scavenger hunt.
 */
export const setupAction = (label: string, href: string): TemplateResult =>
  linkButton({ label, href, variant: 'primary' })

export const contentFeedback = (_: Translator, state?: string | null): TemplateResult | null => {
  if (state === 'saved')
    return (
      <Notice
        title={_('hospitality_core.content.feedback.saved')}
        message={_('hospitality_core.content.feedback.savedHint')}
        tone="positive"
      />
    )
  if (state === 'invalid')
    return (
      <Notice
        title={_('hospitality_core.content.feedback.invalid')}
        message={_('hospitality_core.content.feedback.invalidHint')}
        tone="danger"
      />
    )
  return null
}

export type Choice = { id: string; code?: string; name: string; propertyId?: string }

export const choices = (rows: readonly Choice[]) =>
  rows.map((row) => ({
    value: row.id,
    label: `${row.code ? `${row.code} · ` : ''}${row.name}`,
  }))

export const feedback = (_: Translator, state?: string | null): TemplateResult | null => {
  if (state === 'saved')
    return (
      <Notice
        title={_('hospitality_core.feedback.saved')}
        message={_('hospitality_core.feedback.savedHint')}
        tone="positive"
      />
    )
  if (state === 'invalid')
    return (
      <Notice
        title={_('hospitality_core.feedback.invalid')}
        message={_('hospitality_core.feedback.invalidHint')}
        tone="danger"
      />
    )
  return null
}

export const nightAuditFeedback = (_: Translator, state?: string | null): TemplateResult | null => {
  if (state === 'queued')
    return (
      <Notice
        title={_('hospitality_core.nightAudit.feedback.queued')}
        message={_('hospitality_core.nightAudit.feedback.queuedHint')}
        tone="positive"
      />
    )
  if (state === 'invalid')
    return (
      <Notice
        title={_('hospitality_core.feedback.invalid')}
        message={_('hospitality_core.nightAudit.feedback.invalidHint')}
        tone="danger"
      />
    )
  return null
}

export const nightAuditColumns = (_: Translator, locale: string): Array<Column<NightAuditRow>> => [
  {
    key: 'date',
    label: _('hospitality_core.nightAudit.col.date'),
    cell: (row) =>
      formatDateTime(locale, new Date(`${row.auditDate}T12:00:00Z`), {
        dateStyle: 'medium',
        timeZone: 'UTC',
      }),
    kind: 'date',
    priority: 'primary',
  },
  {
    key: 'status',
    label: _('hospitality_core.col.status'),
    cell: (row) =>
      badge(
        _(`hospitality_core.nightAudit.state.${row.state}`),
        row.state === 'completed'
          ? 'positive'
          : row.state === 'failed'
            ? 'danger'
            : row.state === 'running'
              ? 'warning'
              : 'info',
      ),
    kind: 'status',
  },
  {
    key: 'inHouse',
    label: _('hospitality_core.nightAudit.metric.inHouse'),
    cell: (row) => String(row.inHouseCount),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'services',
    label: _('hospitality_core.nightAudit.metric.services'),
    cell: (row) => String(row.servicePosted),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'rent',
    label: _('hospitality_core.nightAudit.metric.rent'),
    cell: (row) => String(row.rentPosted),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'amount',
    label: _('hospitality_core.col.amount'),
    cell: (row) => formatMoney(_, row.totalAmount),
    align: 'end',
    kind: 'currency',
  },
  {
    key: 'attempt',
    label: _('hospitality_core.nightAudit.col.attempt'),
    cell: (row) => String(row.attempt),
    align: 'end',
    kind: 'number',
  },
]

export const stayNoticeFeedback = (_: Translator, state?: string | null): TemplateResult | null => {
  if (state === 'refreshed' || state === 'submitted' || state === 'confirmed')
    return (
      <Notice
        title={_(`hospitality_core.stayNotice.feedback.${state}`)}
        message={_(`hospitality_core.stayNotice.feedback.${state}Hint`)}
        tone="positive"
      />
    )
  if (state === 'invalid')
    return (
      <Notice
        title={_('hospitality_core.feedback.invalid')}
        message={_('hospitality_core.stayNotice.feedback.invalidHint')}
        tone="danger"
      />
    )
  return null
}

export const stayNoticeStateTone = (state: string): 'danger' | 'warning' | 'info' | 'positive' =>
  state === 'attention'
    ? 'danger'
    : state === 'ready'
      ? 'warning'
      : state === 'submitted'
        ? 'info'
        : 'positive'

export const stayNoticeDocument = (_: Translator, row: StayNoticeRow): string => {
  if (!row.documentType || !row.documentLast4) return _('hospitality_core.stayNotice.value.missing')
  return `${_(`hospitality_core.document.${row.documentType}`)} · •••• ${row.documentLast4}`
}

export const stayNoticeIssues = (_: Translator, row: StayNoticeRow): string =>
  row.issueCodes.length
    ? row.issueCodes.map((item) => _(`hospitality_core.stayNotice.issue.${item}`)).join(', ')
    : _('hospitality_core.stayNotice.value.complete')

export const stayNoticeColumns = (
  _: Translator,
  locale: string,
  timezone: string,
): Array<Column<StayNoticeRow>> => [
  {
    key: 'guest',
    label: _('hospitality_core.stayNotice.col.guest'),
    cell: (row) => row.guestName,
    priority: 'primary',
    kind: 'person',
  },
  {
    key: 'document',
    label: _('hospitality_core.stayNotice.col.document'),
    cell: (row) => stayNoticeDocument(_, row),
    priority: 'secondary',
    kind: 'identifier',
  },
  {
    key: 'due',
    label: _('hospitality_core.stayNotice.col.due'),
    cell: (row) =>
      formatDateTime(locale, new Date(row.dueAt), {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }),
    priority: 'secondary',
    kind: 'date',
  },
  {
    key: 'state',
    label: _('hospitality_core.col.status'),
    cell: (row) => badge(_(`hospitality_core.stayNotice.state.${row.state}`), stayNoticeStateTone(row.state)),
    kind: 'status',
  },
  {
    key: 'issues',
    label: _('hospitality_core.stayNotice.col.readiness'),
    cell: (row) => stayNoticeIssues(_, row),
    priority: 'tertiary',
    optional: true,
  },
]

export const stayNoticeHref = (
  locale: string,
  propertyId: string,
  state: string,
  noticeId: string,
): string => {
  const query = new URLSearchParams({ lang: locale, property: propertyId, notice: noticeId })
  if (state !== 'all') query.set('state', state)
  return `/admin/hospitality/stay-notices?${query.toString()}`
}

export const stayNoticeAction = (
  _: Translator,
  selected: StayNoticeRow,
  locale: string,
  propertyId: string,
  state: string,
): TemplateResult | null => {
  const hidden = {
    lang: locale,
    id: selected.id,
    stayId: selected.stayId,
    property: propertyId,
    state,
  }
  if (selected.state === 'attention')
    return (
      <RecordForm
        action="/admin/hospitality/stay-notices"
        method="post"
        submit={_('hospitality_core.stayNotice.action.refresh')}
        submitVariant="secondary"
        hidden={{ ...hidden, operation: 'refresh' }}
        fields={[]}
      />
    )
  if (selected.state === 'ready')
    return (
      <RecordForm
        action="/admin/hospitality/stay-notices"
        method="post"
        submit={_('hospitality_core.stayNotice.action.recordSubmission')}
        submitVariant="primary"
        hidden={{ ...hidden, operation: 'record-submission' }}
        fields={[
          {
            name: 'reason',
            label: _('hospitality_core.stayNotice.field.reason'),
            type: 'select',
            value: selected.reason,
            required: true,
            options: [
              { value: '', label: _('hospitality_core.stayNotice.reason.select') },
              ...['tourism', 'business', 'family', 'other'].map((value) => ({
                value,
                label: _(`hospitality_core.stayNotice.reason.${value}`),
              })),
            ],
          },
          {
            name: 'channel',
            label: _('hospitality_core.stayNotice.field.channel'),
            type: 'select',
            required: true,
            options: ['online', 'vneid', 'email', 'phone', 'software'].map((value) => ({
              value,
              label: _(`hospitality_core.stayNotice.channel.${value}`),
            })),
          },
          {
            name: 'evidenceRef',
            label: _('hospitality_core.stayNotice.field.evidenceRef'),
            help: _('hospitality_core.stayNotice.field.evidenceRefHint'),
            required: true,
          },
        ]}
      />
    )
  if (selected.state === 'submitted')
    return (
      <RecordForm
        action="/admin/hospitality/stay-notices"
        method="post"
        submit={_('hospitality_core.stayNotice.action.confirm')}
        submitVariant="primary"
        hidden={{ ...hidden, operation: 'confirm' }}
        fields={[
          {
            name: 'receiptRef',
            label: _('hospitality_core.stayNotice.field.receiptRef'),
            value: selected.receiptRef,
            required: true,
          },
        ]}
      />
    )
  return null
}

export const propertyChargeColumns = (_: Translator): Array<Column<PropertyChargeRow>> => [
  {
    key: 'type',
    label: _('hospitality_core.col.type'),
    cell: (row) => badge(_(`hospitality_core.propertyCharge.${row.chargeType}`), 'info'),
    kind: 'status',
  },
  { key: 'name', label: _('hospitality_core.col.name'), cell: (row) => row.name, priority: 'primary' },
  {
    key: 'amount',
    label: _('hospitality_core.col.amount'),
    cell: (row) => formatMoney(_, row.amount),
    align: 'end',
    kind: 'currency',
  },
  {
    key: 'status',
    label: _('hospitality_core.col.status'),
    cell: (row) =>
      badge(
        _(row.active ? 'hospitality_core.value.active' : 'hospitality_core.value.inactive'),
        row.active ? 'positive' : 'neutral',
      ),
    kind: 'status',
  },
]

export const extraLineColumns = (_: Translator): Array<Column<ExtraLineRow>> => [
  {
    key: 'target',
    label: _('hospitality_core.services.col.target'),
    cell: (row) => code(row.reservation?.code ?? row.stay?.code ?? row.reservationId ?? row.stayId ?? '—'),
    kind: 'identifier',
  },
  {
    key: 'service',
    label: _('hospitality_core.services.col.service'),
    cell: (row) => `${row.productCode ? `${row.productCode} · ` : ''}${row.description}`,
    priority: 'primary',
  },
  {
    key: 'recurrence',
    label: _('hospitality_core.services.col.recurrence'),
    cell: (row) => badge(_(`hospitality_core.extraRecurrence.${row.recurrence}`), 'info'),
    kind: 'status',
  },
  {
    key: 'price',
    label: _('hospitality_core.services.col.unitPrice'),
    cell: (row) => `${row.quantity} × ${formatMoney(_, row.unitPrice)}`,
    align: 'end',
    kind: 'currency',
  },
  {
    key: 'posted',
    label: _('hospitality_core.services.col.materialized'),
    cell: (row) =>
      row.materializedCount
        ? badge(
            _('hospitality_core.services.value.posted', {
              count: row.materializedCount,
              amount: formatMoney(_, row.materializedAmount),
            }),
            'positive',
          )
        : badge(_('hospitality_core.services.value.pending'), 'warning'),
    kind: 'status',
  },
]

export const serviceChargeColumns = (
  _: Translator,
  locale: string,
  timezone: string,
): Array<Column<ServiceChargeRow>> => [
  {
    key: 'occurredAt',
    label: _('hospitality_core.col.date'),
    cell: (row) => row.serviceDate ?? dateTime(row.occurredAt, locale, timezone),
    kind: 'date',
  },
  {
    key: 'folio',
    label: _('hospitality_core.services.col.folio'),
    cell: (row) => code(row.folio?.code ?? row.folioId),
    kind: 'identifier',
  },
  {
    key: 'service',
    label: _('hospitality_core.services.col.service'),
    cell: (row) => row.description,
    priority: 'primary',
  },
  {
    key: 'quantity',
    label: _('hospitality_core.col.quantity'),
    cell: (row) => String(row.quantity),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'amount',
    label: _('hospitality_core.col.amount'),
    cell: (row) => formatMoney(_, row.amount),
    align: 'end',
    kind: 'currency',
  },
  {
    key: 'state',
    label: _('hospitality_core.col.status'),
    cell: (row) =>
      badge(_(`hospitality_core.chargeState.${row.state}`), row.state === 'active' ? 'positive' : 'neutral'),
    kind: 'status',
  },
]

/**
 * How long the guest is booked for, in the unit their booking is priced in.
 *
 * Two date columns made a reader subtract to learn the one number that decides
 * the price and the room-night, and calling every span "nights" would be wrong
 * for a booking sold by the hour.
 */
export const stayLength = (
  _: Translator,
  row: { bookingType: string; checkIn: string; checkOut: string },
  locale: string,
  timezone: string,
): string => {
  // The clock matters for a room sold by the hour. For a nightly stay both ends
  // are the property's own check-in and check-out times, the same on every row,
  // so printing them costs a line of wrapping and says nothing.
  const at = row.bookingType === 'hourly' ? dateTime : calendarDate
  const span = `${at(row.checkIn, locale, timezone)} – ${at(row.checkOut, locale, timezone)}`
  const ms = Date.parse(row.checkOut) - Date.parse(row.checkIn)
  if (!Number.isFinite(ms) || ms <= 0) return span
  const unit = { nightly: 86_400_000, hourly: 3_600_000, weekly: 604_800_000, monthly: 2_592_000_000 }[
    row.bookingType
  ]
  if (!unit) return span
  return `${span} · ${_(`hospitality_core.duration.${row.bookingType}`, { count: Math.max(1, Math.round(ms / unit)) })}`
}

export const reservationColumns = (
  _: Translator,
  locale: string,
  timezone: string,
): Array<Column<ReservationRow>> => [
  {
    key: 'code',
    label: _('hospitality_core.col.code'),
    cell: (row) =>
      linkButton({
        label: row.code,
        href: `/admin/hospitality/reservations/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
        variant: 'tertiary',
        size: 'compact',
      }),
    kind: 'identifier',
  },
  {
    key: 'guest',
    label: _('hospitality_core.col.guest'),
    cell: (row) => person(guestName(row)),
    kind: 'person',
    priority: 'primary',
  },
  {
    key: 'status',
    label: _('hospitality_core.col.status'),
    cell: (row) =>
      badge(_(`hospitality_core.reservationState.${row.state}`), workflowTone(row.state), row.state),
    kind: 'status',
    priority: 'primary',
  },
  {
    key: 'provider',
    label: _('hospitality_core.col.provider'),
    cell: (row) => badge(providerName(_, row.provider), 'neutral'),
    kind: 'status',
  },
  {
    key: 'roomType',
    label: _('hospitality_core.col.roomType'),
    cell: (row) => row.roomType?.name ?? code(row.roomTypeId),
  },
  {
    key: 'stay',
    label: _('hospitality_core.col.stayDates'),
    cell: (row) => stayLength(_, row, locale, timezone),
    kind: 'date',
  },
  {
    key: 'amount',
    label: _('hospitality_core.col.amount'),
    cell: (row) => formatMoney(_, row.amountTotal),
    align: 'end',
    kind: 'currency',
  },
]

/**
 * Still in the room after the hour they were due out.
 *
 * The front desk has said this since #358; the stay list is where somebody
 * looks across every stay rather than today's, and there it was invisible.
 */
export const overdue = (row: { state: string; checkOut: string }): boolean =>
  row.state === 'checked_in' && Date.parse(row.checkOut) < Date.now()

export const stayColumns = (_: Translator, locale: string, timezone: string): Array<Column<StayRow>> => [
  {
    key: 'code',
    label: _('hospitality_core.col.code'),
    cell: (row) =>
      linkButton({
        label: row.code,
        href: `/admin/hospitality/stays/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
        variant: 'tertiary',
        size: 'compact',
      }),
    kind: 'identifier',
  },
  {
    key: 'guest',
    label: _('hospitality_core.col.guest'),
    cell: (row) => person(guestName(row)),
    kind: 'person',
    priority: 'primary',
  },
  {
    key: 'status',
    label: _('hospitality_core.col.status'),
    cell: (row) => badge(_(`hospitality_core.stayState.${row.state}`), workflowTone(row.state), row.state),
    kind: 'status',
    priority: 'primary',
  },
  {
    key: 'room',
    label: _('hospitality_core.col.room'),
    cell: (row) => row.currentRoom?.name ?? row.currentRoom?.code ?? '—',
  },
  {
    key: 'stay',
    label: _('hospitality_core.col.stayDates'),
    // The overdue mark rides with the dates because that is what it is about,
    // and it is only true of somebody who is still in the room.
    cell: (row) =>
      overdue(row)
        ? inline([
            stayLength(_, row, locale, timezone),
            badge(_('hospitality_core.stayState.overdue'), 'danger', 'overdue'),
          ])
        : stayLength(_, row, locale, timezone),
    kind: 'date',
  },
  {
    key: 'guests',
    label: _('hospitality_core.col.guests'),
    cell: (row) => String(row.adults + row.children),
    align: 'end',
    kind: 'number',
  },
]

export const folioColumns = (_: Translator, locale: string, timezone: string): Array<Column<FolioRow>> => [
  {
    key: 'code',
    label: _('hospitality_core.col.code'),
    cell: (row) =>
      linkButton({
        label: row.code,
        href: `/admin/hospitality/folios/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
        variant: 'tertiary',
        size: 'compact',
      }),
    kind: 'identifier',
  },
  {
    key: 'guest',
    label: _('hospitality_core.col.guest'),
    cell: (row) => person(guestName(row)),
    kind: 'person',
    priority: 'primary',
  },
  {
    key: 'opened',
    label: _('hospitality_core.col.checkIn'),
    cell: (row) => dateTime(row.openedAt, locale, timezone),
    kind: 'date',
  },
  {
    key: 'stays',
    label: _('hospitality_core.col.stays'),
    cell: (row) => String(row.stays?.length ?? 0),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'amount',
    label: _('hospitality_core.col.amount'),
    cell: (row) => formatMoney(_, row.amountTotal),
    align: 'end',
    kind: 'currency',
  },
  {
    key: 'status',
    label: _('hospitality_core.col.status'),
    cell: (row) => badge(_(`hospitality_core.folioState.${row.state}`), workflowTone(row.state), row.state),
    kind: 'status',
    priority: 'primary',
  },
]

/**
 * What a charge is, in words, when its description is a machine key.
 *
 * Room nights and cancellation penalties are written by code, so their
 * description carries the reason rather than a sentence — `room:` and
 * `cancellation:` followed by why it was charged. The type column already says
 * what the charge is; this says why, and never shows the reader the key.
 */
export const chargeDescription = (_: Translator, charge: { type: string; description: string }): string => {
  if (charge.type === 'room' && charge.description.startsWith('room:'))
    return _('hospitality_core.folio.charge.roomDescription')
  if (charge.type === 'cancellation' && charge.description.startsWith('no_show:'))
    return _('hospitality_core.folio.charge.noShowDescription')
  if (charge.type === 'cancellation' && charge.description.startsWith('cancellation:')) {
    const reason = charge.description.slice('cancellation:'.length)
    if (reason === 'provider') return _('hospitality_core.folio.charge.cancellationByChannel')
    return CANCELLATION_POLICY_TYPES.includes(reason as (typeof CANCELLATION_POLICY_TYPES)[number])
      ? _(`hospitality_core.policy.${reason}`)
      : _('hospitality_core.folio.charge.cancellationByPolicy')
  }
  return charge.description
}

export const folioChargeColumns = (
  _: Translator,
  locale: string,
  timezone: string,
  stays: Map<string, FolioStayRow>,
): Array<Column<FolioChargeRow>> => [
  {
    key: 'occurred',
    label: _('hospitality_core.folio.charge.occurredAt'),
    cell: (row) => dateTime(row.occurredAt, locale, timezone),
    kind: 'date',
  },
  {
    key: 'description',
    label: _('hospitality_core.folio.charge.description'),
    cell: (row) => chargeDescription(_, row),
    priority: 'primary',
  },
  {
    key: 'type',
    label: _('hospitality_core.folio.charge.type'),
    cell: (row) => badge(_(`hospitality_core.charge.${row.type}`), 'info', row.type),
    kind: 'status',
  },
  {
    key: 'stay',
    label: _('hospitality_core.col.stays'),
    cell: (row) => (row.stayId ? code(stays.get(row.stayId)?.code ?? row.stayId) : '—'),
  },
  {
    key: 'quantity',
    label: _('hospitality_core.folio.charge.quantity'),
    cell: (row) => String(row.quantity),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'unit-price',
    label: _('hospitality_core.folio.charge.unitPrice'),
    cell: (row) => formatMoney(_, row.unitPrice),
    align: 'end',
    kind: 'currency',
  },
  {
    key: 'amount',
    label: _('hospitality_core.col.amount'),
    cell: (row) => formatMoney(_, row.amount),
    align: 'end',
    kind: 'currency',
  },
  {
    key: 'correction',
    label: _('hospitality_core.folio.field.voidReason'),
    cell: (row) => row.voidReason || '—',
  },
  {
    key: 'status',
    label: _('hospitality_core.col.status'),
    cell: (row) =>
      badge(
        _(`hospitality_core.chargeState.${row.state}`),
        row.state === 'active' ? 'positive' : 'neutral',
        row.state,
      ),
    kind: 'status',
  },
]

export const folioStayColumns = (
  _: Translator,
  locale: string,
  timezone: string,
): Array<Column<FolioStayRow>> => [
  {
    key: 'code',
    label: _('hospitality_core.col.code'),
    cell: (row) =>
      linkButton({
        label: row.code,
        href: `/admin/hospitality/stays/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
        variant: 'tertiary',
        size: 'compact',
      }),
    kind: 'identifier',
    priority: 'primary',
  },
  {
    key: 'check-in',
    label: _('hospitality_core.col.checkIn'),
    cell: (row) => dateTime(row.checkIn, locale, timezone),
    kind: 'date',
  },
  {
    key: 'check-out',
    label: _('hospitality_core.col.checkOut'),
    cell: (row) => dateTime(row.checkOut, locale, timezone),
    kind: 'date',
  },
  {
    key: 'status',
    label: _('hospitality_core.col.status'),
    cell: (row) => badge(_(`hospitality_core.stayState.${row.state}`), workflowTone(row.state), row.state),
    kind: 'status',
  },
]

export const reservationFeedback = (_: Translator, status?: string | null): TemplateResult | null => {
  if (status === 'saved')
    return (
      <Notice
        title={_('hospitality_core.reservation.feedback.saved')}
        message={_('hospitality_core.reservation.feedback.savedHint')}
        tone="positive"
      />
    )
  if (status === 'quoted')
    return (
      <Notice
        title={_('hospitality_core.reservation.feedback.quoted')}
        message={_('hospitality_core.reservation.feedback.quotedHint')}
        tone="info"
      />
    )
  if (status === 'invalid')
    return (
      <Notice
        title={_('hospitality_core.feedback.invalid')}
        message={_('hospitality_core.reservation.feedback.invalidHint')}
        tone="danger"
      />
    )
  return null
}

export const reservationDetailFeedback = (
  _: Translator,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult | null => {
  if (status === 'checked-in')
    return (
      <Notice
        title={_('hospitality_core.reservation.feedback.checkedIn')}
        message={_('hospitality_core.reservation.feedback.checkedInHint')}
        tone="positive"
      />
    )
  if (status === 'checked-out')
    return (
      <Notice
        title={_('hospitality_core.reservation.feedback.checkedOut')}
        message={_('hospitality_core.reservation.feedback.checkedOutHint')}
        tone="positive"
      />
    )
  if (status === 'checked-out-early')
    return (
      <Notice
        title={_('hospitality_core.reservation.feedback.checkedOutEarly')}
        message={_('hospitality_core.reservation.feedback.checkedOutEarlyHint')}
        tone="warning"
      />
    )
  if (status === 'cancelled')
    return (
      <Notice
        title={_('hospitality_core.reservation.feedback.cancelled')}
        message={_('hospitality_core.reservation.feedback.cancelledHint')}
        tone="warning"
      />
    )
  if (status === 'amended')
    return (
      <Notice
        title={_('hospitality_core.reservation.feedback.amended')}
        message={_('hospitality_core.reservation.feedback.amendedHint')}
        tone="positive"
      />
    )
  if (status === 'departure-adjusted')
    return (
      <Notice
        title={_('hospitality_core.reservation.feedback.departureAdjusted')}
        message={_('hospitality_core.reservation.feedback.departureAdjustedHint')}
        tone="positive"
      />
    )
  if (status === 'no-show')
    return (
      <Notice
        title={_('hospitality_core.reservation.feedback.noShow')}
        message={_('hospitality_core.reservation.feedback.noShowHint')}
        tone="warning"
      />
    )
  if (errors.length)
    return <Notice title={_('hospitality_core.feedback.invalid')} message={errors.join(' ')} tone="danger" />
  return null
}

export const stayAssignmentColumns = (
  _: Translator,
  locale: string,
  timezone: string,
): Array<Column<StayAssignmentRow>> => [
  {
    key: 'room',
    label: _('hospitality_core.stay.field.room'),
    cell: (row) => row.roomName ?? code(row.roomId),
    priority: 'primary',
  },
  {
    key: 'start',
    label: _('hospitality_core.stay.assignment.start'),
    cell: (row) => dateTime(row.startAt, locale, timezone),
    kind: 'date',
  },
  {
    key: 'end',
    label: _('hospitality_core.stay.assignment.end'),
    cell: (row) => (row.endAt ? dateTime(row.endAt, locale, timezone) : '—'),
    kind: 'date',
  },
  {
    key: 'reason',
    label: _('hospitality_core.stay.field.moveReason'),
    cell: (row) => row.reason || '—',
  },
  {
    key: 'state',
    label: _('hospitality_core.col.status'),
    cell: (row) =>
      badge(_(`hospitality_core.assignmentState.${row.state}`), workflowTone(row.state), row.state),
    kind: 'status',
  },
]

export const stayGuestColumns = (_: Translator): Array<Column<StayGuestRow>> => [
  {
    key: 'guest',
    label: _('hospitality_core.col.guest'),
    cell: (row) => person(row.displayName),
    kind: 'person',
    priority: 'primary',
  },
  {
    key: 'role',
    label: _('hospitality_core.stay.guest.role'),
    cell: (row) =>
      badge(
        row.primary ? _('hospitality_core.stay.guest.primary') : _('hospitality_core.stay.guest.companion'),
        row.primary ? 'positive' : 'neutral',
      ),
    kind: 'status',
  },
]

export const guestDocumentColumns = (_: Translator): Array<Column<GuestDocumentRow>> => [
  {
    key: 'name',
    label: _('hospitality_core.stay.document.fullName'),
    cell: (row) => person(row.fullName),
    kind: 'person',
    priority: 'primary',
  },
  {
    key: 'type',
    label: _('hospitality_core.stay.document.type'),
    cell: (row) => _(`hospitality_core.document.${row.type}`),
  },
  {
    key: 'number',
    label: _('hospitality_core.stay.document.number'),
    cell: (row) => (row.numberLast4 ? code(`•••• ${row.numberLast4}`) : '—'),
  },
  {
    key: 'nationality',
    label: _('hospitality_core.stay.document.nationality'),
    cell: (row) => row.nationality || '—',
  },
  {
    key: 'readiness',
    label: _('hospitality_core.stay.document.readiness'),
    cell: (row) =>
      badge(
        row.numberLast4 && row.dateOfBirthPresent
          ? _('hospitality_core.stay.document.ready')
          : _('hospitality_core.stay.document.attention'),
        row.numberLast4 && row.dateOfBirthPresent ? 'positive' : 'warning',
      ),
    kind: 'status',
  },
]

export const stayDetailFeedback = (
  _: Translator,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult | null => {
  if (status === 'guest-added')
    return (
      <Notice
        title={_('hospitality_core.stay.feedback.guestAdded')}
        message={_('hospitality_core.stay.feedback.guestAddedHint')}
        tone="positive"
      />
    )
  if (status === 'room-moved')
    return (
      <Notice
        title={_('hospitality_core.stay.feedback.roomMoved')}
        message={_('hospitality_core.stay.feedback.roomMovedHint')}
        tone="positive"
      />
    )
  if (status === 'document-saved')
    return (
      <Notice
        title={_('hospitality_core.stay.feedback.documentSaved')}
        message={_('hospitality_core.stay.feedback.documentSavedHint')}
        tone="positive"
      />
    )
  if (errors.length)
    return <Notice title={_('hospitality_core.feedback.invalid')} message={errors.join(' ')} tone="danger" />
  return null
}

export const folioDetailFeedback = (
  _: Translator,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult | null => {
  if (status === 'charge-posted')
    return (
      <Notice
        title={_('hospitality_core.folio.feedback.chargePosted')}
        message={_('hospitality_core.folio.feedback.chargePostedHint')}
        tone="positive"
      />
    )
  if (status === 'charge-voided')
    return (
      <Notice
        title={_('hospitality_core.folio.feedback.chargeVoided')}
        message={_('hospitality_core.folio.feedback.chargeVoidedHint')}
        tone="positive"
      />
    )
  if (errors.length)
    return <Notice title={_('hospitality_core.feedback.invalid')} message={errors.join(' ')} tone="danger" />
  return null
}
