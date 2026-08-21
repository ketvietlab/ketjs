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
  formatMoney,
  FormCluster,
  Framed,
  icon,
  linkButton,
  MediaPanel,
  Metric,
  Notice,
  person,
  RecordActions,
  RecordForm,
  RecordWorkspace,
  ScheduleBoard,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { Column, FormField, Frame } from '../../ui/index.ts'
import { addCalendarDays, dateKeyIn, zonedMidnight } from './calendar.ts'
import {
  ACCOMMODATION_TYPES,
  BOOKING_PROVIDERS,
  CHARGE_TYPES,
  DOCUMENT_TYPES,
  GENDERS,
  ROOM_STATUSES,
  ROOM_VIEW_TYPES,
} from './types.ts'

const providerName = (_: Translator, provider: string): string =>
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
  bookingType: string
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

const statusTone = (status: string): 'positive' | 'warning' | 'danger' | 'info' | 'neutral' => {
  if (status === 'available') return 'positive'
  if (status === 'dirty' || status === 'cleaning') return 'warning'
  if (status === 'maintenance' || status === 'out_of_order') return 'danger'
  if (status === 'occupied') return 'info'
  return 'neutral'
}

const workflowTone = (status: string): 'positive' | 'warning' | 'danger' | 'info' | 'neutral' => {
  if (status === 'confirmed' || status === 'checked_in' || status === 'open') return 'positive'
  if (status === 'draft') return 'warning'
  if (status === 'cancelled' || status === 'no_show') return 'danger'
  if (status === 'checked_out' || status === 'closed') return 'neutral'
  return 'info'
}

const cleaningTone = (state: string): 'positive' | 'warning' | 'danger' | 'info' | 'neutral' => {
  if (state === 'todo') return 'warning'
  if (state === 'in_progress') return 'info'
  if (state === 'done') return 'positive'
  return 'neutral'
}

const dateTime = (value: string, locale: string, timezone: string): string =>
  new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))

const guestName = (row: { partnerId: string; partner?: { name?: string } | null }): string =>
  row.partner?.name ?? row.partnerId

const propertyColumns = (_: Translator): Array<Column<PropertyRow>> => [
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

const roomColumns = (_: Translator): Array<Column<RoomRow>> => [
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

const buildingColumns = (_: Translator): Array<Column<BuildingRow>> => [
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

const floorColumns = (_: Translator): Array<Column<FloorRow>> => [
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

const roomTypeColumns = (_: Translator): Array<Column<RoomTypeRow>> => [
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

const amenityColumns = (_: Translator): Array<Column<AmenityRow>> => [
  { key: 'code', label: _('hospitality_core.col.code'), cell: (row) => code(row.code), kind: 'identifier' },
  { key: 'name', label: _('hospitality_core.col.name'), cell: (row) => row.name, priority: 'primary' },
  {
    key: 'scope',
    label: _('hospitality_core.col.scope'),
    cell: (row) => badge(_(`hospitality_core.amenityScope.${row.scope}`)),
    kind: 'status',
  },
]

const policyColumns = (_: Translator): Array<Column<PolicyRow>> => [
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

const ratePlanColumns = (_: Translator): Array<Column<RatePlanRow>> => [
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

const inventoryColumns = (_: Translator): Array<Column<InventoryRow>> => [
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

const cleaningTaskColumns = (
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

const PROPERTY_TIMEZONES = [
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

const propertyFormFields = (
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

const propertyForm = (
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

export const propertiesScreen = (
  _: Translator,
  rows: PropertyRow[],
  totals: { rooms: number; available: number; attention: number },
  locale: string,
  frame: Frame,
): TemplateResult => (
  <Framed
    translator={_}
    title={_('hospitality_core.screen.properties.title')}
    frame={frame}
    body={stack([
      linkButton({
        label: _('hospitality_core.property.action.create'),
        href: `/admin/hospitality/properties/new?lang=${encodeURIComponent(locale)}`,
        variant: 'primary',
      }),
      <CardGrid
        items={[
          { id: 'properties', label: _('hospitality_core.metric.properties'), value: rows.length },
          { id: 'rooms', label: _('hospitality_core.metric.rooms'), value: totals.rooms },
          { id: 'available', label: _('hospitality_core.metric.available'), value: totals.available },
          { id: 'attention', label: _('hospitality_core.metric.attention'), value: totals.attention },
        ]}
        id={(item) => item.id}
        card={(item) => <Metric label={item.label} value={String(item.value)} tone={item.id} />}
      />,
      rows.length
        ? dataTable(_, {
            columns: propertyColumns(_),
            rows,
            id: (row) => row.id,
            rowHref: (row) =>
              `/admin/hospitality/properties/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
          })
        : emptyState(
            _('hospitality_core.screen.properties.empty'),
            _('hospitality_core.screen.properties.emptyHint'),
          ),
    ])}
  />
)

const propertyFeedback = (
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

export const newPropertyScreen = (
  _: Translator,
  values: PropertyFormValues,
  policies: readonly PolicyRow[],
  branches: readonly BranchChoice[],
  locale: string,
  frame: Frame,
  errors: readonly string[] = [],
): TemplateResult => (
  <Framed
    translator={_}
    title={_('hospitality_core.property.create.title')}
    frame={frame}
    body={stack([
      propertyFeedback(_, null, errors),
      <Section
        title={_('hospitality_core.property.create.title')}
        description={_('hospitality_core.property.create.hint')}
        body={propertyForm(
          _,
          values,
          policies,
          branches,
          locale,
          `/admin/hospitality/properties/new?lang=${encodeURIComponent(locale)}`,
          _('hospitality_core.property.action.create'),
          `/admin/hospitality/properties?lang=${encodeURIComponent(locale)}`,
        )}
      />,
    ])}
  />
)

export const propertyDetailScreen = (
  _: Translator,
  property: PropertyDetail,
  policies: readonly PolicyRow[],
  branches: readonly BranchChoice[],
  locale: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
  attempted?: PropertyFormValues,
): TemplateResult => {
  const query = `lang=${encodeURIComponent(locale)}`
  const values = attempted ?? property
  const rooms = property.rooms ?? []
  return (
    <Framed
      translator={_}
      title={property.name}
      frame={frame}
      body={stack([
        propertyFeedback(_, status, errors),
        <RecordWorkspace
          kicker={_('hospitality_core.property.detail.kicker')}
          title={property.name}
          subtitle={`${property.code} · ${property.publicName || property.name}`}
          imageFallback={icon('hotel')}
          badges={[
            badge(_(`hospitality_core.accommodation.${property.accommodationType}`), 'info'),
            badge(
              _(property.active ? 'hospitality_core.value.active' : 'hospitality_core.value.inactive'),
              property.active ? 'positive' : 'neutral',
            ),
          ]}
          summary={[
            {
              id: 'rooms',
              label: _('hospitality_core.metric.rooms'),
              value: rooms.length,
              href: `/admin/hospitality/rooms?property=${encodeURIComponent(property.id)}&${query}`,
            },
            {
              id: 'room-types',
              label: _('hospitality_core.menu.roomTypes'),
              value: property.roomTypes?.length ?? 0,
              href: `/admin/hospitality/room-types?property=${encodeURIComponent(property.id)}&${query}`,
            },
            {
              id: 'buildings',
              label: _('hospitality_core.property.metric.buildings'),
              value: property.buildings?.length ?? 0,
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.property.action.back'),
            href: `/admin/hospitality/properties?${query}`,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.property.section.information')}
              description={_('hospitality_core.property.section.informationHint')}
              body={
                <DefinitionList
                  title={property.publicName || property.name}
                  items={[
                    {
                      key: 'address',
                      term: _('hospitality_core.property.field.address'),
                      value: property.addressLine || '—',
                    },
                    {
                      key: 'timezone',
                      term: _('hospitality_core.property.field.timezone'),
                      value: property.timezone,
                    },
                    {
                      key: 'check-in',
                      term: _('hospitality_core.property.field.defaultCheckIn'),
                      value: property.defaultCheckIn,
                    },
                    {
                      key: 'check-out',
                      term: _('hospitality_core.property.field.defaultCheckOut'),
                      value: property.defaultCheckOut,
                    },
                    {
                      key: 'policy',
                      term: _('hospitality_core.property.field.defaultCancellationPolicy'),
                      value:
                        property.defaultCancellationPolicy?.name ??
                        property.defaultCancellationPolicy?.code ??
                        _('hospitality_core.property.value.noDefaultPolicy'),
                    },
                  ]}
                />
              }
            />,
            <Section
              title={_('hospitality_core.property.section.settings')}
              description={_('hospitality_core.property.section.settingsHint')}
              body={propertyForm(
                _,
                values,
                policies,
                branches,
                locale,
                `/admin/hospitality/properties/${encodeURIComponent(property.id)}?${query}`,
                _('hospitality_core.property.action.save'),
                `/admin/hospitality/properties?${query}`,
              )}
            />,
            <Section
              title={_('hospitality_core.property.section.next')}
              description={_('hospitality_core.property.section.nextHint')}
              body={stack(
                [
                  linkButton({
                    label: _('hospitality_core.menu.roomTypes'),
                    href: `/admin/hospitality/room-types?property=${encodeURIComponent(property.id)}&${query}`,
                    variant: 'secondary',
                  }),
                  linkButton({
                    label: _('hospitality_core.menu.rooms'),
                    href: `/admin/hospitality/rooms?property=${encodeURIComponent(property.id)}&${query}`,
                    variant: 'secondary',
                  }),
                  linkButton({
                    label: _('hospitality_core.menu.inventory'),
                    href: `/admin/hospitality/inventory?property=${encodeURIComponent(property.id)}&${query}`,
                    variant: 'secondary',
                  }),
                  linkButton({
                    label: _('hospitality_core.menu.content'),
                    href: `/admin/hospitality/content?property=${encodeURIComponent(property.id)}&${query}`,
                    variant: 'secondary',
                  }),
                ],
                'compact',
              )}
            />,
          ])}
        />,
      ])}
    />
  )
}

const roomFeedback = (
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

const roomFormFields = (
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

const roomForm = (
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

export const roomsScreen = (
  _: Translator,
  data: {
    rows: RoomRow[]
    properties: PropertyRow[]
    propertyId?: string
    roomTypes: RoomTypeRow[]
    buildings: BuildingRow[]
    floors: FloorRow[]
  },
  locale: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult => {
  const query = new URLSearchParams({ lang: locale })
  if (data.propertyId) query.set('property', data.propertyId)
  const action = `/admin/hospitality/rooms?${query.toString()}`
  const activeBuildings = data.buildings.filter((row) => row.active)
  const activeFloors = data.floors.filter((row) => row.active)
  const canCreateRoom = Boolean(data.propertyId && data.roomTypes.length)
  return (
    <Framed
      translator={_}
      title={_('hospitality_core.screen.rooms.title')}
      frame={frame}
      body={stack([
        roomFeedback(_, status, errors),
        <RecordForm
          action="/admin/hospitality/rooms"
          method="get"
          layout="inline"
          fields={[
            {
              name: 'property',
              label: _('hospitality_core.room.field.property'),
              type: 'select',
              value: data.propertyId,
              options: choices(data.properties),
            },
          ]}
          hidden={{ lang: locale }}
          submit={_('hospitality_core.action.apply')}
          submitVariant="secondary"
        />,
        canCreateRoom ? (
          linkButton({
            label: _('hospitality_core.room.action.create'),
            href: `/admin/hospitality/rooms/new?${query.toString()}`,
            variant: 'primary',
          })
        ) : (
          <Notice
            title={_('hospitality_core.room.empty.prerequisite')}
            message={_('hospitality_core.room.empty.prerequisiteHint')}
            tone="warning"
          />
        ),
        <CardGrid
          items={[
            { id: 'rooms', label: _('hospitality_core.metric.rooms'), value: data.rows.length },
            {
              id: 'buildings',
              label: _('hospitality_core.property.metric.buildings'),
              value: activeBuildings.length,
            },
            { id: 'floors', label: _('hospitality_core.room.metric.floors'), value: activeFloors.length },
            {
              id: 'available',
              label: _('hospitality_core.metric.available'),
              value: data.rows.filter((row) => row.status === 'available').length,
            },
          ]}
          id={(item) => item.id}
          card={(item) => <Metric label={item.label} value={String(item.value)} tone={item.id} />}
        />,
        ...(data.propertyId
          ? [
              <Section
                title={_('hospitality_core.room.section.locationSetup')}
                description={_('hospitality_core.room.section.locationSetupHint')}
                body={
                  <FormCluster
                    label={_('hospitality_core.room.section.locationSetup')}
                    forms={[
                      <RecordForm
                        action={action}
                        hidden={{
                          id: 'new-building',
                          operation: 'save-building',
                          propertyId: data.propertyId,
                        }}
                        submit={_('hospitality_core.room.action.createBuilding')}
                        submitVariant="secondary"
                        fields={[
                          {
                            name: 'code',
                            label: _('hospitality_core.room.field.buildingCode'),
                            required: true,
                          },
                          {
                            name: 'name',
                            label: _('hospitality_core.room.field.buildingName'),
                            required: true,
                          },
                          {
                            name: 'sequence',
                            label: _('hospitality_core.room.field.sequence'),
                            type: 'number',
                            value: 10,
                            step: '1',
                          },
                        ]}
                      />,
                      ...(activeBuildings.length
                        ? [
                            <RecordForm
                              action={action}
                              hidden={{
                                id: 'new-floor',
                                operation: 'save-floor',
                                propertyId: data.propertyId,
                              }}
                              submit={_('hospitality_core.room.action.createFloor')}
                              submitVariant="secondary"
                              fields={[
                                {
                                  name: 'buildingId',
                                  label: _('hospitality_core.room.field.building'),
                                  type: 'select' as const,
                                  options: choices(activeBuildings),
                                  required: true,
                                },
                                {
                                  name: 'code',
                                  label: _('hospitality_core.room.field.floorCode'),
                                  required: true,
                                },
                                {
                                  name: 'name',
                                  label: _('hospitality_core.room.field.floorName'),
                                  required: true,
                                },
                                {
                                  name: 'sequence',
                                  label: _('hospitality_core.room.field.sequence'),
                                  type: 'number' as const,
                                  value: 10,
                                  step: '1',
                                },
                              ]}
                            />,
                          ]
                        : []),
                    ]}
                  />
                }
              />,
              <Section
                title={_('hospitality_core.room.section.buildings')}
                description={_('hospitality_core.room.section.buildingsHint')}
                body={
                  data.buildings.length
                    ? dataTable(_, {
                        columns: buildingColumns(_),
                        rows: data.buildings,
                        id: (row) => row.id,
                        rowHref: (row) =>
                          `/admin/hospitality/buildings/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
                      })
                    : emptyState(
                        _('hospitality_core.room.empty.buildings'),
                        _('hospitality_core.room.empty.buildingsHint'),
                      )
                }
              />,
              <Section
                title={_('hospitality_core.room.section.floors')}
                description={_('hospitality_core.room.section.floorsHint')}
                body={
                  data.floors.length
                    ? dataTable(_, {
                        columns: floorColumns(_),
                        rows: data.floors,
                        id: (row) => row.id,
                        rowHref: (row) =>
                          `/admin/hospitality/levels/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
                      })
                    : emptyState(
                        _('hospitality_core.room.empty.floors'),
                        _('hospitality_core.room.empty.floorsHint'),
                      )
                }
              />,
            ]
          : []),
        <Section
          title={_('hospitality_core.room.section.rooms')}
          description={_('hospitality_core.room.section.roomsHint')}
          body={
            data.rows.length
              ? dataTable(_, {
                  columns: roomColumns(_),
                  rows: data.rows,
                  id: (row) => row.id,
                  rowHref: (row) =>
                    `/admin/hospitality/rooms/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
                })
              : emptyState(
                  _('hospitality_core.screen.rooms.empty'),
                  _('hospitality_core.screen.rooms.emptyHint'),
                )
          }
        />,
      ])}
    />
  )
}

const locationFeedback = (
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

const buildingForm = (_: Translator, values: BuildingFormValues, locale: string): TemplateResult => (
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

export const buildingDetailScreen = (
  _: Translator,
  building: BuildingDetail,
  values: BuildingFormValues,
  locale: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult => {
  const query = `lang=${encodeURIComponent(locale)}`
  const propertyName = building.property?.name ?? building.property?.code ?? building.propertyId
  const activeFloors = building.floors.filter((row) => row.active)
  const activeRooms = building.rooms.filter((row) => row.active)
  return (
    <Framed
      translator={_}
      title={building.name}
      frame={frame}
      body={stack([
        locationFeedback(_, 'building', status, errors),
        <RecordWorkspace
          kicker={_('hospitality_core.building.detail.kicker')}
          title={building.name}
          subtitle={`${building.code} · ${propertyName}`}
          imageFallback={icon('hotel')}
          badges={[
            badge(
              _(building.active ? 'hospitality_core.value.active' : 'hospitality_core.value.inactive'),
              building.active ? 'positive' : 'neutral',
            ),
          ]}
          summary={[
            {
              id: 'floors',
              label: _('hospitality_core.room.metric.floors'),
              value: activeFloors.length,
            },
            { id: 'rooms', label: _('hospitality_core.metric.rooms'), value: activeRooms.length },
            {
              id: 'sequence',
              label: _('hospitality_core.building.field.sequence'),
              value: building.sequence,
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.building.action.back'),
            href: `/admin/hospitality/rooms?property=${encodeURIComponent(building.propertyId)}&${query}`,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.building.section.information')}
              description={_('hospitality_core.building.section.informationHint')}
              body={
                <DefinitionList
                  title={building.name}
                  items={[
                    {
                      key: 'property',
                      term: _('hospitality_core.building.field.property'),
                      value: propertyName,
                    },
                    { key: 'code', term: _('hospitality_core.building.field.code'), value: building.code },
                    {
                      key: 'status',
                      term: _('hospitality_core.col.status'),
                      value: _(
                        building.active ? 'hospitality_core.value.active' : 'hospitality_core.value.inactive',
                      ),
                    },
                  ]}
                />
              }
            />,
            <Section
              title={_('hospitality_core.building.section.settings')}
              description={_('hospitality_core.building.section.settingsHint')}
              body={buildingForm(_, values, locale)}
            />,
            <Section
              title={_('hospitality_core.building.section.floors')}
              description={_('hospitality_core.building.section.floorsHint')}
              body={
                building.floors.length
                  ? dataTable(_, {
                      columns: floorColumns(_),
                      rows: building.floors,
                      id: (row) => row.id,
                      rowHref: (row) =>
                        `/admin/hospitality/levels/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
                    })
                  : emptyState(
                      _('hospitality_core.building.empty.floors'),
                      _('hospitality_core.building.empty.floorsHint'),
                    )
              }
            />,
            <Section
              title={_('hospitality_core.building.section.lifecycle')}
              description={_('hospitality_core.building.section.lifecycleHint')}
              body={
                <Surface
                  body={
                    <RecordActions
                      action={`/admin/hospitality/buildings/${encodeURIComponent(building.id)}/archive?${query}`}
                      actions={[
                        building.active
                          ? {
                              value: 'archive',
                              label: _('hospitality_core.building.action.archive'),
                              variant: 'destructive',
                            }
                          : {
                              value: 'restore',
                              label: _('hospitality_core.building.action.restore'),
                              variant: 'secondary',
                            },
                      ]}
                    />
                  }
                />
              }
            />,
          ])}
        />,
      ])}
    />
  )
}

const floorForm = (_: Translator, values: FloorFormValues, locale: string): TemplateResult => (
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

export const floorDetailScreen = (
  _: Translator,
  floor: FloorDetail,
  values: FloorFormValues,
  locale: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult => {
  const query = `lang=${encodeURIComponent(locale)}`
  const propertyName = floor.property?.name ?? floor.property?.code ?? floor.propertyId
  const buildingName = floor.building?.name ?? floor.building?.code ?? floor.buildingId
  const activeRooms = floor.rooms.filter((row) => row.active)
  return (
    <Framed
      translator={_}
      title={floor.name}
      frame={frame}
      body={stack([
        locationFeedback(_, 'floor', status, errors),
        <RecordWorkspace
          kicker={_('hospitality_core.floor.detail.kicker')}
          title={floor.name}
          subtitle={`${floor.code} · ${buildingName}`}
          imageFallback={icon('hotel')}
          badges={[
            badge(
              _(floor.active ? 'hospitality_core.value.active' : 'hospitality_core.value.inactive'),
              floor.active ? 'positive' : 'neutral',
            ),
          ]}
          summary={[
            { id: 'rooms', label: _('hospitality_core.metric.rooms'), value: activeRooms.length },
            {
              id: 'building',
              label: _('hospitality_core.floor.field.building'),
              value: buildingName,
            },
            {
              id: 'sequence',
              label: _('hospitality_core.floor.field.sequence'),
              value: floor.sequence,
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.floor.action.back'),
            href: `/admin/hospitality/buildings/${encodeURIComponent(floor.buildingId)}?${query}`,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.floor.section.information')}
              description={_('hospitality_core.floor.section.informationHint')}
              body={
                <DefinitionList
                  title={floor.name}
                  items={[
                    {
                      key: 'property',
                      term: _('hospitality_core.floor.field.property'),
                      value: propertyName,
                    },
                    {
                      key: 'building',
                      term: _('hospitality_core.floor.field.building'),
                      value: buildingName,
                    },
                    { key: 'code', term: _('hospitality_core.floor.field.code'), value: floor.code },
                    {
                      key: 'status',
                      term: _('hospitality_core.col.status'),
                      value: _(
                        floor.active ? 'hospitality_core.value.active' : 'hospitality_core.value.inactive',
                      ),
                    },
                  ]}
                />
              }
            />,
            <Section
              title={_('hospitality_core.floor.section.settings')}
              description={_('hospitality_core.floor.section.settingsHint')}
              body={floorForm(_, values, locale)}
            />,
            <Section
              title={_('hospitality_core.floor.section.rooms')}
              description={_('hospitality_core.floor.section.roomsHint')}
              body={
                floor.rooms.length
                  ? dataTable(_, {
                      columns: roomColumns(_),
                      rows: floor.rooms,
                      id: (row) => row.id,
                      rowHref: (row) =>
                        `/admin/hospitality/rooms/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
                    })
                  : emptyState(
                      _('hospitality_core.floor.empty.rooms'),
                      _('hospitality_core.floor.empty.roomsHint'),
                    )
              }
            />,
            <Section
              title={_('hospitality_core.floor.section.lifecycle')}
              description={_('hospitality_core.floor.section.lifecycleHint')}
              body={
                <Surface
                  body={
                    <RecordActions
                      action={`/admin/hospitality/levels/${encodeURIComponent(floor.id)}/archive?${query}`}
                      actions={[
                        floor.active
                          ? {
                              value: 'archive',
                              label: _('hospitality_core.floor.action.archive'),
                              variant: 'destructive',
                            }
                          : {
                              value: 'restore',
                              label: _('hospitality_core.floor.action.restore'),
                              variant: 'secondary',
                            },
                      ]}
                    />
                  }
                />
              }
            />,
          ])}
        />,
      ])}
    />
  )
}

export const newRoomScreen = (
  _: Translator,
  values: RoomFormValues,
  properties: PropertyRow[],
  roomTypes: RoomTypeRow[],
  buildings: BuildingRow[],
  floors: FloorRow[],
  locale: string,
  frame: Frame,
  errors: readonly string[] = [],
): TemplateResult => (
  <Framed
    translator={_}
    title={_('hospitality_core.room.create.title')}
    frame={frame}
    body={stack([
      roomFeedback(_, null, errors),
      <Section
        title={_('hospitality_core.room.create.title')}
        description={_('hospitality_core.room.create.hint')}
        body={roomForm(
          _,
          values,
          properties,
          roomTypes,
          buildings,
          floors,
          locale,
          `/admin/hospitality/rooms/new?lang=${encodeURIComponent(locale)}`,
          _('hospitality_core.room.action.create'),
          `/admin/hospitality/rooms?property=${encodeURIComponent(values.propertyId)}&lang=${encodeURIComponent(locale)}`,
        )}
      />,
    ])}
  />
)

export const roomDetailScreen = (
  _: Translator,
  room: RoomDetail,
  values: RoomFormValues,
  properties: PropertyRow[],
  roomTypes: RoomTypeRow[],
  buildings: BuildingRow[],
  floors: FloorRow[],
  locale: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult => {
  const query = `lang=${encodeURIComponent(locale)}`
  const propertyName = room.property?.name ?? room.property?.code ?? room.propertyId
  const location = [room.building?.name ?? room.building?.code, room.floor?.name ?? room.floor?.code]
    .filter(Boolean)
    .join(' · ')
  return (
    <Framed
      translator={_}
      title={room.name}
      frame={frame}
      body={stack([
        roomFeedback(_, status, errors),
        <RecordWorkspace
          kicker={_('hospitality_core.room.detail.kicker')}
          title={room.name}
          subtitle={`${room.code} · ${propertyName}`}
          imageFallback={icon('hotel')}
          badges={[
            badge(_(`hospitality_core.roomStatus.${room.status}`), statusTone(room.status), room.status),
            badge(
              _(room.active ? 'hospitality_core.value.active' : 'hospitality_core.value.inactive'),
              room.active ? 'positive' : 'neutral',
            ),
          ]}
          summary={[
            { id: 'capacity', label: _('hospitality_core.col.capacity'), value: room.capacity },
            {
              id: 'roomType',
              label: _('hospitality_core.col.roomType'),
              value: room.roomType?.name ?? room.roomType?.code ?? room.roomTypeId,
            },
            {
              id: 'location',
              label: _('hospitality_core.col.location'),
              value: location || _('hospitality_core.room.value.unassignedLocation'),
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.room.action.back'),
            href: `/admin/hospitality/rooms?property=${encodeURIComponent(room.propertyId)}&${query}`,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.room.section.information')}
              description={_('hospitality_core.room.section.informationHint')}
              body={
                <DefinitionList
                  title={room.name}
                  items={[
                    { key: 'property', term: _('hospitality_core.room.field.property'), value: propertyName },
                    {
                      key: 'type',
                      term: _('hospitality_core.room.field.roomType'),
                      value: room.roomType?.name ?? room.roomType?.code ?? room.roomTypeId,
                    },
                    {
                      key: 'location',
                      term: _('hospitality_core.col.location'),
                      value: location || _('hospitality_core.room.value.unassignedLocation'),
                    },
                    {
                      key: 'status',
                      term: _('hospitality_core.col.status'),
                      value: _(`hospitality_core.roomStatus.${room.status}`),
                    },
                  ]}
                />
              }
            />,
            <Section
              title={_('hospitality_core.room.section.settings')}
              description={_('hospitality_core.room.section.settingsHint')}
              body={roomForm(
                _,
                values,
                properties,
                roomTypes,
                buildings,
                floors,
                locale,
                `/admin/hospitality/rooms/${encodeURIComponent(room.id)}?${query}`,
                _('hospitality_core.room.action.save'),
                `/admin/hospitality/rooms?property=${encodeURIComponent(room.propertyId)}&${query}`,
              )}
            />,
            <Section
              title={_('hospitality_core.room.section.lifecycle')}
              description={_('hospitality_core.room.section.lifecycleHint')}
              body={stack([
                linkButton({
                  label: _('hospitality_core.room.action.openHousekeeping'),
                  href: `/admin/hospitality/housekeeping/rooms/${encodeURIComponent(room.id)}?${query}`,
                  variant: 'secondary',
                }),
                <Surface
                  body={
                    <RecordActions
                      action={`/admin/hospitality/rooms/${encodeURIComponent(room.id)}/archive?${query}`}
                      actions={[
                        room.active
                          ? {
                              value: 'archive',
                              label: _('hospitality_core.room.action.archive'),
                              variant: 'destructive',
                            }
                          : {
                              value: 'restore',
                              label: _('hospitality_core.room.action.restore'),
                              variant: 'secondary',
                            },
                      ]}
                    />
                  }
                />,
              ])}
            />,
          ])}
        />,
      ])}
    />
  )
}

export const cleaningTasksScreen = (
  _: Translator,
  data: {
    rows: CleaningTaskRow[]
    properties: PropertyRow[]
    propertyId?: string
    state: string
    rooms: RoomRow[]
    summary: CleaningTaskSummary
    id: string
    code: string
    selectedRoomId?: string
  },
  locale: string,
  timezone: string,
  frame: Frame,
  status?: string | null,
): TemplateResult => {
  const visibleRows = data.state === 'all' ? data.rows : data.rows.filter((row) => row.state === data.state)
  const query = new URLSearchParams({ lang: locale })
  if (data.propertyId) query.set('property', data.propertyId)
  if (data.state !== 'all') query.set('state', data.state)
  const action = `/admin/hospitality/housekeeping?${query.toString()}`
  const feedback =
    status === 'created' ? (
      <Notice
        title={_('hospitality_core.housekeeping.feedback.created')}
        message={_('hospitality_core.housekeeping.feedback.createdHint')}
        tone="positive"
      />
    ) : status === 'invalid' ? (
      <Notice
        title={_('hospitality_core.feedback.invalid')}
        message={_('hospitality_core.housekeeping.feedback.invalidHint')}
        tone="danger"
      />
    ) : null

  return (
    <Framed
      translator={_}
      title={_('hospitality_core.screen.cleaningTasks.title')}
      frame={frame}
      body={stack([
        feedback,
        <RecordForm
          action="/admin/hospitality/housekeeping"
          method="get"
          layout="inline"
          submit={_('hospitality_core.action.select')}
          submitVariant="secondary"
          hidden={{ lang: locale }}
          fields={[
            {
              name: 'property',
              label: _('hospitality_core.menu.properties'),
              type: 'select',
              value: data.propertyId,
              required: true,
              options: choices(data.properties),
            },
            {
              name: 'state',
              label: _('hospitality_core.col.status'),
              type: 'select',
              value: data.state,
              options: ['all', 'todo', 'in_progress', 'done', 'cancelled'].map((value) => ({
                value,
                label: _(`hospitality_core.cleaningState.${value}`),
              })),
            },
          ]}
        />,
        <CardGrid
          items={['todo', 'in_progress', 'done'].map((state) => ({
            state,
            count:
              state === 'todo'
                ? data.summary.todo
                : state === 'in_progress'
                  ? data.summary.inProgress
                  : data.summary.done,
          }))}
          id={(item) => item.state}
          card={(item) => (
            <Metric
              label={_(`hospitality_core.cleaningState.${item.state}`)}
              value={String(item.count)}
              tone={item.state}
            />
          )}
        />,
        <Section
          title={_('hospitality_core.housekeeping.section.create')}
          description={_('hospitality_core.housekeeping.section.createHint')}
          body={
            data.rooms.length ? (
              <RecordForm
                action={action}
                method="post"
                submit={_('hospitality_core.housekeeping.action.create')}
                submitVariant="secondary"
                hidden={{
                  operation: 'create',
                  lang: locale,
                  id: data.id,
                  code: data.code,
                  propertyId: data.propertyId ?? '',
                  state: data.state,
                }}
                fields={[
                  {
                    name: 'roomId',
                    label: _('hospitality_core.col.room'),
                    type: 'select',
                    value: data.selectedRoomId,
                    required: true,
                    options: data.rooms.map((room) => ({
                      value: room.id,
                      label: `${room.code} · ${room.name} · ${_(`hospitality_core.roomStatus.${room.status}`)}`,
                    })),
                  },
                  {
                    name: 'taskType',
                    label: _('hospitality_core.col.type'),
                    type: 'select',
                    value: 'daily_clean',
                    required: true,
                    options: ['checkout_clean', 'daily_clean', 'maintenance', 'inspection'].map((value) => ({
                      value,
                      label: _(`hospitality_core.cleaningType.${value}`),
                    })),
                  },
                  {
                    name: 'priority',
                    label: _('hospitality_core.col.priority'),
                    type: 'select',
                    value: 'normal',
                    required: true,
                    options: ['normal', 'urgent'].map((value) => ({
                      value,
                      label: _(`hospitality_core.cleaningPriority.${value}`),
                    })),
                  },
                  {
                    name: 'assigneeId',
                    label: _('hospitality_core.col.assignee'),
                    help: _('hospitality_core.housekeeping.field.assigneeHint'),
                  },
                  {
                    name: 'notes',
                    label: _('hospitality_core.housekeeping.field.notes'),
                    type: 'textarea',
                    span: 'full',
                  },
                ]}
              />
            ) : (
              emptyState(
                _('hospitality_core.housekeeping.empty.rooms'),
                _('hospitality_core.housekeeping.empty.roomsHint'),
              )
            )
          }
        />,
        <Section
          title={_('hospitality_core.housekeeping.section.queue')}
          description={_('hospitality_core.housekeeping.section.queueHint')}
          body={
            visibleRows.length
              ? dataTable(_, {
                  columns: cleaningTaskColumns(_, locale, timezone),
                  rows: visibleRows,
                  id: (row) => row.id,
                  rowHref: (row) =>
                    `/admin/hospitality/housekeeping/tasks/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
                })
              : emptyState(
                  _('hospitality_core.screen.cleaningTasks.empty'),
                  _('hospitality_core.screen.cleaningTasks.emptyHint'),
                )
          }
        />,
      ])}
    />
  )
}

const cleaningTaskFeedback = (
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

export const cleaningTaskDetailScreen = (
  _: Translator,
  task: CleaningTaskRow,
  locale: string,
  timezone: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult => {
  const action = `/admin/hospitality/housekeeping/tasks/${encodeURIComponent(task.id)}?lang=${encodeURIComponent(locale)}`
  const room = task.room?.name ?? task.room?.code ?? task.roomId
  const actions: TemplateResult[] = []

  if (task.state === 'todo')
    actions.push(
      <Section
        title={_('hospitality_core.housekeeping.action.start')}
        description={_('hospitality_core.housekeeping.action.startHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.housekeeping.action.start')}
            submitVariant="primary"
            hidden={{ operation: 'start', lang: locale }}
            fields={[
              {
                name: 'assigneeId',
                label: _('hospitality_core.col.assignee'),
                value: task.assigneeId,
                help: _('hospitality_core.housekeeping.field.assigneeHint'),
              },
            ]}
          />
        }
      />,
    )

  if (task.state === 'in_progress')
    actions.push(
      <Section
        title={_('hospitality_core.housekeeping.action.complete')}
        description={_('hospitality_core.housekeeping.action.completeHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.housekeeping.action.complete')}
            submitVariant="primary"
            hidden={{ operation: 'complete', lang: locale }}
            fields={[]}
          />
        }
      />,
    )

  if (task.state === 'todo' || task.state === 'in_progress')
    actions.push(
      <Section
        title={_('hospitality_core.housekeeping.action.cancel')}
        description={_('hospitality_core.housekeeping.action.cancelHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.housekeeping.action.cancel')}
            submitVariant="destructive"
            hidden={{ operation: 'cancel', lang: locale }}
            fields={[]}
          />
        }
      />,
    )

  return (
    <Framed
      translator={_}
      title={_('hospitality_core.housekeeping.detail.title', { code: task.code })}
      frame={frame}
      body={stack([
        cleaningTaskFeedback(_, status, errors),
        <RecordWorkspace
          kicker={_('hospitality_core.housekeeping.detail.kicker')}
          title={task.code}
          subtitle={room}
          imageFallback={icon('check-circle')}
          badges={[
            badge(_(`hospitality_core.cleaningState.${task.state}`), cleaningTone(task.state), task.state),
            badge(
              _(`hospitality_core.cleaningPriority.${task.priority}`),
              task.priority === 'urgent' ? 'danger' : 'neutral',
            ),
          ]}
          summary={[
            {
              id: 'room',
              label: _('hospitality_core.col.room'),
              value: room,
            },
            {
              id: 'type',
              label: _('hospitality_core.col.type'),
              value: _(`hospitality_core.cleaningType.${task.taskType}`),
            },
            {
              id: 'assignee',
              label: _('hospitality_core.col.assignee'),
              value: task.assigneeId || '—',
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.housekeeping.action.back'),
            href: `/admin/hospitality/housekeeping?property=${encodeURIComponent(task.propertyId)}&lang=${encodeURIComponent(locale)}`,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.housekeeping.section.information')}
              description={_('hospitality_core.housekeeping.section.informationHint')}
              body={
                <DefinitionList
                  title={task.code}
                  items={[
                    {
                      key: 'property',
                      term: _('hospitality_core.menu.properties'),
                      value: task.property?.name ?? task.property?.code ?? task.propertyId,
                    },
                    {
                      key: 'room',
                      term: _('hospitality_core.col.room'),
                      value: room,
                    },
                    {
                      key: 'requested',
                      term: _('hospitality_core.col.requestedAt'),
                      value: dateTime(task.requestedAt, locale, timezone),
                    },
                    ...(task.startedAt
                      ? [
                          {
                            key: 'started',
                            term: _('hospitality_core.housekeeping.field.startedAt'),
                            value: dateTime(task.startedAt, locale, timezone),
                          },
                        ]
                      : []),
                    ...(task.doneAt
                      ? [
                          {
                            key: 'done',
                            term: _('hospitality_core.housekeeping.field.doneAt'),
                            value: dateTime(task.doneAt, locale, timezone),
                          },
                        ]
                      : []),
                    ...(task.stayId
                      ? [
                          {
                            key: 'stay',
                            term: _('hospitality_core.menu.stays'),
                            value: task.stay?.code ?? task.stayId,
                          },
                        ]
                      : []),
                    ...(task.notes
                      ? [
                          {
                            key: 'notes',
                            term: _('hospitality_core.housekeeping.field.notes'),
                            value: task.notes,
                          },
                        ]
                      : []),
                  ]}
                />
              }
            />,
            ...actions,
          ])}
        />,
      ])}
    />
  )
}

const housekeepingRoomColumns = (_: Translator): Array<Column<RoomRow>> => [
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

export const housekeepingRoomsScreen = (
  _: Translator,
  data: {
    rows: RoomRow[]
    properties: PropertyRow[]
    propertyId?: string
    state: string
    summary: RoomStatusSummary
  },
  locale: string,
  frame: Frame,
): TemplateResult => {
  const total =
    data.summary.available +
    data.summary.occupied +
    data.summary.dirty +
    data.summary.cleaning +
    data.summary.maintenance +
    data.summary.outOfOrder
  const attention =
    data.summary.dirty + data.summary.cleaning + data.summary.maintenance + data.summary.outOfOrder
  const metrics = [
    { id: 'rooms', value: total },
    { id: 'available', value: data.summary.available },
    { id: 'occupied', value: data.summary.occupied },
    { id: 'attention', value: attention },
  ]

  return (
    <Framed
      translator={_}
      title={_('hospitality_core.screen.housekeepingRooms.title')}
      frame={frame}
      body={stack([
        <RecordForm
          action="/admin/hospitality/housekeeping/rooms"
          method="get"
          layout="inline"
          submit={_('hospitality_core.action.select')}
          submitVariant="secondary"
          hidden={{ lang: locale }}
          fields={[
            {
              name: 'property',
              label: _('hospitality_core.menu.properties'),
              type: 'select',
              value: data.propertyId,
              required: true,
              options: choices(data.properties),
            },
            {
              name: 'state',
              label: _('hospitality_core.col.status'),
              type: 'select',
              value: data.state,
              options: ['all', ...ROOM_STATUSES].map((value) => ({
                value,
                label: _(`hospitality_core.roomStatus.${value}`),
              })),
            },
          ]}
        />,
        <CardGrid
          items={metrics}
          id={(item) => item.id}
          card={(item) => (
            <Metric
              label={_(`hospitality_core.metric.${item.id}`)}
              value={String(item.value)}
              tone={item.id}
            />
          )}
        />,
        <Section
          title={_('hospitality_core.housekeeping.rooms.section.board')}
          description={_('hospitality_core.housekeeping.rooms.section.boardHint')}
          body={
            data.rows.length
              ? dataTable(_, {
                  columns: housekeepingRoomColumns(_),
                  rows: data.rows,
                  id: (row) => row.id,
                  rowHref: (row) =>
                    `/admin/hospitality/housekeeping/rooms/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
                })
              : emptyState(
                  _('hospitality_core.screen.housekeepingRooms.empty'),
                  _('hospitality_core.screen.housekeepingRooms.emptyHint'),
                )
          }
        />,
      ])}
    />
  )
}

const housekeepingRoomFeedback = (
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

export const housekeepingRoomDetailScreen = (
  _: Translator,
  room: RoomRow,
  tasks: CleaningTaskRow[],
  locale: string,
  timezone: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult => {
  const action = `/admin/hospitality/housekeeping/rooms/${encodeURIComponent(room.id)}?lang=${encodeURIComponent(locale)}`
  const taskQueue = `/admin/hospitality/housekeeping?property=${encodeURIComponent(room.propertyId)}&room=${encodeURIComponent(room.id)}&lang=${encodeURIComponent(locale)}`
  const location = [room.building?.name ?? room.building?.code, room.floor?.name ?? room.floor?.code]
    .filter(Boolean)
    .join(' · ')
  const actions: TemplateResult[] = []

  if (room.status === 'available' || room.status === 'dirty')
    actions.push(
      <Section
        title={_('hospitality_core.housekeeping.rooms.section.service')}
        description={_('hospitality_core.housekeeping.rooms.section.serviceHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.housekeeping.rooms.action.takeOut')}
            submitVariant="destructive"
            hidden={{ operation: 'set-status', expectedStatus: room.status, lang: locale }}
            fields={[
              {
                name: 'status',
                label: _('hospitality_core.housekeeping.rooms.field.targetStatus'),
                type: 'select',
                value: 'maintenance',
                required: true,
                options: ['maintenance', 'out_of_order'].map((value) => ({
                  value,
                  label: _(`hospitality_core.roomStatus.${value}`),
                })),
              },
              {
                name: 'note',
                label: _('hospitality_core.housekeeping.rooms.field.reason'),
                type: 'textarea',
                required: true,
                span: 'full',
              },
            ]}
          />
        }
      />,
    )

  if (room.status === 'maintenance' || room.status === 'out_of_order')
    actions.push(
      <Section
        title={_('hospitality_core.housekeeping.rooms.section.release')}
        description={_('hospitality_core.housekeeping.rooms.section.releaseHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.housekeeping.rooms.action.release')}
            submitVariant="primary"
            hidden={{
              operation: 'set-status',
              expectedStatus: room.status,
              status: 'dirty',
              lang: locale,
            }}
            fields={[]}
          />
        }
      />,
    )

  const currentStay = room.currentStay
  const guest = currentStay?.partner?.name

  return (
    <Framed
      translator={_}
      title={_('hospitality_core.housekeeping.rooms.detail.title', { code: room.code })}
      frame={frame}
      body={stack([
        housekeepingRoomFeedback(_, status, errors),
        <RecordWorkspace
          kicker={_('hospitality_core.housekeeping.rooms.detail.kicker')}
          title={room.code}
          subtitle={room.name}
          imageFallback={icon('hotel')}
          badges={[
            badge(_(`hospitality_core.roomStatus.${room.status}`), statusTone(room.status), room.status),
          ]}
          summary={[
            {
              id: 'room-type',
              label: _('hospitality_core.col.roomType'),
              value: room.roomType?.name ?? room.roomType?.code ?? room.roomTypeId,
            },
            {
              id: 'capacity',
              label: _('hospitality_core.col.capacity'),
              value: room.capacity,
            },
            {
              id: 'tasks',
              label: _('hospitality_core.housekeeping.rooms.metric.openTasks'),
              value: tasks.filter((task) => task.state === 'todo' || task.state === 'in_progress').length,
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.housekeeping.rooms.action.back'),
            href: `/admin/hospitality/housekeeping/rooms?property=${encodeURIComponent(room.propertyId)}&lang=${encodeURIComponent(locale)}`,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.housekeeping.rooms.section.information')}
              description={_('hospitality_core.housekeeping.rooms.section.informationHint')}
              body={stack([
                <DefinitionList
                  title={room.name}
                  items={[
                    {
                      key: 'property',
                      term: _('hospitality_core.menu.properties'),
                      value: room.property?.name ?? room.property?.code ?? room.propertyId,
                    },
                    {
                      key: 'room-type',
                      term: _('hospitality_core.col.roomType'),
                      value: room.roomType?.name ?? room.roomType?.code ?? room.roomTypeId,
                    },
                    {
                      key: 'location',
                      term: _('hospitality_core.col.location'),
                      value: location || '—',
                    },
                    {
                      key: 'guest',
                      term: _('hospitality_core.reservation.field.guest'),
                      value: guest ?? '—',
                    },
                    {
                      key: 'note',
                      term: _('hospitality_core.housekeeping.field.notes'),
                      value: room.note || '—',
                    },
                  ]}
                />,
                currentStay?.id
                  ? linkButton({
                      label: _('hospitality_core.housekeeping.rooms.action.openStay'),
                      href: `/admin/hospitality/stays/${encodeURIComponent(currentStay.id)}?lang=${encodeURIComponent(locale)}`,
                      variant: 'secondary',
                    })
                  : null,
              ])}
            />,
            <Section
              title={_('hospitality_core.housekeeping.rooms.section.tasks')}
              description={_('hospitality_core.housekeeping.rooms.section.tasksHint')}
              body={stack([
                tasks.length
                  ? dataTable(_, {
                      columns: cleaningTaskColumns(_, locale, timezone),
                      rows: tasks,
                      id: (task) => task.id,
                      rowHref: (task) =>
                        `/admin/hospitality/housekeeping/tasks/${encodeURIComponent(task.id)}?lang=${encodeURIComponent(locale)}`,
                    })
                  : emptyState(
                      _('hospitality_core.housekeeping.rooms.empty.tasks'),
                      _('hospitality_core.housekeeping.rooms.empty.tasksHint'),
                    ),
                linkButton({
                  label: _('hospitality_core.housekeeping.action.create'),
                  href: taskQueue,
                  variant: 'secondary',
                }),
              ])}
            />,
            ...actions,
          ])}
        />,
      ])}
    />
  )
}

const roomTypeFormFields = (
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

const roomTypeForm = (
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

const roomTypeFeedback = (
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

export const roomTypesScreen = (
  _: Translator,
  rows: RoomTypeRow[],
  properties: PropertyRow[],
  propertyId: string | undefined,
  locale: string,
  frame: Frame,
): TemplateResult => {
  const propertyQuery = propertyId ? `&property=${encodeURIComponent(propertyId)}` : ''
  return (
    <Framed
      translator={_}
      title={_('hospitality_core.screen.roomTypes.title')}
      frame={frame}
      body={stack([
        <RecordForm
          action="/admin/hospitality/room-types"
          method="get"
          layout="inline"
          fields={[
            {
              name: 'property',
              label: _('hospitality_core.roomType.field.property'),
              type: 'select',
              value: propertyId,
              options: choices(properties),
            },
          ]}
          hidden={{ lang: locale }}
          submit={_('hospitality_core.action.apply')}
          submitVariant="secondary"
        />,
        properties.length ? (
          linkButton({
            label: _('hospitality_core.roomType.action.create'),
            href: `/admin/hospitality/room-types/new?lang=${encodeURIComponent(locale)}${propertyQuery}`,
            variant: 'primary',
          })
        ) : (
          <Notice
            title={_('hospitality_core.roomType.empty.noProperty')}
            message={_('hospitality_core.roomType.empty.noPropertyHint')}
            tone="warning"
          />
        ),
        <CardGrid
          items={[
            { id: 'types', label: _('hospitality_core.roomType.metric.types'), value: rows.length },
            {
              id: 'published',
              label: _('hospitality_core.roomType.metric.published'),
              value: rows.filter((row) => row.published).length,
            },
            {
              id: 'rooms',
              label: _('hospitality_core.metric.rooms'),
              value: rows.reduce((sum, row) => sum + (row.rooms?.length ?? 0), 0),
            },
          ]}
          id={(item) => item.id}
          card={(item) => <Metric label={item.label} value={String(item.value)} tone={item.id} />}
        />,
        rows.length
          ? dataTable(_, {
              columns: roomTypeColumns(_),
              rows,
              id: (row) => row.id,
              rowHref: (row) =>
                `/admin/hospitality/room-types/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
            })
          : emptyState(
              _('hospitality_core.screen.roomTypes.empty'),
              _('hospitality_core.screen.roomTypes.emptyHint'),
            ),
      ])}
    />
  )
}

export const newRoomTypeScreen = (
  _: Translator,
  values: RoomTypeFormValues,
  properties: PropertyRow[],
  policies: PolicyRow[],
  locale: string,
  frame: Frame,
  errors: readonly string[] = [],
): TemplateResult => (
  <Framed
    translator={_}
    title={_('hospitality_core.roomType.create.title')}
    frame={frame}
    body={stack([
      roomTypeFeedback(_, null, errors),
      <Section
        title={_('hospitality_core.roomType.create.title')}
        description={_('hospitality_core.roomType.create.hint')}
        body={roomTypeForm(
          _,
          values,
          properties,
          policies,
          locale,
          `/admin/hospitality/room-types/new?lang=${encodeURIComponent(locale)}`,
          _('hospitality_core.roomType.action.create'),
          `/admin/hospitality/room-types?property=${encodeURIComponent(values.propertyId)}&lang=${encodeURIComponent(locale)}`,
          true,
        )}
      />,
    ])}
  />
)

export const roomTypeDetailScreen = (
  _: Translator,
  roomType: RoomTypeDetail,
  properties: PropertyRow[],
  policies: PolicyRow[],
  locale: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
  attempted?: RoomTypeFormValues,
): TemplateResult => {
  const query = `lang=${encodeURIComponent(locale)}`
  const values = attempted ?? roomType
  const propertyName = roomType.property?.name ?? roomType.property?.code ?? roomType.propertyId
  return (
    <Framed
      translator={_}
      title={roomType.name}
      frame={frame}
      body={stack([
        roomTypeFeedback(_, status, errors),
        <RecordWorkspace
          kicker={_('hospitality_core.roomType.detail.kicker')}
          title={roomType.name}
          subtitle={`${roomType.code} · ${propertyName}`}
          imageFallback={icon('hotel')}
          badges={[
            badge(
              _(roomType.published ? 'hospitality_core.value.published' : 'hospitality_core.value.draft'),
              roomType.published ? 'positive' : 'neutral',
            ),
            badge(
              _(roomType.active ? 'hospitality_core.value.active' : 'hospitality_core.value.inactive'),
              roomType.active ? 'positive' : 'neutral',
            ),
          ]}
          summary={[
            {
              id: 'rooms',
              label: _('hospitality_core.metric.rooms'),
              value: roomType.rooms?.length ?? 0,
              href: `/admin/hospitality/rooms?property=${encodeURIComponent(roomType.propertyId)}&${query}`,
            },
            {
              id: 'rates',
              label: _('hospitality_core.menu.ratePlans'),
              value: roomType.ratePlans?.length ?? 0,
              href: `/admin/hospitality/rate-plans?property=${encodeURIComponent(roomType.propertyId)}&${query}`,
            },
            {
              id: 'beds',
              label: _('hospitality_core.roomType.metric.beds'),
              value: (roomType.beds ?? []).reduce((sum, bed) => sum + Number(bed.quantity ?? 0), 0),
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.roomType.action.back'),
            href: `/admin/hospitality/room-types?property=${encodeURIComponent(roomType.propertyId)}&${query}`,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.roomType.section.information')}
              description={_('hospitality_core.roomType.section.informationHint')}
              body={
                <DefinitionList
                  title={roomType.publicName || roomType.name}
                  items={[
                    {
                      key: 'property',
                      term: _('hospitality_core.roomType.field.property'),
                      value: propertyName,
                    },
                    {
                      key: 'capacity',
                      term: _('hospitality_core.roomType.field.defaultCapacity'),
                      value: _('hospitality_core.roomType.value.capacity', {
                        default: roomType.defaultCapacity,
                        adults: roomType.maxAdults,
                        children: roomType.maxChildren,
                      }),
                    },
                    {
                      key: 'rate',
                      term: _('hospitality_core.roomType.field.baseRate'),
                      value: formatMoney(_, roomType.baseRate),
                    },
                    {
                      key: 'policy',
                      term: _('hospitality_core.roomType.field.cancellationPolicy'),
                      value:
                        roomType.cancellationPolicy?.name ??
                        roomType.cancellationPolicy?.code ??
                        _('hospitality_core.roomType.value.inheritPolicy'),
                    },
                  ]}
                />
              }
            />,
            <Section
              title={_('hospitality_core.roomType.section.settings')}
              description={_('hospitality_core.roomType.section.settingsHint')}
              body={roomTypeForm(
                _,
                values,
                properties,
                policies,
                locale,
                `/admin/hospitality/room-types/${encodeURIComponent(roomType.id)}?${query}`,
                _('hospitality_core.roomType.action.save'),
                `/admin/hospitality/room-types?property=${encodeURIComponent(roomType.propertyId)}&${query}`,
                false,
              )}
            />,
            <Section
              title={_('hospitality_core.roomType.section.next')}
              description={_('hospitality_core.roomType.section.nextHint')}
              body={stack(
                [
                  linkButton({
                    label: _('hospitality_core.menu.rooms'),
                    href: `/admin/hospitality/rooms?property=${encodeURIComponent(roomType.propertyId)}&${query}`,
                    variant: 'secondary',
                  }),
                  linkButton({
                    label: _('hospitality_core.menu.ratePlans'),
                    href: `/admin/hospitality/rate-plans?property=${encodeURIComponent(roomType.propertyId)}&${query}`,
                    variant: 'secondary',
                  }),
                  linkButton({
                    label: _('hospitality_core.menu.inventory'),
                    href: `/admin/hospitality/inventory?property=${encodeURIComponent(roomType.propertyId)}&roomType=${encodeURIComponent(roomType.id)}&${query}`,
                    variant: 'secondary',
                  }),
                  linkButton({
                    label: _('hospitality_core.menu.content'),
                    href: `/admin/hospitality/content?property=${encodeURIComponent(roomType.propertyId)}&target=room_type%3A${encodeURIComponent(roomType.id)}&${query}`,
                    variant: 'secondary',
                  }),
                ],
                'compact',
              )}
            />,
          ])}
        />,
      ])}
    />
  )
}

export const amenitiesScreen = (_: Translator, rows: AmenityRow[], frame: Frame): TemplateResult => (
  <Framed
    translator={_}
    title={_('hospitality_core.screen.amenities.title')}
    frame={frame}
    body={
      rows.length
        ? dataTable(_, { columns: amenityColumns(_), rows, id: (row) => row.id })
        : emptyState(
            _('hospitality_core.screen.amenities.empty'),
            _('hospitality_core.screen.amenities.emptyHint'),
          )
    }
  />
)

export const policiesScreen = (_: Translator, rows: PolicyRow[], frame: Frame): TemplateResult => (
  <Framed
    translator={_}
    title={_('hospitality_core.screen.policies.title')}
    frame={frame}
    body={
      rows.length
        ? dataTable(_, { columns: policyColumns(_), rows, id: (row) => row.id })
        : emptyState(
            _('hospitality_core.screen.policies.empty'),
            _('hospitality_core.screen.policies.emptyHint'),
          )
    }
  />
)

const contentFeedback = (_: Translator, state?: string | null): TemplateResult | null => {
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

export const contentScreen = (
  _: Translator,
  properties: PropertyRow[],
  roomTypes: RoomTypeRow[],
  propertyId: string | undefined,
  target: string,
  images: ContentImageRow[],
  completeness: ContentCompleteness,
  locale: string,
  query: string,
  frame: Frame,
  status?: string | null,
): TemplateResult => {
  const property = properties.find((row) => row.id === propertyId)
  const roomTypeId = target.startsWith('room_type:') ? target.slice('room_type:'.length) : null
  const roomType = roomTypes.find((row) => row.id === roomTypeId)
  const selectedLabel = roomType?.name ?? property?.name ?? _('hospitality_core.content.target.none')
  const categoryOptions = ['exterior', 'lobby', 'room', 'bathroom', 'restaurant', 'pool', 'other'].map(
    (value) => ({ value, label: _(`hospitality_core.content.category.${value}`) }),
  )
  const targetOptions = property
    ? [
        { value: 'property', label: _('hospitality_core.content.target.property') },
        ...roomTypes.map((row) => ({
          value: `room_type:${row.id}`,
          label: `${_('hospitality_core.content.target.roomType')} · ${row.name}`,
        })),
      ]
    : []
  const suffix = query ? `?${query}` : ''

  return (
    <Framed
      translator={_}
      title={_('hospitality_core.screen.content.title')}
      frame={frame}
      body={stack([
        contentFeedback(_, status),
        properties.length ? (
          <Section
            title={_('hospitality_core.screen.content.selection')}
            description={_('hospitality_core.screen.content.selectionHint')}
            body={
              <RecordForm
                action="/admin/hospitality/content"
                method="get"
                layout="inline"
                fields={[
                  {
                    name: 'property',
                    label: _('hospitality_core.content.field.property'),
                    type: 'select',
                    value: propertyId,
                    options: choices(properties),
                    required: true,
                  },
                  {
                    name: 'target',
                    label: _('hospitality_core.content.field.target'),
                    type: 'select',
                    value: target,
                    options: targetOptions,
                    required: true,
                  },
                ]}
                hidden={{ lang: locale }}
                submit={_('hospitality_core.action.select')}
                submitVariant="secondary"
              />
            }
          />
        ) : (
          emptyState(
            _('hospitality_core.screen.content.noProperty'),
            _('hospitality_core.screen.content.noPropertyHint'),
          )
        ),
        ...(property
          ? [
              <CardGrid
                items={[
                  {
                    id: 'target',
                    label: _('hospitality_core.content.metric.target'),
                    value: selectedLabel,
                  },
                  {
                    id: 'images',
                    label: _('hospitality_core.content.metric.images'),
                    value: String(images.length),
                  },
                  {
                    id: 'complete',
                    label: _('hospitality_core.content.metric.completeness'),
                    value: `${completeness.percent}%`,
                    detail: _(`hospitality_core.content.metric.fields`, {
                      completed: completeness.completed,
                      total: completeness.total,
                    }),
                  },
                ]}
                id={(item) => item.id}
                card={(item) => (
                  <Metric
                    label={item.label}
                    value={item.value}
                    detail={'detail' in item ? item.detail : null}
                    tone={item.id}
                  />
                )}
              />,
              <Section
                title={_('hospitality_core.screen.content.library')}
                description={_('hospitality_core.screen.content.libraryHint')}
                body={
                  <MediaPanel
                    status="ready"
                    images={images.map((image, index) => ({
                      id: image.id,
                      src: `/files/${image.attachmentId}`,
                      alt: image.caption || image.attachment?.name || selectedLabel,
                      primary: image.primary,
                      actions: {
                        primary: `/admin/hospitality/content/images/${image.id}/primary${suffix}`,
                        remove: `/admin/hospitality/content/images/${image.id}/remove${suffix}`,
                        ...(index > 0
                          ? { moveUp: `/admin/hospitality/content/images/${image.id}/move-up${suffix}` }
                          : {}),
                        ...(index < images.length - 1
                          ? { moveDown: `/admin/hospitality/content/images/${image.id}/move-down${suffix}` }
                          : {}),
                      },
                    }))}
                    uploadAction={`/admin/hospitality/content/upload${suffix}`}
                    labels={{
                      empty: _('hospitality_core.content.media.empty'),
                      primary: _('hospitality_core.content.media.primary'),
                      makePrimary: _('hospitality_core.content.media.makePrimary'),
                      moveUp: _('hospitality_core.content.media.moveUp'),
                      moveDown: _('hospitality_core.content.media.moveDown'),
                      remove: _('hospitality_core.content.media.remove'),
                      choose: _('hospitality_core.content.media.choose'),
                      add: _('hospitality_core.content.media.add'),
                    }}
                    extension={
                      images.length ? (
                        <FormCluster
                          label={_('hospitality_core.content.metadata.group')}
                          forms={images.map((image) => (
                            <RecordForm
                              action={`/admin/hospitality/content/images/${image.id}/metadata${suffix}`}
                              layout="inline"
                              fields={[
                                {
                                  name: 'category',
                                  label: _('hospitality_core.content.field.category'),
                                  type: 'select',
                                  value: image.category,
                                  options: categoryOptions,
                                  required: true,
                                },
                                {
                                  name: 'caption',
                                  label: _('hospitality_core.content.field.caption'),
                                  value: image.caption,
                                  placeholder: image.attachment?.name ?? null,
                                },
                              ]}
                              hidden={{ id: image.id }}
                              submit={_('hospitality_core.content.action.saveMetadata')}
                              submitVariant="secondary"
                              submitSize="compact"
                            />
                          ))}
                        />
                      ) : undefined
                    }
                  />
                }
              />,
            ]
          : []),
      ])}
    />
  )
}

type Choice = { id: string; code?: string; name: string; propertyId?: string }

const choices = (rows: readonly Choice[]) =>
  rows.map((row) => ({
    value: row.id,
    label: `${row.code ? `${row.code} · ` : ''}${row.name}`,
  }))

const feedback = (_: Translator, state?: string | null): TemplateResult | null => {
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

const nightAuditFeedback = (_: Translator, state?: string | null): TemplateResult | null => {
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

const nightAuditColumns = (_: Translator, locale: string): Array<Column<NightAuditRow>> => [
  {
    key: 'date',
    label: _('hospitality_core.nightAudit.col.date'),
    cell: (row) =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
        new Date(`${row.auditDate}T12:00:00Z`),
      ),
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

export const nightAuditScreen = (
  _: Translator,
  data: {
    properties: Choice[]
    propertyId?: string
    auditDate: string
    today: string
    preview?: NightAuditPreview
    runs: NightAuditRow[]
  },
  locale: string,
  frame: Frame,
  state?: string | null,
): TemplateResult => {
  if (!data.propertyId)
    return (
      <Framed
        translator={_}
        title={_('hospitality_core.screen.nightAudit.title')}
        frame={frame}
        body={emptyState(
          _('hospitality_core.nightAudit.empty.property'),
          _('hospitality_core.nightAudit.empty.propertyHint'),
        )}
      />
    )
  const lang: Record<string, string> = { lang: locale }
  return (
    <Framed
      translator={_}
      title={_('hospitality_core.screen.nightAudit.title')}
      frame={frame}
      body={stack([
        nightAuditFeedback(_, state),
        <FormCluster
          label={_('hospitality_core.nightAudit.section.selection')}
          forms={[
            <RecordForm
              action="/admin/hospitality/night-audit"
              method="get"
              layout="inline"
              submit={_('hospitality_core.action.select')}
              submitVariant="secondary"
              hidden={{ ...lang, auditDate: data.auditDate }}
              fields={[
                {
                  name: 'property',
                  label: _('hospitality_core.menu.properties'),
                  type: 'select',
                  value: data.propertyId,
                  options: choices(data.properties),
                  required: true,
                },
              ]}
            />,
            <DatePicker
              action="/admin/hospitality/night-audit"
              label={_('hospitality_core.nightAudit.field.auditDate')}
              fields={[
                {
                  name: 'auditDate',
                  label: _('hospitality_core.nightAudit.field.auditDate'),
                  value: data.auditDate,
                  max: data.today,
                  required: true,
                },
              ]}
              hidden={{ ...lang, property: data.propertyId }}
              submit={_('hospitality_core.nightAudit.action.preview')}
            />,
          ]}
        />,
        data.preview ? (
          <CardGrid
            items={[
              {
                id: 'in-house',
                label: _('hospitality_core.nightAudit.metric.inHouse'),
                value: data.preview.inHouseCount,
              },
              {
                id: 'services',
                label: _('hospitality_core.nightAudit.metric.servicesDue'),
                value: data.preview.serviceDue,
              },
              {
                id: 'rent',
                label: _('hospitality_core.nightAudit.metric.rentDue'),
                value: data.preview.rentDue,
              },
              {
                id: 'night-audit-amount',
                label: _('hospitality_core.nightAudit.metric.estimated'),
                value: formatMoney(_, data.preview.estimatedAmount),
              },
            ]}
            id={(item) => item.id}
            card={(item) => <Metric label={item.label} value={String(item.value)} tone={item.id} />}
          />
        ) : null,
        <Section
          title={_('hospitality_core.nightAudit.section.run')}
          description={_('hospitality_core.nightAudit.section.runHint')}
          body={
            <RecordForm
              action="/admin/hospitality/night-audit"
              method="post"
              submit={_('hospitality_core.nightAudit.action.run')}
              submitVariant="primary"
              hidden={{
                ...lang,
                operation: 'request-night-audit',
                propertyId: data.propertyId,
                auditDate: data.auditDate,
              }}
              fields={[]}
            />
          }
        />,
        <Section
          title={_('hospitality_core.nightAudit.section.history')}
          description={_('hospitality_core.nightAudit.section.historyHint')}
          body={
            data.runs.length
              ? dataTable(_, { columns: nightAuditColumns(_, locale), rows: data.runs, id: (row) => row.id })
              : emptyState(
                  _('hospitality_core.nightAudit.empty.runs'),
                  _('hospitality_core.nightAudit.empty.runsHint'),
                )
          }
        />,
      ])}
    />
  )
}

const stayNoticeFeedback = (_: Translator, state?: string | null): TemplateResult | null => {
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

const stayNoticeStateTone = (state: string): 'danger' | 'warning' | 'info' | 'positive' =>
  state === 'attention'
    ? 'danger'
    : state === 'ready'
      ? 'warning'
      : state === 'submitted'
        ? 'info'
        : 'positive'

const stayNoticeDocument = (_: Translator, row: StayNoticeRow): string => {
  if (!row.documentType || !row.documentLast4) return _('hospitality_core.stayNotice.value.missing')
  return `${_(`hospitality_core.document.${row.documentType}`)} · •••• ${row.documentLast4}`
}

const stayNoticeIssues = (_: Translator, row: StayNoticeRow): string =>
  row.issueCodes.length
    ? row.issueCodes.map((item) => _(`hospitality_core.stayNotice.issue.${item}`)).join(', ')
    : _('hospitality_core.stayNotice.value.complete')

const stayNoticeColumns = (_: Translator, locale: string, timezone: string): Array<Column<StayNoticeRow>> => [
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
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(
        new Date(row.dueAt),
      ),
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

const stayNoticeHref = (locale: string, propertyId: string, state: string, noticeId: string): string => {
  const query = new URLSearchParams({ lang: locale, property: propertyId, notice: noticeId })
  if (state !== 'all') query.set('state', state)
  return `/admin/hospitality/stay-notices?${query.toString()}`
}

const stayNoticeAction = (
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

export const stayNoticesScreen = (
  _: Translator,
  data: {
    properties: Choice[]
    propertyId?: string
    state: string
    rows: StayNoticeRow[]
    selected?: StayNoticeRow
  },
  locale: string,
  timezone: string,
  frame: Frame,
  feedbackState?: string | null,
): TemplateResult => {
  if (!data.propertyId)
    return (
      <Framed
        translator={_}
        title={_('hospitality_core.screen.stayNotices.title')}
        frame={frame}
        body={emptyState(
          _('hospitality_core.stayNotice.empty.property'),
          _('hospitality_core.stayNotice.empty.propertyHint'),
        )}
      />
    )
  const counts = Object.fromEntries(
    ['attention', 'ready', 'submitted', 'confirmed'].map((state) => [
      state,
      data.rows.filter((row) => row.state === state).length,
    ]),
  )
  const visibleRows = data.state === 'all' ? data.rows : data.rows.filter((row) => row.state === data.state)
  const action = data.selected
    ? stayNoticeAction(_, data.selected, locale, data.propertyId, data.state)
    : null
  return (
    <Framed
      translator={_}
      title={_('hospitality_core.screen.stayNotices.title')}
      frame={frame}
      body={stack([
        stayNoticeFeedback(_, feedbackState),
        <Notice
          tone="info"
          title={_('hospitality_core.stayNotice.privacy.title')}
          message={_('hospitality_core.stayNotice.privacy.hint')}
        />,
        <RecordForm
          action="/admin/hospitality/stay-notices"
          method="get"
          layout="inline"
          submit={_('hospitality_core.action.select')}
          submitVariant="secondary"
          hidden={{ lang: locale }}
          fields={[
            {
              name: 'property',
              label: _('hospitality_core.menu.properties'),
              type: 'select',
              value: data.propertyId,
              options: choices(data.properties),
              required: true,
            },
            {
              name: 'state',
              label: _('hospitality_core.col.status'),
              type: 'select',
              value: data.state,
              options: ['all', 'attention', 'ready', 'submitted', 'confirmed'].map((value) => ({
                value,
                label: _(`hospitality_core.stayNotice.state.${value}`),
              })),
            },
          ]}
        />,
        <CardGrid
          items={['attention', 'ready', 'submitted', 'confirmed'].map((state) => ({
            state,
            count: Number(counts[state] ?? 0),
          }))}
          id={(item) => item.state}
          card={(item) => (
            <Metric
              label={_(`hospitality_core.stayNotice.state.${item.state}`)}
              value={String(item.count)}
              tone={item.state}
            />
          )}
        />,
        ...(data.selected
          ? [
              <Section
                title={_('hospitality_core.stayNotice.section.selected')}
                description={_('hospitality_core.stayNotice.section.selectedHint')}
                body={stack([
                  <DefinitionList
                    title={data.selected.guestName}
                    items={[
                      {
                        key: 'state',
                        term: _('hospitality_core.col.status'),
                        value: _(`hospitality_core.stayNotice.state.${data.selected.state}`),
                      },
                      {
                        key: 'document',
                        term: _('hospitality_core.stayNotice.col.document'),
                        value: stayNoticeDocument(_, data.selected),
                      },
                      {
                        key: 'reason',
                        term: _('hospitality_core.stayNotice.field.reason'),
                        value: data.selected.reason
                          ? _(`hospitality_core.stayNotice.reason.${data.selected.reason}`)
                          : _('hospitality_core.stayNotice.value.missing'),
                      },
                      {
                        key: 'readiness',
                        term: _('hospitality_core.stayNotice.col.readiness'),
                        value: stayNoticeIssues(_, data.selected),
                      },
                      {
                        key: 'evidence',
                        term: _('hospitality_core.stayNotice.field.evidenceRef'),
                        value: data.selected.receiptRef || _('hospitality_core.stayNotice.value.missing'),
                      },
                    ]}
                  />,
                  action,
                ])}
              />,
            ]
          : []),
        <Section
          title={_('hospitality_core.stayNotice.section.queue')}
          description={_('hospitality_core.stayNotice.section.queueHint')}
          body={
            visibleRows.length
              ? dataTable(_, {
                  columns: stayNoticeColumns(_, locale, timezone),
                  rows: visibleRows,
                  id: (row) => row.id,
                  rowHref: (row) => stayNoticeHref(locale, data.propertyId!, data.state, row.id),
                })
              : emptyState(
                  _('hospitality_core.stayNotice.empty.rows'),
                  _('hospitality_core.stayNotice.empty.rowsHint'),
                )
          }
        />,
      ])}
    />
  )
}

const propertyChargeColumns = (_: Translator): Array<Column<PropertyChargeRow>> => [
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

const extraLineColumns = (_: Translator): Array<Column<ExtraLineRow>> => [
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

const serviceChargeColumns = (
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

export const servicesScreen = (
  _: Translator,
  data: {
    properties: Choice[]
    propertyId?: string
    products: ServiceProductRow[]
    targets: Array<Choice & { type: 'reservation' | 'stay' }>
    propertyCharges: PropertyChargeRow[]
    extraLines: ExtraLineRow[]
    charges: ServiceChargeRow[]
    ids: { propertyCharge: string; extraLine: string; requestKey: string }
  },
  locale: string,
  timezone: string,
  frame: Frame,
  state?: string | null,
): TemplateResult => {
  const serviceQuery = new URLSearchParams({ lang: locale })
  if (data.propertyId) serviceQuery.set('property', data.propertyId)
  const baseQuery = `?${serviceQuery.toString()}`
  const activeCharges = data.charges.filter((row) => row.state === 'active')
  const totalPosted = activeCharges.reduce((sum, row) => sum + Number(row.amount), 0)
  const targetOptions = data.targets.map((row) => ({
    value: `${row.type}:${row.id}`,
    label: `${row.type === 'reservation' ? _('hospitality_core.services.target.reservation') : _('hospitality_core.services.target.stay')} · ${row.code ? `${row.code} · ` : ''}${row.name}`,
  }))
  const productOptions = data.products.map((row) => ({
    value: row.id,
    label: `${row.code ? `${row.code} · ` : ''}${row.name} · ${formatMoney(_, row.unitPrice)}`,
  }))
  const extraOptions = data.extraLines
    .filter((row) => row.active)
    .map((row) => ({
      value: row.id,
      label: `${row.description} · ${_(`hospitality_core.extraRecurrence.${row.recurrence}`)}`,
    }))

  return (
    <Framed
      translator={_}
      title={_('hospitality_core.screen.services.title')}
      frame={frame}
      body={stack([
        feedback(_, state),
        <RecordForm
          action="/admin/hospitality/services"
          method="get"
          layout="inline"
          submit={_('hospitality_core.action.select')}
          submitVariant="secondary"
          hidden={{ lang: locale }}
          fields={[
            {
              name: 'property',
              label: _('hospitality_core.menu.properties'),
              type: 'select',
              value: data.propertyId,
              options: choices(data.properties),
              required: true,
            },
          ]}
        />,
        <CardGrid
          items={[
            {
              id: 'fees',
              label: _('hospitality_core.services.metric.fees'),
              value: data.propertyCharges.length,
            },
            {
              id: 'extras',
              label: _('hospitality_core.services.metric.extras'),
              value: data.extraLines.length,
            },
            {
              id: 'posted',
              label: _('hospitality_core.services.metric.posted'),
              value: activeCharges.length,
            },
            {
              id: 'value',
              label: _('hospitality_core.services.metric.postedValue'),
              value: formatMoney(_, totalPosted),
            },
          ]}
          id={(item) => item.id}
          card={(item) => <Metric label={item.label} value={String(item.value)} tone={item.id} />}
        />,
        <Section
          title={_('hospitality_core.services.section.fees')}
          description={_('hospitality_core.services.section.feesHint')}
          body={
            <FormCluster
              label={_('hospitality_core.services.form.fee')}
              forms={[
                <RecordForm
                  action={`/admin/hospitality/services${baseQuery}`}
                  submit={_('hospitality_core.services.action.saveFee')}
                  submitVariant="secondary"
                  hidden={{
                    operation: 'save-property-charge',
                    id: data.ids.propertyCharge,
                    propertyId: data.propertyId ?? '',
                  }}
                  fields={[
                    {
                      name: 'chargeType',
                      label: _('hospitality_core.col.type'),
                      type: 'select',
                      options: ['parking', 'city_tax', 'internet', 'resort_fee', 'other'].map((value) => ({
                        value,
                        label: _(`hospitality_core.propertyCharge.${value}`),
                      })),
                      required: true,
                    },
                    { name: 'name', label: _('hospitality_core.col.name'), required: true },
                    {
                      name: 'amount',
                      label: _('hospitality_core.col.amount'),
                      type: 'decimal',
                      required: true,
                    },
                    {
                      name: 'description',
                      label: _('hospitality_core.services.field.description'),
                      type: 'textarea',
                      span: 'full',
                    },
                    {
                      name: 'active',
                      label: _('hospitality_core.field.active'),
                      type: 'checkbox',
                      value: true,
                    },
                  ]}
                />,
              ]}
            />
          }
        />,
        data.propertyCharges.length
          ? dataTable(_, {
              columns: propertyChargeColumns(_),
              rows: data.propertyCharges,
              id: (row) => row.id,
            })
          : emptyState(
              _('hospitality_core.services.empty.fees'),
              _('hospitality_core.services.empty.feesHint'),
            ),
        <Section
          title={_('hospitality_core.services.section.intentions')}
          description={_('hospitality_core.services.section.intentionsHint')}
          body={
            data.targets.length && data.products.length ? (
              <FormCluster
                label={_('hospitality_core.services.form.intention')}
                forms={[
                  <RecordForm
                    action={`/admin/hospitality/services${baseQuery}`}
                    submit={_('hospitality_core.services.action.addIntention')}
                    submitVariant="primary"
                    hidden={{
                      operation: 'save-extra-line',
                      id: data.ids.extraLine,
                    }}
                    fields={[
                      {
                        name: 'target',
                        label: _('hospitality_core.services.field.target'),
                        type: 'select',
                        options: targetOptions,
                        required: true,
                      },
                      {
                        name: 'productId',
                        label: _('hospitality_core.services.field.product'),
                        type: 'select',
                        options: productOptions,
                        required: true,
                      },
                      {
                        name: 'description',
                        label: _('hospitality_core.services.field.description'),
                        placeholder: _('hospitality_core.services.field.descriptionHint'),
                      },
                      {
                        name: 'quantity',
                        label: _('hospitality_core.col.quantity'),
                        type: 'decimal',
                        value: 1,
                        required: true,
                      },
                      {
                        name: 'unitPrice',
                        label: _('hospitality_core.services.col.unitPrice'),
                        type: 'decimal',
                        help: _('hospitality_core.services.field.unitPriceHint'),
                      },
                      {
                        name: 'recurrence',
                        label: _('hospitality_core.services.col.recurrence'),
                        type: 'select',
                        options: ['once', 'per_night', 'per_unit'].map((value) => ({
                          value,
                          label: _(`hospitality_core.extraRecurrence.${value}`),
                        })),
                        required: true,
                      },
                      {
                        name: 'active',
                        label: _('hospitality_core.field.active'),
                        type: 'checkbox',
                        value: true,
                      },
                    ]}
                  />,
                ]}
              />
            ) : (
              emptyState(
                _('hospitality_core.services.empty.catalogue'),
                _('hospitality_core.services.empty.catalogueHint'),
              )
            )
          }
        />,
        data.extraLines.length
          ? dataTable(_, { columns: extraLineColumns(_), rows: data.extraLines, id: (row) => row.id })
          : emptyState(
              _('hospitality_core.services.empty.intentions'),
              _('hospitality_core.services.empty.intentionsHint'),
            ),
        <Section
          title={_('hospitality_core.services.section.post')}
          description={_('hospitality_core.services.section.postHint')}
          body={
            extraOptions.length ? (
              <RecordForm
                action={`/admin/hospitality/services${baseQuery}`}
                submit={_('hospitality_core.services.action.post')}
                submitVariant="primary"
                hidden={{ operation: 'materialize-extra', requestKey: data.ids.requestKey }}
                fields={[
                  {
                    name: 'id',
                    label: _('hospitality_core.services.field.intention'),
                    type: 'select',
                    options: extraOptions,
                    required: true,
                  },
                  {
                    name: 'serviceDate',
                    label: _('hospitality_core.services.field.serviceDate'),
                    type: 'date',
                    help: _('hospitality_core.services.field.serviceDateHint'),
                  },
                  {
                    name: 'quantity',
                    label: _('hospitality_core.col.quantity'),
                    type: 'decimal',
                    help: _('hospitality_core.services.field.postQuantityHint'),
                  },
                ]}
              />
            ) : (
              emptyState(
                _('hospitality_core.services.empty.post'),
                _('hospitality_core.services.empty.postHint'),
              )
            )
          }
        />,
        <Section
          title={_('hospitality_core.services.section.ledger')}
          description={_('hospitality_core.services.section.ledgerHint')}
          body={
            data.charges.length
              ? dataTable(_, {
                  columns: serviceChargeColumns(_, locale, timezone),
                  rows: data.charges,
                  id: (row) => row.id,
                })
              : emptyState(
                  _('hospitality_core.services.empty.ledger'),
                  _('hospitality_core.services.empty.ledgerHint'),
                )
          }
        />,
      ])}
    />
  )
}

export const ratePlansScreen = (
  _: Translator,
  rows: RatePlanRow[],
  properties: Choice[],
  roomTypes: Choice[],
  propertyId: string | undefined,
  frame: Frame,
  state?: string | null,
): TemplateResult => (
  <Framed
    translator={_}
    title={_('hospitality_core.screen.ratePlans.title')}
    frame={frame}
    body={stack([
      feedback(_, state),
      <RecordForm
        action="/admin/hospitality/rate-plans"
        method="get"
        layout="inline"
        submit={_('hospitality_core.action.select')}
        submitVariant="secondary"
        fields={[
          {
            name: 'property',
            label: _('hospitality_core.menu.properties'),
            type: 'select',
            value: propertyId,
            options: choices(properties),
            required: true,
          },
        ]}
      />,
      <Section
        title={_('hospitality_core.screen.ratePlans.create')}
        description={_('hospitality_core.screen.ratePlans.createHint')}
        body={
          roomTypes.length ? (
            <RecordForm
              action={`/admin/hospitality/rate-plans${propertyId ? `?property=${encodeURIComponent(propertyId)}` : ''}`}
              method="post"
              submit={_('hospitality_core.action.saveRatePlan')}
              submitVariant="primary"
              hidden={{ operation: 'save-rate-plan', propertyId: propertyId ?? '' }}
              fields={[
                {
                  name: 'roomTypeId',
                  label: _('hospitality_core.col.roomType'),
                  type: 'select',
                  options: choices(roomTypes),
                  required: true,
                },
                { name: 'code', label: _('hospitality_core.col.code'), required: true },
                { name: 'name', label: _('hospitality_core.col.name'), required: true },
                {
                  name: 'rateType',
                  label: _('hospitality_core.col.rateType'),
                  type: 'select',
                  value: 'nightly',
                  options: ['nightly', 'hourly', 'weekly', 'monthly'].map((value) => ({
                    value,
                    label: _(`hospitality_core.bookingType.${value}`),
                  })),
                  required: true,
                },
                { name: 'amount', label: _('hospitality_core.col.amount'), type: 'decimal', required: true },
                {
                  name: 'mealPlan',
                  label: _('hospitality_core.col.mealPlan'),
                  type: 'select',
                  options: [
                    { value: '', label: '—' },
                    ...['RO', 'BB', 'HB', 'FB', 'AI'].map((value) => ({
                      value,
                      label: _(`hospitality_core.mealPlan.${value}`),
                    })),
                  ],
                },
                { name: 'minStay', label: _('hospitality_core.field.minStay'), type: 'number', value: 0 },
                { name: 'maxStay', label: _('hospitality_core.field.maxStay'), type: 'number', value: 0 },
                {
                  name: 'isDefault',
                  label: _('hospitality_core.field.isDefault'),
                  type: 'checkbox',
                  help: _('hospitality_core.field.isDefaultHint'),
                },
                { name: 'active', label: _('hospitality_core.field.active'), type: 'checkbox', value: true },
              ]}
            />
          ) : (
            emptyState(
              _('hospitality_core.screen.ratePlans.noRoomTypes'),
              _('hospitality_core.screen.ratePlans.noRoomTypesHint'),
            )
          )
        }
      />,
      <Section
        title={_('hospitality_core.screen.ratePlans.list')}
        body={
          rows.length
            ? dataTable(_, { columns: ratePlanColumns(_), rows, id: (row) => row.id })
            : emptyState(
                _('hospitality_core.screen.ratePlans.empty'),
                _('hospitality_core.screen.ratePlans.emptyHint'),
              )
        }
      />,
    ])}
  />
)

export const inventoryScreen = (
  _: Translator,
  rows: InventoryRow[],
  properties: Choice[],
  roomTypes: Choice[],
  selected: { propertyId?: string; roomTypeId?: string; from: string; to: string },
  frame: Frame,
  state?: string | null,
): TemplateResult => {
  const selectedRoomTypes = roomTypes.filter((row) => row.propertyId === selected.propertyId)
  const hidden = {
    propertyId: selected.propertyId ?? '',
    roomTypeId: selected.roomTypeId ?? '',
  }
  return (
    <Framed
      translator={_}
      title={_('hospitality_core.screen.inventory.title')}
      frame={frame}
      body={stack([
        feedback(_, state),
        <FormCluster
          label={_('hospitality_core.screen.inventory.filters')}
          forms={[
            <RecordForm
              action="/admin/hospitality/inventory"
              method="get"
              layout="inline"
              submit={_('hospitality_core.action.select')}
              submitVariant="secondary"
              hidden={{ from: selected.from, to: selected.to }}
              fields={[
                {
                  name: 'property',
                  label: _('hospitality_core.menu.properties'),
                  type: 'select',
                  value: selected.propertyId,
                  options: choices(properties),
                  required: true,
                },
                {
                  name: 'roomType',
                  label: _('hospitality_core.col.roomType'),
                  type: 'select',
                  value: selected.roomTypeId,
                  options: choices(selectedRoomTypes),
                  required: true,
                },
              ]}
            />,
            <DatePicker
              action="/admin/hospitality/inventory"
              label={_('hospitality_core.screen.inventory.dateRange')}
              fields={[
                {
                  name: 'from',
                  label: _('hospitality_core.field.from'),
                  value: selected.from,
                  required: true,
                },
                { name: 'to', label: _('hospitality_core.field.to'), value: selected.to, required: true },
              ]}
              hidden={{
                property: selected.propertyId ?? '',
                roomType: selected.roomTypeId ?? '',
              }}
              submit={_('hospitality_core.action.apply')}
            />,
          ]}
        />,
        <CardGrid
          items={[
            { id: 'days', label: _('hospitality_core.metric.inventoryDays'), value: rows.length },
            {
              id: 'available',
              label: _('hospitality_core.metric.minimumAvailable'),
              value: rows.length ? Math.min(...rows.map((row) => row.available)) : 0,
            },
            {
              id: 'sold',
              label: _('hospitality_core.metric.sold'),
              value: rows.reduce((sum, row) => sum + row.sold, 0),
            },
            {
              id: 'blocked',
              label: _('hospitality_core.metric.blocked'),
              value: rows.reduce((sum, row) => sum + row.blocked, 0),
            },
          ]}
          id={(item) => item.id}
          card={(item) => <Metric label={item.label} value={String(item.value)} tone={item.id} />}
        />,
        <Section
          title={_('hospitality_core.screen.inventory.allotment')}
          description={_('hospitality_core.screen.inventory.allotmentHint')}
          body={
            selected.roomTypeId ? (
              <RecordForm
                action="/admin/hospitality/inventory"
                method="post"
                submit={_('hospitality_core.action.updateAllotment')}
                submitVariant="primary"
                hidden={{ ...hidden, operation: 'set-inventory' }}
                fields={[
                  {
                    name: 'from',
                    label: _('hospitality_core.field.from'),
                    type: 'date',
                    value: selected.from,
                    required: true,
                  },
                  {
                    name: 'to',
                    label: _('hospitality_core.field.to'),
                    type: 'date',
                    value: selected.to,
                    required: true,
                  },
                  { name: 'total', label: _('hospitality_core.col.total'), type: 'number', required: true },
                  { name: 'blocked', label: _('hospitality_core.col.blocked'), type: 'number' },
                ]}
              />
            ) : (
              emptyState(
                _('hospitality_core.screen.inventory.noRoomType'),
                _('hospitality_core.screen.inventory.noRoomTypeHint'),
              )
            )
          }
        />,
        <Section
          title={_('hospitality_core.screen.inventory.restrictions')}
          description={_('hospitality_core.screen.inventory.restrictionsHint')}
          body={
            selected.roomTypeId ? (
              <RecordForm
                action="/admin/hospitality/inventory"
                method="post"
                submit={_('hospitality_core.action.updateRestrictions')}
                submitVariant="secondary"
                hidden={{ ...hidden, operation: 'set-restrictions' }}
                fields={[
                  {
                    name: 'from',
                    label: _('hospitality_core.field.from'),
                    type: 'date',
                    value: selected.from,
                    required: true,
                  },
                  {
                    name: 'to',
                    label: _('hospitality_core.field.to'),
                    type: 'date',
                    value: selected.to,
                    required: true,
                  },
                  { name: 'minLos', label: _('hospitality_core.field.minLos'), type: 'number', value: 0 },
                  { name: 'maxLos', label: _('hospitality_core.field.maxLos'), type: 'number', value: 0 },
                  { name: 'stopSell', label: _('hospitality_core.restriction.stopSell'), type: 'checkbox' },
                  { name: 'closedToArrival', label: _('hospitality_core.restriction.cta'), type: 'checkbox' },
                  {
                    name: 'closedToDeparture',
                    label: _('hospitality_core.restriction.ctd'),
                    type: 'checkbox',
                  },
                ]}
              />
            ) : null
          }
        />,
        rows.length
          ? dataTable(_, { columns: inventoryColumns(_), rows, id: (row) => row.id })
          : emptyState(
              _('hospitality_core.screen.inventory.empty'),
              _('hospitality_core.screen.inventory.emptyHint'),
            ),
      ])}
    />
  )
}

const reservationColumns = (
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
    key: 'checkIn',
    label: _('hospitality_core.col.checkIn'),
    cell: (row) => dateTime(row.checkIn, locale, timezone),
    kind: 'date',
  },
  {
    key: 'checkOut',
    label: _('hospitality_core.col.checkOut'),
    cell: (row) => dateTime(row.checkOut, locale, timezone),
    kind: 'date',
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
    cell: (row) =>
      badge(_(`hospitality_core.reservationState.${row.state}`), workflowTone(row.state), row.state),
    kind: 'status',
    priority: 'primary',
  },
]

const stayColumns = (_: Translator, locale: string, timezone: string): Array<Column<StayRow>> => [
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
    key: 'room',
    label: _('hospitality_core.col.room'),
    cell: (row) => row.currentRoom?.name ?? row.currentRoom?.code ?? '—',
  },
  {
    key: 'checkIn',
    label: _('hospitality_core.col.checkIn'),
    cell: (row) => dateTime(row.checkIn, locale, timezone),
    kind: 'date',
  },
  {
    key: 'checkOut',
    label: _('hospitality_core.col.checkOut'),
    cell: (row) => dateTime(row.checkOut, locale, timezone),
    kind: 'date',
  },
  {
    key: 'guests',
    label: _('hospitality_core.col.guests'),
    cell: (row) => String(row.adults + row.children),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'status',
    label: _('hospitality_core.col.status'),
    cell: (row) => badge(_(`hospitality_core.stayState.${row.state}`), workflowTone(row.state), row.state),
    kind: 'status',
    priority: 'primary',
  },
]

const folioColumns = (_: Translator, locale: string, timezone: string): Array<Column<FolioRow>> => [
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

const folioChargeColumns = (
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
    cell: (row) =>
      row.type === 'room' && row.description.startsWith('room:')
        ? _('hospitality_core.folio.charge.roomDescription')
        : row.description,
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

const folioStayColumns = (_: Translator, locale: string, timezone: string): Array<Column<FolioStayRow>> => [
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

export const frontDeskScreen = (
  _: Translator,
  rows: StayRow[],
  overdueRows: StayRow[],
  totals: { arrivals: number; inHouse: number; departures: number; overdue: number; openFolios: number },
  locale: string,
  timezone: string,
  frame: Frame,
): TemplateResult => (
  <Framed
    translator={_}
    title={_('hospitality_core.screen.frontDesk.title')}
    frame={frame}
    body={stack([
      <CardGrid
        items={[
          { id: 'arrivals', label: _('hospitality_core.metric.arrivals'), value: totals.arrivals },
          { id: 'in-house', label: _('hospitality_core.metric.inHouse'), value: totals.inHouse },
          { id: 'departures', label: _('hospitality_core.metric.departures'), value: totals.departures },
          { id: 'overdue', label: _('hospitality_core.metric.overdue'), value: totals.overdue },
          { id: 'folios', label: _('hospitality_core.metric.openFolios'), value: totals.openFolios },
        ]}
        id={(item) => item.id}
        card={(item) => <Metric label={item.label} value={String(item.value)} tone={item.id} />}
      />,
      overdueRows.length ? (
        <Section
          title={_('hospitality_core.screen.frontDesk.overdue')}
          description={_('hospitality_core.screen.frontDesk.overdueHint', {
            count: overdueRows.length,
          })}
          body={dataTable(_, {
            columns: stayColumns(_, locale, timezone),
            rows: overdueRows,
            id: (row) => row.id,
          })}
        />
      ) : null,
      rows.length
        ? dataTable(_, { columns: stayColumns(_, locale, timezone), rows, id: (row) => row.id })
        : emptyState(
            _('hospitality_core.screen.frontDesk.empty'),
            _('hospitality_core.screen.frontDesk.emptyHint'),
          ),
    ])}
  />
)

const reservationFeedback = (_: Translator, status?: string | null): TemplateResult | null => {
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

export const reservationsScreen = (
  _: Translator,
  data: {
    rows: ReservationRow[]
    properties: Choice[]
    roomTypes: Choice[]
    partners: Choice[]
    values: ReservationIntakeValues
    quote?: ReservationQuote | null
  },
  locale: string,
  timezone: string,
  frame: Frame,
  status?: string | null,
): TemplateResult => {
  const errors = (data.quote?.errors ?? []).map((error) =>
    error.messageKey ? _(error.messageKey, error.params) : _('hospitality_core.feedback.invalid'),
  )
  const quote = data.quote?.ok ? data.quote : null
  return (
    <Framed
      translator={_}
      title={_('hospitality_core.screen.reservations.title')}
      frame={frame}
      body={stack([
        reservationFeedback(_, status),
        <RecordForm
          action="/admin/hospitality/reservations"
          method="get"
          layout="inline"
          submit={_('hospitality_core.action.select')}
          submitVariant="secondary"
          hidden={{ lang: locale }}
          fields={[
            {
              name: 'property',
              label: _('hospitality_core.reservation.field.property'),
              type: 'select',
              value: data.values.propertyId,
              options: choices(data.properties),
              required: true,
            },
          ]}
        />,
        <Section
          title={_('hospitality_core.reservation.section.intake')}
          description={_('hospitality_core.reservation.section.intakeHint')}
          body={
            data.roomTypes.length && data.partners.length ? (
              <RecordForm
                action="/admin/hospitality/reservations"
                method="post"
                submit={_('hospitality_core.reservation.action.quote')}
                submitVariant="primary"
                errors={errors}
                hidden={{
                  operation: 'quote',
                  lang: locale,
                  property: data.values.propertyId,
                  id: data.values.id,
                }}
                fields={[
                  {
                    name: 'code',
                    label: _('hospitality_core.reservation.field.code'),
                    value: data.values.code,
                    help: _('hospitality_core.reservation.field.codeHint'),
                  },
                  {
                    name: 'partnerId',
                    label: _('hospitality_core.reservation.field.guest'),
                    type: 'select',
                    value: data.values.partnerId,
                    options: [
                      { value: '', label: _('hospitality_core.reservation.value.selectGuest') },
                      ...choices(data.partners),
                    ],
                    required: true,
                  },
                  {
                    name: 'roomTypeId',
                    label: _('hospitality_core.reservation.field.roomType'),
                    type: 'select',
                    value: data.values.roomTypeId,
                    options: choices(data.roomTypes),
                    required: true,
                  },
                  {
                    name: 'bookingType',
                    label: _('hospitality_core.reservation.field.bookingType'),
                    type: 'select',
                    value: data.values.bookingType,
                    options: ['nightly', 'weekly', 'monthly'].map((value) => ({
                      value,
                      label: _(`hospitality_core.bookingType.${value}`),
                    })),
                    required: true,
                  },
                  {
                    name: 'checkIn',
                    label: _('hospitality_core.col.checkIn'),
                    type: 'datetime-local',
                    value: data.values.checkIn,
                    required: true,
                  },
                  {
                    name: 'checkOut',
                    label: _('hospitality_core.col.checkOut'),
                    type: 'datetime-local',
                    value: data.values.checkOut,
                    required: true,
                  },
                  {
                    name: 'adults',
                    label: _('hospitality_core.reservation.field.adults'),
                    type: 'number',
                    value: data.values.adults,
                    required: true,
                    step: '1',
                  },
                  {
                    name: 'children',
                    label: _('hospitality_core.reservation.field.children'),
                    type: 'number',
                    value: data.values.children,
                    required: true,
                    step: '1',
                  },
                  {
                    name: 'rate',
                    label: _('hospitality_core.reservation.field.rate'),
                    type: 'decimal',
                    value: data.values.rate,
                    help: _('hospitality_core.reservation.field.rateHint'),
                  },
                ]}
              />
            ) : (
              emptyState(
                data.roomTypes.length
                  ? _('hospitality_core.reservation.empty.partners')
                  : _('hospitality_core.reservation.empty.roomTypes'),
                data.roomTypes.length
                  ? _('hospitality_core.reservation.empty.partnersHint')
                  : _('hospitality_core.reservation.empty.roomTypesHint'),
              )
            )
          }
        />,
        ...(quote
          ? [
              <Section
                title={_('hospitality_core.reservation.section.quote')}
                description={_('hospitality_core.reservation.section.quoteHint')}
                body={stack([
                  <CardGrid
                    items={[
                      {
                        id: 'rate',
                        label: _('hospitality_core.reservation.quote.rate'),
                        value: formatMoney(_, quote.rate ?? 0),
                      },
                      {
                        id: 'quantity',
                        label: _('hospitality_core.reservation.quote.quantity'),
                        value: String(quote.quantity ?? 0),
                      },
                      {
                        id: 'availability',
                        label: _('hospitality_core.reservation.quote.availability'),
                        value: String(quote.minimumAvailable ?? 0),
                      },
                      {
                        id: 'total',
                        label: _('hospitality_core.reservation.quote.total'),
                        value: formatMoney(_, quote.amountTotal ?? 0),
                      },
                    ]}
                    id={(item) => item.id}
                    card={(item) => <Metric label={item.label} value={item.value} tone={item.id} />}
                  />,
                  <RecordForm
                    action="/admin/hospitality/reservations"
                    method="post"
                    submit={_('hospitality_core.reservation.action.create')}
                    submitVariant="primary"
                    hidden={{
                      operation: 'create',
                      lang: locale,
                      property: data.values.propertyId,
                      id: data.values.id,
                      code: data.values.code,
                      partnerId: data.values.partnerId,
                      roomTypeId: data.values.roomTypeId,
                      bookingType: data.values.bookingType,
                      checkIn: data.values.checkIn,
                      checkOut: data.values.checkOut,
                      adults: String(data.values.adults),
                      children: String(data.values.children),
                      rate: String(quote.rate ?? ''),
                    }}
                    fields={[]}
                  />,
                ])}
              />,
            ]
          : []),
        <Section
          title={_('hospitality_core.reservation.section.list')}
          description={_('hospitality_core.reservation.section.listHint')}
          body={
            data.rows.length
              ? dataTable(_, {
                  columns: reservationColumns(_, locale, timezone),
                  rows: data.rows,
                  id: (row) => row.id,
                })
              : emptyState(
                  _('hospitality_core.screen.reservations.empty'),
                  _('hospitality_core.screen.reservations.emptyHint'),
                )
          }
        />,
      ])}
    />
  )
}

const reservationDetailFeedback = (
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

export const reservationDetailScreen = (
  _: Translator,
  reservation: ReservationDetail,
  rooms: RoomRow[],
  roomTypes: Choice[],
  partners: Choice[],
  amendment: ReservationAmendmentValues,
  departure: string,
  locale: string,
  timezone: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult => {
  const guest = guestName(reservation)
  const room = reservation.stay?.currentRoom
  const backHref = `/admin/hospitality/reservations?property=${encodeURIComponent(reservation.propertyId)}&lang=${encodeURIComponent(locale)}`
  const action = `/admin/hospitality/reservations/${encodeURIComponent(reservation.id)}?lang=${encodeURIComponent(locale)}`
  const actions: TemplateResult[] = []

  if (reservation.state === 'confirmed' && reservation.provider === 'direct') {
    actions.push(
      <Section
        title={_('hospitality_core.reservation.action.amend')}
        description={_('hospitality_core.reservation.action.amendHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.reservation.action.amend')}
            submitVariant="secondary"
            hidden={{ operation: 'amend', lang: locale }}
            fields={[
              {
                name: 'partnerId',
                label: _('hospitality_core.reservation.field.guest'),
                type: 'select',
                value: amendment.partnerId,
                options: choices(partners),
                required: true,
              },
              {
                name: 'roomTypeId',
                label: _('hospitality_core.reservation.field.roomType'),
                type: 'select',
                value: amendment.roomTypeId,
                options: choices(roomTypes),
                required: true,
              },
              {
                name: 'checkIn',
                label: _('hospitality_core.col.checkIn'),
                type: 'datetime-local',
                value: amendment.checkIn,
                required: true,
              },
              {
                name: 'checkOut',
                label: _('hospitality_core.col.checkOut'),
                type: 'datetime-local',
                value: amendment.checkOut,
                required: true,
              },
              {
                name: 'adults',
                label: _('hospitality_core.reservation.field.adults'),
                type: 'number',
                value: amendment.adults,
                step: '1',
                required: true,
              },
              {
                name: 'children',
                label: _('hospitality_core.reservation.field.children'),
                type: 'number',
                value: amendment.children,
                step: '1',
                required: true,
              },
              {
                name: 'rate',
                label: _('hospitality_core.reservation.field.rate'),
                type: 'decimal',
                value: amendment.rate,
                required: true,
              },
            ]}
          />
        }
      />,
    )
  }

  if (reservation.state === 'confirmed' && reservation.stayId) {
    actions.push(
      <Section
        title={_('hospitality_core.reservation.action.checkIn')}
        description={_('hospitality_core.reservation.action.checkInHint')}
        body={
          rooms.length ? (
            <RecordForm
              action={action}
              method="post"
              submit={_('hospitality_core.reservation.action.checkIn')}
              submitVariant="primary"
              hidden={{ operation: 'check-in', lang: locale }}
              fields={[
                {
                  name: 'roomId',
                  label: _('hospitality_core.reservation.field.room'),
                  type: 'select',
                  required: true,
                  options: rooms.map((candidate) => ({
                    value: candidate.id,
                    label: `${candidate.code} · ${candidate.name}`,
                  })),
                },
              ]}
            />
          ) : (
            emptyState(
              _('hospitality_core.reservation.empty.availableRooms'),
              _('hospitality_core.reservation.empty.availableRoomsHint'),
            )
          )
        }
      />,
    )
  }

  if (reservation.state === 'checked_in' && reservation.stayId) {
    actions.push(
      <Section
        title={_('hospitality_core.reservation.action.adjustDeparture')}
        description={_('hospitality_core.reservation.action.adjustDepartureHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.reservation.action.adjustDeparture')}
            submitVariant="secondary"
            hidden={{ operation: 'adjust-departure', lang: locale }}
            fields={[
              {
                name: 'checkOut',
                label: _('hospitality_core.col.checkOut'),
                type: 'datetime-local',
                value: departure,
                required: true,
              },
            ]}
          />
        }
      />,
      <Section
        title={_('hospitality_core.reservation.action.checkOut')}
        description={_('hospitality_core.reservation.action.checkOutHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.reservation.action.checkOut')}
            submitVariant="primary"
            hidden={{ operation: 'check-out', lang: locale }}
            fields={[]}
          />
        }
      />,
    )
  }

  if (reservation.state === 'draft' || reservation.state === 'confirmed') {
    if (reservation.state === 'confirmed')
      actions.push(
        <Section
          title={_('hospitality_core.reservation.action.noShow')}
          description={_('hospitality_core.reservation.action.noShowHint')}
          body={
            <RecordForm
              action={action}
              method="post"
              submit={_('hospitality_core.reservation.action.noShow')}
              submitVariant="destructive"
              hidden={{ operation: 'no-show', lang: locale }}
              fields={[
                {
                  name: 'reason',
                  label: _('hospitality_core.reservation.field.noShowReason'),
                  type: 'textarea',
                  help: _('hospitality_core.reservation.field.noShowReasonHint'),
                  required: true,
                },
              ]}
            />
          }
        />,
      )
    actions.push(
      <Section
        title={_('hospitality_core.reservation.action.cancel')}
        description={_('hospitality_core.reservation.action.cancelHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.reservation.action.cancel')}
            submitVariant="destructive"
            hidden={{ operation: 'cancel', lang: locale }}
            fields={[
              {
                name: 'reason',
                label: _('hospitality_core.reservation.field.cancelReason'),
                type: 'textarea',
                help: _('hospitality_core.reservation.field.cancelReasonHint'),
              },
            ]}
          />
        }
      />,
    )
  }

  return (
    <Framed
      translator={_}
      title={_('hospitality_core.reservation.detail.title', { code: reservation.code })}
      frame={frame}
      body={stack([
        reservationDetailFeedback(_, status, errors),
        <RecordWorkspace
          kicker={_('hospitality_core.reservation.detail.kicker')}
          title={reservation.code}
          subtitle={guest}
          imageFallback={icon('hotel')}
          badges={[
            badge(
              _(`hospitality_core.reservationState.${reservation.state}`),
              workflowTone(reservation.state),
              reservation.state,
            ),
            badge(providerName(_, reservation.provider), 'neutral'),
          ]}
          summary={[
            {
              id: 'room-type',
              label: _('hospitality_core.col.roomType'),
              value: reservation.roomType?.name ?? reservation.roomTypeId,
            },
            {
              id: 'guests',
              label: _('hospitality_core.col.guests'),
              value: reservation.adults + reservation.children,
            },
            {
              id: 'total',
              label: _('hospitality_core.col.amount'),
              value: formatMoney(_, reservation.amountTotal),
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.reservation.action.back'),
            href: backHref,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.reservation.detail.stay')}
              description={_('hospitality_core.reservation.detail.stayHint')}
              body={
                <DefinitionList
                  title={reservation.code}
                  items={[
                    {
                      key: 'guest',
                      term: _('hospitality_core.reservation.field.guest'),
                      value: guest,
                    },
                    {
                      key: 'room',
                      term: _('hospitality_core.reservation.field.room'),
                      value: room?.name ?? room?.code ?? _('hospitality_core.reservation.value.unassigned'),
                    },
                    {
                      key: 'check-in',
                      term: _('hospitality_core.col.checkIn'),
                      value: dateTime(reservation.checkIn, locale, timezone),
                    },
                    {
                      key: 'check-out',
                      term: _('hospitality_core.col.checkOut'),
                      value: dateTime(reservation.checkOut, locale, timezone),
                    },
                    {
                      key: 'booking-type',
                      term: _('hospitality_core.reservation.field.bookingType'),
                      value: _(`hospitality_core.bookingType.${reservation.bookingType}`),
                    },
                    {
                      key: 'billing',
                      term: _('hospitality_core.reservation.field.billingMode'),
                      value: _(`hospitality_core.billing.${reservation.billingMode}`),
                    },
                    {
                      key: 'rate',
                      term: _('hospitality_core.reservation.field.rate'),
                      value: formatMoney(_, reservation.rate),
                    },
                    {
                      key: 'quantity',
                      term: _('hospitality_core.reservation.quote.quantity'),
                      value: String(reservation.quantity),
                    },
                    {
                      key: 'folio',
                      term: _('hospitality_core.reservation.field.folio'),
                      value: reservation.folio?.code ?? reservation.folioId,
                    },
                    ...(reservation.cancelReason
                      ? [
                          {
                            key: 'cancel-reason',
                            term: _('hospitality_core.reservation.field.cancelReason'),
                            value: reservation.cancelReason,
                          },
                        ]
                      : []),
                  ]}
                />
              }
            />,
            ...actions,
          ])}
        />,
      ])}
    />
  )
}

const stayAssignmentColumns = (
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

const stayGuestColumns = (_: Translator): Array<Column<StayGuestRow>> => [
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

const guestDocumentColumns = (_: Translator): Array<Column<GuestDocumentRow>> => [
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

const stayDetailFeedback = (
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

export const stayDetailScreen = (
  _: Translator,
  stay: StayRow,
  rooms: RoomRow[],
  partners: Choice[],
  documents: GuestDocumentRow[],
  documentId: string,
  locale: string,
  timezone: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult => {
  const guest = guestName(stay)
  const action = `/admin/hospitality/stays/${encodeURIComponent(stay.id)}?lang=${encodeURIComponent(locale)}`
  const roomNames = new Map(rooms.map((room) => [room.id, `${room.code} · ${room.name}`]))
  const assignments = (stay.assignments ?? []).map((assignment) => ({
    ...assignment,
    roomName: roomNames.get(assignment.roomId) ?? assignment.roomId,
  }))
  const guests = stay.guests ?? []
  const registeredGuests = guests.filter(
    (registered): registered is StayGuestRow & { partnerId: string } => !!registered.partnerId,
  )
  const availableRooms = rooms.filter(
    (room) => room.active && room.status === 'available' && room.id !== stay.currentRoomId,
  )

  return (
    <Framed
      translator={_}
      title={_('hospitality_core.stay.detail.title', { code: stay.code })}
      frame={frame}
      body={stack([
        stayDetailFeedback(_, status, errors),
        <RecordWorkspace
          kicker={_('hospitality_core.stay.detail.kicker')}
          title={stay.code}
          subtitle={guest}
          imageFallback={icon('hotel')}
          badges={[
            badge(_(`hospitality_core.stayState.${stay.state}`), workflowTone(stay.state), stay.state),
            badge(_(`hospitality_core.bookingType.${stay.bookingType}`), 'neutral'),
          ]}
          summary={[
            {
              id: 'room',
              label: _('hospitality_core.stay.field.room'),
              value:
                stay.currentRoom?.name ??
                stay.currentRoom?.code ??
                _('hospitality_core.reservation.value.unassigned'),
            },
            {
              id: 'guests',
              label: _('hospitality_core.col.guests'),
              value: guests.length,
            },
            {
              id: 'rate',
              label: _('hospitality_core.reservation.field.rate'),
              value: formatMoney(_, stay.rate),
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.stay.action.back'),
            href: `/admin/hospitality/stays?property=${encodeURIComponent(stay.propertyId)}&lang=${encodeURIComponent(locale)}`,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.stay.section.information')}
              description={_('hospitality_core.stay.section.informationHint')}
              body={
                <DefinitionList
                  title={stay.code}
                  items={[
                    {
                      key: 'guest',
                      term: _('hospitality_core.reservation.field.guest'),
                      value: guest,
                    },
                    {
                      key: 'room-type',
                      term: _('hospitality_core.col.roomType'),
                      value: stay.roomType?.name ?? stay.roomTypeId,
                    },
                    {
                      key: 'check-in',
                      term: _('hospitality_core.col.checkIn'),
                      value: dateTime(stay.checkIn, locale, timezone),
                    },
                    {
                      key: 'check-out',
                      term: _('hospitality_core.col.checkOut'),
                      value: dateTime(stay.checkOut, locale, timezone),
                    },
                    {
                      key: 'billing',
                      term: _('hospitality_core.reservation.field.billingMode'),
                      value: _(`hospitality_core.billing.${stay.billingMode}`),
                    },
                    ...(stay.nextBillDate
                      ? [
                          {
                            key: 'next-bill',
                            term: _('hospitality_core.stay.field.nextBillDate'),
                            value: stay.nextBillDate,
                          },
                        ]
                      : []),
                    {
                      key: 'folio',
                      term: _('hospitality_core.reservation.field.folio'),
                      value: stay.folioId,
                    },
                    ...(stay.reservationId
                      ? [
                          {
                            key: 'reservation',
                            term: _('hospitality_core.stay.field.reservation'),
                            value: stay.reservation?.code ?? stay.reservationId,
                          },
                        ]
                      : []),
                  ]}
                />
              }
            />,
            <Section
              title={_('hospitality_core.stay.section.assignments')}
              description={_('hospitality_core.stay.section.assignmentsHint')}
              body={stack([
                assignments.length
                  ? dataTable(_, {
                      columns: stayAssignmentColumns(_, locale, timezone),
                      rows: assignments,
                      id: (assignment) => assignment.id,
                    })
                  : emptyState(
                      _('hospitality_core.stay.empty.assignments'),
                      _('hospitality_core.stay.empty.assignmentsHint'),
                    ),
                stay.state === 'checked_in' ? (
                  availableRooms.length ? (
                    <RecordForm
                      action={action}
                      method="post"
                      submit={_('hospitality_core.stay.action.moveRoom')}
                      submitVariant="secondary"
                      hidden={{ operation: 'move-room', lang: locale }}
                      fields={[
                        {
                          name: 'roomId',
                          label: _('hospitality_core.stay.field.newRoom'),
                          type: 'select',
                          required: true,
                          options: availableRooms.map((room) => ({
                            value: room.id,
                            label: `${room.code} · ${room.name} · ${room.roomType?.name ?? room.roomTypeId}`,
                          })),
                        },
                        {
                          name: 'reason',
                          label: _('hospitality_core.stay.field.moveReason'),
                          type: 'textarea',
                          required: true,
                          help: _('hospitality_core.stay.field.moveReasonHint'),
                        },
                      ]}
                    />
                  ) : (
                    <Notice
                      title={_('hospitality_core.stay.empty.availableRooms')}
                      message={_('hospitality_core.stay.empty.availableRoomsHint')}
                      tone="warning"
                    />
                  )
                ) : null,
              ])}
            />,
            <Section
              title={_('hospitality_core.stay.section.guests')}
              description={_('hospitality_core.stay.section.guestsHint')}
              body={stack([
                guests.length
                  ? dataTable(_, { columns: stayGuestColumns(_), rows: guests, id: (row) => row.id })
                  : emptyState(
                      _('hospitality_core.stay.empty.guests'),
                      _('hospitality_core.stay.empty.guestsHint'),
                    ),
                stay.state === 'draft' || stay.state === 'checked_in' ? (
                  <RecordForm
                    action={action}
                    method="post"
                    submit={_('hospitality_core.stay.action.addGuest')}
                    submitVariant="secondary"
                    hidden={{ operation: 'add-guest', lang: locale }}
                    fields={[
                      {
                        name: 'displayName',
                        label: _('hospitality_core.stay.field.guestName'),
                        required: true,
                      },
                      {
                        name: 'partnerId',
                        label: _('hospitality_core.stay.field.linkedPartner'),
                        type: 'select',
                        options: [
                          { value: '', label: _('hospitality_core.stay.value.noLinkedPartner') },
                          ...choices(partners),
                        ],
                        help: _('hospitality_core.stay.field.linkedPartnerHint'),
                      },
                    ]}
                  />
                ) : null,
              ])}
            />,
            <Section
              title={_('hospitality_core.stay.section.documents')}
              description={_('hospitality_core.stay.section.documentsHint')}
              body={stack([
                documents.length
                  ? dataTable(_, {
                      columns: guestDocumentColumns(_),
                      rows: documents,
                      id: (row) => row.id,
                    })
                  : emptyState(
                      _('hospitality_core.stay.empty.documents'),
                      _('hospitality_core.stay.empty.documentsHint'),
                    ),
                stay.state !== 'cancelled' ? (
                  registeredGuests.length ? (
                    <RecordForm
                      action={action}
                      method="post"
                      submit={_('hospitality_core.stay.action.saveDocument')}
                      submitVariant="secondary"
                      hidden={{
                        operation: 'save-document',
                        documentId,
                        lang: locale,
                      }}
                      fields={[
                        {
                          name: 'partnerId',
                          label: _('hospitality_core.stay.document.guest'),
                          type: 'select',
                          required: true,
                          options: registeredGuests.map((registered) => ({
                            value: registered.partnerId,
                            label: registered.displayName,
                          })),
                        },
                        {
                          name: 'type',
                          label: _('hospitality_core.stay.document.type'),
                          type: 'select',
                          required: true,
                          value: 'cccd',
                          options: DOCUMENT_TYPES.map((value) => ({
                            value,
                            label: _(`hospitality_core.document.${value}`),
                          })),
                        },
                        {
                          name: 'number',
                          label: _('hospitality_core.stay.document.number'),
                          required: true,
                          help: _('hospitality_core.stay.document.numberHint'),
                        },
                        {
                          name: 'fullName',
                          label: _('hospitality_core.stay.document.fullName'),
                          required: true,
                          value: registeredGuests[0]?.displayName ?? '',
                        },
                        {
                          name: 'dateOfBirth',
                          label: _('hospitality_core.stay.document.dateOfBirth'),
                          type: 'date',
                          required: true,
                        },
                        {
                          name: 'gender',
                          label: _('hospitality_core.stay.document.gender'),
                          type: 'select',
                          options: [
                            { value: '', label: _('hospitality_core.stay.document.genderUnknown') },
                            ...GENDERS.map((value) => ({
                              value,
                              label: _(`hospitality_core.gender.${value}`),
                            })),
                          ],
                        },
                        {
                          name: 'nationality',
                          label: _('hospitality_core.stay.document.nationality'),
                          value: 'VN',
                          help: _('hospitality_core.stay.document.nationalityHint'),
                        },
                        {
                          name: 'permanentAddress',
                          label: _('hospitality_core.stay.document.permanentAddress'),
                          type: 'textarea',
                        },
                        {
                          name: 'issueDate',
                          label: _('hospitality_core.stay.document.issueDate'),
                          type: 'date',
                        },
                        {
                          name: 'issuePlace',
                          label: _('hospitality_core.stay.document.issuePlace'),
                        },
                      ]}
                    />
                  ) : (
                    <Notice
                      title={_('hospitality_core.stay.empty.documentGuests')}
                      message={_('hospitality_core.stay.empty.documentGuestsHint')}
                      tone="warning"
                    />
                  )
                ) : null,
              ])}
            />,
          ])}
        />,
      ])}
    />
  )
}

export const staysScreen = (
  _: Translator,
  rows: StayRow[],
  locale: string,
  timezone: string,
  frame: Frame,
): TemplateResult => (
  <Framed
    translator={_}
    title={_('hospitality_core.screen.stays.title')}
    frame={frame}
    body={
      rows.length
        ? dataTable(_, { columns: stayColumns(_, locale, timezone), rows, id: (row) => row.id })
        : emptyState(_('hospitality_core.screen.stays.empty'), _('hospitality_core.screen.stays.emptyHint'))
    }
  />
)

const folioDetailFeedback = (
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

export const folioDetailScreen = (
  _: Translator,
  folio: FolioRow,
  locale: string,
  timezone: string,
  frame: Frame,
  chargeId: string,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult => {
  const stays = folio.stays ?? []
  const charges = folio.charges ?? []
  const activeCharges = charges.filter((charge) => charge.state === 'active')
  const staysById = new Map(stays.map((stay) => [stay.id, stay]))
  const guest = folio.partner?.name ?? folio.partnerId
  const action = `/admin/hospitality/folios/${encodeURIComponent(folio.id)}?lang=${encodeURIComponent(locale)}`

  return (
    <Framed
      translator={_}
      title={_('hospitality_core.folio.detail.title', { code: folio.code })}
      frame={frame}
      body={stack([
        folioDetailFeedback(_, status, errors),
        <Notice
          title={_('hospitality_core.folio.notice.operational')}
          message={_('hospitality_core.folio.notice.operationalHint')}
          tone="info"
        />,
        <RecordWorkspace
          kicker={_('hospitality_core.folio.detail.kicker')}
          title={folio.code}
          subtitle={guest}
          imageFallback={icon('receipt-text')}
          badges={[
            badge(_(`hospitality_core.folioState.${folio.state}`), workflowTone(folio.state), folio.state),
          ]}
          summary={[
            {
              id: 'amount',
              label: _('hospitality_core.folio.metric.activeTotal'),
              value: formatMoney(_, folio.amountTotal),
            },
            {
              id: 'charges',
              label: _('hospitality_core.folio.metric.activeCharges'),
              value: activeCharges.length,
            },
            {
              id: 'stays',
              label: _('hospitality_core.col.stays'),
              value: stays.length,
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.folio.action.back'),
            href: `/admin/hospitality/folios?property=${encodeURIComponent(folio.propertyId)}&lang=${encodeURIComponent(locale)}`,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.folio.section.information')}
              description={_('hospitality_core.folio.section.informationHint')}
              body={
                <DefinitionList
                  title={folio.code}
                  items={[
                    {
                      key: 'guest',
                      term: _('hospitality_core.col.guest'),
                      value: guest,
                    },
                    {
                      key: 'opened',
                      term: _('hospitality_core.folio.field.openedAt'),
                      value: dateTime(folio.openedAt, locale, timezone),
                    },
                    ...(folio.closedAt
                      ? [
                          {
                            key: 'closed',
                            term: _('hospitality_core.folio.field.closedAt'),
                            value: dateTime(folio.closedAt, locale, timezone),
                          },
                        ]
                      : []),
                  ]}
                />
              }
            />,
            <Section
              title={_('hospitality_core.folio.section.charges')}
              description={_('hospitality_core.folio.section.chargesHint')}
              body={stack([
                charges.length
                  ? dataTable(_, {
                      columns: folioChargeColumns(_, locale, timezone, staysById),
                      rows: charges,
                      id: (charge) => charge.id,
                    })
                  : emptyState(
                      _('hospitality_core.folio.empty.charges'),
                      _('hospitality_core.folio.empty.chargesHint'),
                    ),
                folio.state === 'open' ? (
                  <RecordForm
                    action={action}
                    method="post"
                    submit={_('hospitality_core.folio.action.postCharge')}
                    submitVariant="secondary"
                    hidden={{ operation: 'post-charge', id: chargeId, lang: locale }}
                    fields={[
                      {
                        name: 'stayId',
                        label: _('hospitality_core.folio.charge.stay'),
                        type: 'select',
                        options: [
                          { value: '', label: _('hospitality_core.folio.value.noStay') },
                          ...stays.map((stay) => ({ value: stay.id, label: stay.code })),
                        ],
                      },
                      {
                        name: 'description',
                        label: _('hospitality_core.folio.charge.description'),
                        required: true,
                      },
                      {
                        name: 'type',
                        label: _('hospitality_core.folio.charge.type'),
                        type: 'select',
                        required: true,
                        value: 'service',
                        options: CHARGE_TYPES.map((type) => ({
                          value: type,
                          label: _(`hospitality_core.charge.${type}`),
                        })),
                      },
                      {
                        name: 'quantity',
                        label: _('hospitality_core.folio.charge.quantity'),
                        type: 'decimal',
                        value: '1',
                        step: '0.01',
                        required: true,
                      },
                      {
                        name: 'unitPrice',
                        label: _('hospitality_core.folio.charge.unitPrice'),
                        type: 'decimal',
                        step: '0.01',
                        required: true,
                      },
                    ]}
                  />
                ) : null,
              ])}
            />,
            activeCharges.length && folio.state === 'open' ? (
              <Section
                title={_('hospitality_core.folio.section.correction')}
                description={_('hospitality_core.folio.section.correctionHint')}
                body={
                  <RecordForm
                    action={action}
                    method="post"
                    submit={_('hospitality_core.folio.action.voidCharge')}
                    submitVariant="destructive"
                    hidden={{ operation: 'void-charge', lang: locale }}
                    fields={[
                      {
                        name: 'chargeId',
                        label: _('hospitality_core.folio.field.charge'),
                        type: 'select',
                        required: true,
                        options: activeCharges.map((charge) => ({
                          value: charge.id,
                          label: `${
                            charge.type === 'room' && charge.description.startsWith('room:')
                              ? _('hospitality_core.folio.charge.roomDescription')
                              : charge.description
                          } · ${formatMoney(_, charge.amount)}`,
                        })),
                      },
                      {
                        name: 'reason',
                        label: _('hospitality_core.folio.field.voidReason'),
                        type: 'textarea',
                        required: true,
                        help: _('hospitality_core.folio.field.voidReasonHint'),
                      },
                    ]}
                  />
                }
              />
            ) : null,
            <Section
              title={_('hospitality_core.folio.section.stays')}
              description={_('hospitality_core.folio.section.staysHint')}
              body={
                stays.length
                  ? dataTable(_, {
                      columns: folioStayColumns(_, locale, timezone),
                      rows: stays,
                      id: (stay) => stay.id,
                    })
                  : emptyState(
                      _('hospitality_core.folio.empty.stays'),
                      _('hospitality_core.folio.empty.staysHint'),
                    )
              }
            />,
          ])}
        />,
      ])}
    />
  )
}

export const foliosScreen = (
  _: Translator,
  rows: FolioRow[],
  locale: string,
  timezone: string,
  frame: Frame,
): TemplateResult => (
  <Framed
    translator={_}
    title={_('hospitality_core.screen.folios.title')}
    frame={frame}
    body={
      rows.length
        ? dataTable(_, { columns: folioColumns(_, locale, timezone), rows, id: (row) => row.id })
        : emptyState(_('hospitality_core.screen.folios.empty'), _('hospitality_core.screen.folios.emptyHint'))
    }
  />
)

export const tapeChartScreen = (
  _: Translator,
  chart: TapeChart,
  locale: string,
  frame: Frame,
): TemplateResult => {
  const timezone = chart.timezone || 'UTC'
  const startKey = dateKeyIn(new Date(chart.from), timezone)
  const endKey = dateKeyIn(new Date(chart.to), timezone)
  const dayCount = Math.max(
    1,
    Math.round((Date.parse(`${endKey}T00:00:00Z`) - Date.parse(`${startKey}T00:00:00Z`)) / 86_400_000),
  )
  const nowKey = dateKeyIn(new Date(), timezone)
  const boundaries = Array.from({ length: dayCount + 1 }, (_, index) =>
    zonedMidnight(addCalendarDays(startKey, index), timezone).getTime(),
  )
  const days = Array.from({ length: dayCount }, (_, index) => {
    const key = addCalendarDays(startKey, index)
    const value = new Date(`${key}T12:00:00Z`)
    return {
      key,
      label: new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' }).format(value),
      detail: new Intl.DateTimeFormat(locale, {
        timeZone: 'UTC',
        day: '2-digit',
        month: '2-digit',
      }).format(value),
      today: key === nowKey,
    }
  })
  const unassigned = chart.events.filter((event) => !event.roomId)
  const rows = [
    ...chart.rooms.map((room) => ({
      id: room.id,
      label: room.name,
      detail: room.roomType?.name ?? room.code,
      state: room.status,
    })),
    ...unassigned.map((event) => ({
      id: `__unassigned:${event.id}`,
      label: _('hospitality_core.screen.tapeChart.unassigned'),
      detail: event.guest,
      state: 'unassigned',
    })),
  ]
  const events = chart.events.map((event) => {
    const startsAt = new Date(event.start).getTime()
    const endsAt = new Date(event.end).getTime()
    const matchingStart = boundaries.findIndex(
      (_boundary, index) => index < dayCount && startsAt < boundaries[index + 1]!,
    )
    const eventStart = matchingStart < 0 ? dayCount - 1 : Math.max(0, matchingStart)
    const boundaryAfterEnd = boundaries.findIndex((boundary, index) => index > 0 && endsAt <= boundary)
    const eventEnd = boundaryAfterEnd < 0 ? dayCount : boundaryAfterEnd
    return {
      id: event.id,
      rowId: event.roomId ?? `__unassigned:${event.id}`,
      start: Math.min(dayCount - 1, eventStart),
      span: Math.max(1, eventEnd - eventStart),
      label: event.guest,
      detail: providerName(_, event.provider),
      state: event.state,
      tone: workflowTone(event.state),
    }
  })
  return (
    <Framed
      translator={_}
      title={_('hospitality_core.screen.tapeChart.title')}
      frame={frame}
      body={
        <ScheduleBoard
          corner={_('hospitality_core.screen.tapeChart.corner')}
          days={days}
          rows={rows}
          events={events}
          empty={emptyState(
            _('hospitality_core.screen.tapeChart.empty'),
            _('hospitality_core.screen.tapeChart.emptyHint'),
          )}
        />
      }
    />
  )
}
