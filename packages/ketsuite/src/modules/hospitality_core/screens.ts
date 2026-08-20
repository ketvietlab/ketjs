import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  badge,
  cardGrid,
  code,
  dataTable,
  datePicker,
  definitionList,
  emptyState,
  formCluster,
  formatMoney,
  framed,
  icon,
  linkButton,
  metric,
  mediaPanel,
  notice,
  person,
  recordForm,
  recordWorkspace,
  scheduleBoard,
  section,
  stack,
} from '../../ui/index.ts'
import type { Column, FormField, Frame } from '../../ui/index.ts'
import { addCalendarDays, dateKeyIn, zonedMidnight } from './calendar.ts'
import { ACCOMMODATION_TYPES, CHARGE_TYPES, ROOM_STATUSES } from './types.ts'

export type PropertyRow = {
  id: string
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
  sizeSqm?: string | number | null
  baseRate: string | number
  published: boolean
  rooms?: unknown[]
}

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
  if (status === 'cancelled') return 'danger'
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
  locale: string,
  action: string,
  submit: string,
  cancelHref: string,
): TemplateResult =>
  recordForm({
    action,
    fields: propertyFormFields(_, values, policies),
    hidden: { id: values.id, lang: locale },
    submit,
    submitVariant: 'primary',
    cancelHref,
    cancelLabel: _('hospitality_core.action.cancel'),
  })

export const propertiesScreen = (
  _: Translator,
  rows: PropertyRow[],
  totals: { rooms: number; available: number; attention: number },
  locale: string,
  frame: Frame,
): TemplateResult =>
  framed(
    _,
    _('hospitality_core.screen.properties.title'),
    frame,
    stack([
      linkButton({
        label: _('hospitality_core.property.action.create'),
        href: `/admin/hospitality/properties/new?lang=${encodeURIComponent(locale)}`,
        variant: 'primary',
      }),
      cardGrid({
        items: [
          { id: 'properties', label: _('hospitality_core.metric.properties'), value: rows.length },
          { id: 'rooms', label: _('hospitality_core.metric.rooms'), value: totals.rooms },
          { id: 'available', label: _('hospitality_core.metric.available'), value: totals.available },
          { id: 'attention', label: _('hospitality_core.metric.attention'), value: totals.attention },
        ],
        id: (item) => item.id,
        card: (item) => metric({ label: item.label, value: String(item.value), tone: item.id }),
      }),
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
    ]),
  )

const propertyFeedback = (
  _: Translator,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult | null => {
  if (status === 'created' || status === 'saved')
    return notice({
      title: _(`hospitality_core.property.feedback.${status}`),
      message: _('hospitality_core.property.feedback.savedHint'),
      tone: 'positive',
    })
  if (errors.length)
    return notice({
      title: _('hospitality_core.feedback.invalid'),
      message: errors.join(' '),
      tone: 'danger',
    })
  return null
}

export const newPropertyScreen = (
  _: Translator,
  values: PropertyFormValues,
  policies: readonly PolicyRow[],
  locale: string,
  frame: Frame,
  errors: readonly string[] = [],
): TemplateResult =>
  framed(
    _,
    _('hospitality_core.property.create.title'),
    frame,
    stack([
      propertyFeedback(_, null, errors),
      section({
        title: _('hospitality_core.property.create.title'),
        description: _('hospitality_core.property.create.hint'),
        body: propertyForm(
          _,
          values,
          policies,
          locale,
          `/admin/hospitality/properties/new?lang=${encodeURIComponent(locale)}`,
          _('hospitality_core.property.action.create'),
          `/admin/hospitality/properties?lang=${encodeURIComponent(locale)}`,
        ),
      }),
    ]),
  )

export const propertyDetailScreen = (
  _: Translator,
  property: PropertyDetail,
  policies: readonly PolicyRow[],
  locale: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
  attempted?: PropertyFormValues,
): TemplateResult => {
  const query = `lang=${encodeURIComponent(locale)}`
  const values = attempted ?? property
  const rooms = property.rooms ?? []
  return framed(
    _,
    property.name,
    frame,
    stack([
      propertyFeedback(_, status, errors),
      recordWorkspace({
        kicker: _('hospitality_core.property.detail.kicker'),
        title: property.name,
        subtitle: `${property.code} · ${property.publicName || property.name}`,
        imageFallback: icon('hotel'),
        badges: [
          badge(_(`hospitality_core.accommodation.${property.accommodationType}`), 'info'),
          badge(
            _(property.active ? 'hospitality_core.value.active' : 'hospitality_core.value.inactive'),
            property.active ? 'positive' : 'neutral',
          ),
        ],
        summary: [
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
        ],
        navigation: linkButton({
          label: _('hospitality_core.property.action.back'),
          href: `/admin/hospitality/properties?${query}`,
          variant: 'tertiary',
          icon: 'chevron-left',
        }),
        body: stack([
          section({
            title: _('hospitality_core.property.section.information'),
            description: _('hospitality_core.property.section.informationHint'),
            body: definitionList({
              title: property.publicName || property.name,
              items: [
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
              ],
            }),
          }),
          section({
            title: _('hospitality_core.property.section.settings'),
            description: _('hospitality_core.property.section.settingsHint'),
            body: propertyForm(
              _,
              values,
              policies,
              locale,
              `/admin/hospitality/properties/${encodeURIComponent(property.id)}?${query}`,
              _('hospitality_core.property.action.save'),
              `/admin/hospitality/properties?${query}`,
            ),
          }),
          section({
            title: _('hospitality_core.property.section.next'),
            description: _('hospitality_core.property.section.nextHint'),
            body: stack(
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
            ),
          }),
        ]),
      }),
    ]),
  )
}

export const roomsScreen = (_: Translator, rows: RoomRow[], frame: Frame): TemplateResult =>
  framed(
    _,
    _('hospitality_core.screen.rooms.title'),
    frame,
    rows.length
      ? dataTable(_, { columns: roomColumns(_), rows, id: (row) => row.id })
      : emptyState(_('hospitality_core.screen.rooms.empty'), _('hospitality_core.screen.rooms.emptyHint')),
  )

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
    status === 'created'
      ? notice({
          title: _('hospitality_core.housekeeping.feedback.created'),
          message: _('hospitality_core.housekeeping.feedback.createdHint'),
          tone: 'positive',
        })
      : status === 'invalid'
        ? notice({
            title: _('hospitality_core.feedback.invalid'),
            message: _('hospitality_core.housekeeping.feedback.invalidHint'),
            tone: 'danger',
          })
        : null

  return framed(
    _,
    _('hospitality_core.screen.cleaningTasks.title'),
    frame,
    stack([
      feedback,
      recordForm({
        action: '/admin/hospitality/housekeeping',
        method: 'get',
        layout: 'inline',
        submit: _('hospitality_core.action.select'),
        submitVariant: 'secondary',
        hidden: { lang: locale },
        fields: [
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
        ],
      }),
      cardGrid({
        items: ['todo', 'in_progress', 'done'].map((state) => ({
          state,
          count:
            state === 'todo'
              ? data.summary.todo
              : state === 'in_progress'
                ? data.summary.inProgress
                : data.summary.done,
        })),
        id: (item) => item.state,
        card: (item) =>
          metric({
            label: _(`hospitality_core.cleaningState.${item.state}`),
            value: String(item.count),
            tone: item.state,
          }),
      }),
      section({
        title: _('hospitality_core.housekeeping.section.create'),
        description: _('hospitality_core.housekeeping.section.createHint'),
        body: data.rooms.length
          ? recordForm({
              action,
              method: 'post',
              submit: _('hospitality_core.housekeeping.action.create'),
              submitVariant: 'secondary',
              hidden: {
                operation: 'create',
                lang: locale,
                id: data.id,
                code: data.code,
                propertyId: data.propertyId ?? '',
                state: data.state,
              },
              fields: [
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
              ],
            })
          : emptyState(
              _('hospitality_core.housekeeping.empty.rooms'),
              _('hospitality_core.housekeeping.empty.roomsHint'),
            ),
      }),
      section({
        title: _('hospitality_core.housekeeping.section.queue'),
        description: _('hospitality_core.housekeeping.section.queueHint'),
        body: visibleRows.length
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
            ),
      }),
    ]),
  )
}

const cleaningTaskFeedback = (
  _: Translator,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult | null => {
  if (status === 'started' || status === 'completed' || status === 'cancelled')
    return notice({
      title: _(`hospitality_core.housekeeping.feedback.${status}`),
      message: _(`hospitality_core.housekeeping.feedback.${status}Hint`),
      tone: status === 'cancelled' ? 'warning' : 'positive',
    })
  if (errors.length)
    return notice({
      title: _('hospitality_core.feedback.invalid'),
      message: errors.join(' '),
      tone: 'danger',
    })
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
      section({
        title: _('hospitality_core.housekeeping.action.start'),
        description: _('hospitality_core.housekeeping.action.startHint'),
        body: recordForm({
          action,
          method: 'post',
          submit: _('hospitality_core.housekeeping.action.start'),
          submitVariant: 'primary',
          hidden: { operation: 'start', lang: locale },
          fields: [
            {
              name: 'assigneeId',
              label: _('hospitality_core.col.assignee'),
              value: task.assigneeId,
              help: _('hospitality_core.housekeeping.field.assigneeHint'),
            },
          ],
        }),
      }),
    )

  if (task.state === 'in_progress')
    actions.push(
      section({
        title: _('hospitality_core.housekeeping.action.complete'),
        description: _('hospitality_core.housekeeping.action.completeHint'),
        body: recordForm({
          action,
          method: 'post',
          submit: _('hospitality_core.housekeeping.action.complete'),
          submitVariant: 'primary',
          hidden: { operation: 'complete', lang: locale },
          fields: [],
        }),
      }),
    )

  if (task.state === 'todo' || task.state === 'in_progress')
    actions.push(
      section({
        title: _('hospitality_core.housekeeping.action.cancel'),
        description: _('hospitality_core.housekeeping.action.cancelHint'),
        body: recordForm({
          action,
          method: 'post',
          submit: _('hospitality_core.housekeeping.action.cancel'),
          submitVariant: 'destructive',
          hidden: { operation: 'cancel', lang: locale },
          fields: [],
        }),
      }),
    )

  return framed(
    _,
    _('hospitality_core.housekeeping.detail.title', { code: task.code }),
    frame,
    stack([
      cleaningTaskFeedback(_, status, errors),
      recordWorkspace({
        kicker: _('hospitality_core.housekeeping.detail.kicker'),
        title: task.code,
        subtitle: room,
        imageFallback: icon('check-circle'),
        badges: [
          badge(_(`hospitality_core.cleaningState.${task.state}`), cleaningTone(task.state), task.state),
          badge(
            _(`hospitality_core.cleaningPriority.${task.priority}`),
            task.priority === 'urgent' ? 'danger' : 'neutral',
          ),
        ],
        summary: [
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
        ],
        navigation: linkButton({
          label: _('hospitality_core.housekeeping.action.back'),
          href: `/admin/hospitality/housekeeping?property=${encodeURIComponent(task.propertyId)}&lang=${encodeURIComponent(locale)}`,
          variant: 'tertiary',
          icon: 'chevron-left',
        }),
        body: stack([
          section({
            title: _('hospitality_core.housekeeping.section.information'),
            description: _('hospitality_core.housekeeping.section.informationHint'),
            body: definitionList({
              title: task.code,
              items: [
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
              ],
            }),
          }),
          ...actions,
        ]),
      }),
    ]),
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

  return framed(
    _,
    _('hospitality_core.screen.housekeepingRooms.title'),
    frame,
    stack([
      recordForm({
        action: '/admin/hospitality/housekeeping/rooms',
        method: 'get',
        layout: 'inline',
        submit: _('hospitality_core.action.select'),
        submitVariant: 'secondary',
        hidden: { lang: locale },
        fields: [
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
        ],
      }),
      cardGrid({
        items: metrics,
        id: (item) => item.id,
        card: (item) =>
          metric({
            label: _(`hospitality_core.metric.${item.id}`),
            value: String(item.value),
            tone: item.id,
          }),
      }),
      section({
        title: _('hospitality_core.housekeeping.rooms.section.board'),
        description: _('hospitality_core.housekeeping.rooms.section.boardHint'),
        body: data.rows.length
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
            ),
      }),
    ]),
  )
}

const housekeepingRoomFeedback = (
  _: Translator,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult | null => {
  if (status === 'updated')
    return notice({
      title: _('hospitality_core.housekeeping.rooms.feedback.updated'),
      message: _('hospitality_core.housekeeping.rooms.feedback.updatedHint'),
      tone: 'positive',
    })
  if (errors.length)
    return notice({
      title: _('hospitality_core.feedback.invalid'),
      message: errors.join(' '),
      tone: 'danger',
    })
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
      section({
        title: _('hospitality_core.housekeeping.rooms.section.service'),
        description: _('hospitality_core.housekeeping.rooms.section.serviceHint'),
        body: recordForm({
          action,
          method: 'post',
          submit: _('hospitality_core.housekeeping.rooms.action.takeOut'),
          submitVariant: 'destructive',
          hidden: { operation: 'set-status', expectedStatus: room.status, lang: locale },
          fields: [
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
          ],
        }),
      }),
    )

  if (room.status === 'maintenance' || room.status === 'out_of_order')
    actions.push(
      section({
        title: _('hospitality_core.housekeeping.rooms.section.release'),
        description: _('hospitality_core.housekeeping.rooms.section.releaseHint'),
        body: recordForm({
          action,
          method: 'post',
          submit: _('hospitality_core.housekeeping.rooms.action.release'),
          submitVariant: 'primary',
          hidden: {
            operation: 'set-status',
            expectedStatus: room.status,
            status: 'dirty',
            lang: locale,
          },
          fields: [],
        }),
      }),
    )

  const currentStay = room.currentStay
  const guest = currentStay?.partner?.name

  return framed(
    _,
    _('hospitality_core.housekeeping.rooms.detail.title', { code: room.code }),
    frame,
    stack([
      housekeepingRoomFeedback(_, status, errors),
      recordWorkspace({
        kicker: _('hospitality_core.housekeeping.rooms.detail.kicker'),
        title: room.code,
        subtitle: room.name,
        imageFallback: icon('hotel'),
        badges: [
          badge(_(`hospitality_core.roomStatus.${room.status}`), statusTone(room.status), room.status),
        ],
        summary: [
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
        ],
        navigation: linkButton({
          label: _('hospitality_core.housekeeping.rooms.action.back'),
          href: `/admin/hospitality/housekeeping/rooms?property=${encodeURIComponent(room.propertyId)}&lang=${encodeURIComponent(locale)}`,
          variant: 'tertiary',
          icon: 'chevron-left',
        }),
        body: stack([
          section({
            title: _('hospitality_core.housekeeping.rooms.section.information'),
            description: _('hospitality_core.housekeeping.rooms.section.informationHint'),
            body: stack([
              definitionList({
                title: room.name,
                items: [
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
                ],
              }),
              currentStay?.id
                ? linkButton({
                    label: _('hospitality_core.housekeeping.rooms.action.openStay'),
                    href: `/admin/hospitality/stays/${encodeURIComponent(currentStay.id)}?lang=${encodeURIComponent(locale)}`,
                    variant: 'secondary',
                  })
                : null,
            ]),
          }),
          section({
            title: _('hospitality_core.housekeeping.rooms.section.tasks'),
            description: _('hospitality_core.housekeeping.rooms.section.tasksHint'),
            body: stack([
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
            ]),
          }),
          ...actions,
        ]),
      }),
    ]),
  )
}

export const roomTypesScreen = (_: Translator, rows: RoomTypeRow[], frame: Frame): TemplateResult =>
  framed(
    _,
    _('hospitality_core.screen.roomTypes.title'),
    frame,
    rows.length
      ? dataTable(_, { columns: roomTypeColumns(_), rows, id: (row) => row.id })
      : emptyState(
          _('hospitality_core.screen.roomTypes.empty'),
          _('hospitality_core.screen.roomTypes.emptyHint'),
        ),
  )

export const amenitiesScreen = (_: Translator, rows: AmenityRow[], frame: Frame): TemplateResult =>
  framed(
    _,
    _('hospitality_core.screen.amenities.title'),
    frame,
    rows.length
      ? dataTable(_, { columns: amenityColumns(_), rows, id: (row) => row.id })
      : emptyState(
          _('hospitality_core.screen.amenities.empty'),
          _('hospitality_core.screen.amenities.emptyHint'),
        ),
  )

export const policiesScreen = (_: Translator, rows: PolicyRow[], frame: Frame): TemplateResult =>
  framed(
    _,
    _('hospitality_core.screen.policies.title'),
    frame,
    rows.length
      ? dataTable(_, { columns: policyColumns(_), rows, id: (row) => row.id })
      : emptyState(
          _('hospitality_core.screen.policies.empty'),
          _('hospitality_core.screen.policies.emptyHint'),
        ),
  )

const contentFeedback = (_: Translator, state?: string | null): TemplateResult | null => {
  if (state === 'saved')
    return notice({
      title: _('hospitality_core.content.feedback.saved'),
      message: _('hospitality_core.content.feedback.savedHint'),
      tone: 'positive',
    })
  if (state === 'invalid')
    return notice({
      title: _('hospitality_core.content.feedback.invalid'),
      message: _('hospitality_core.content.feedback.invalidHint'),
      tone: 'danger',
    })
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

  return framed(
    _,
    _('hospitality_core.screen.content.title'),
    frame,
    stack([
      contentFeedback(_, status),
      properties.length
        ? section({
            title: _('hospitality_core.screen.content.selection'),
            description: _('hospitality_core.screen.content.selectionHint'),
            body: recordForm({
              action: '/admin/hospitality/content',
              method: 'get',
              layout: 'inline',
              fields: [
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
              ],
              hidden: { lang: locale },
              submit: _('hospitality_core.action.select'),
              submitVariant: 'secondary',
            }),
          })
        : emptyState(
            _('hospitality_core.screen.content.noProperty'),
            _('hospitality_core.screen.content.noPropertyHint'),
          ),
      ...(property
        ? [
            cardGrid({
              items: [
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
              ],
              id: (item) => item.id,
              card: (item) =>
                metric({
                  label: item.label,
                  value: item.value,
                  detail: 'detail' in item ? item.detail : null,
                  tone: item.id,
                }),
            }),
            section({
              title: _('hospitality_core.screen.content.library'),
              description: _('hospitality_core.screen.content.libraryHint'),
              body: mediaPanel({
                status: 'ready',
                images: images.map((image, index) => ({
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
                })),
                uploadAction: `/admin/hospitality/content/upload${suffix}`,
                labels: {
                  empty: _('hospitality_core.content.media.empty'),
                  primary: _('hospitality_core.content.media.primary'),
                  makePrimary: _('hospitality_core.content.media.makePrimary'),
                  moveUp: _('hospitality_core.content.media.moveUp'),
                  moveDown: _('hospitality_core.content.media.moveDown'),
                  remove: _('hospitality_core.content.media.remove'),
                  choose: _('hospitality_core.content.media.choose'),
                  add: _('hospitality_core.content.media.add'),
                },
                extension: images.length
                  ? formCluster({
                      label: _('hospitality_core.content.metadata.group'),
                      forms: images.map((image) =>
                        recordForm({
                          action: `/admin/hospitality/content/images/${image.id}/metadata${suffix}`,
                          layout: 'inline',
                          fields: [
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
                          ],
                          hidden: { id: image.id },
                          submit: _('hospitality_core.content.action.saveMetadata'),
                          submitVariant: 'secondary',
                          submitSize: 'compact',
                        }),
                      ),
                    })
                  : undefined,
              }),
            }),
          ]
        : []),
    ]),
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
    return notice({
      title: _('hospitality_core.feedback.saved'),
      message: _('hospitality_core.feedback.savedHint'),
      tone: 'positive',
    })
  if (state === 'invalid')
    return notice({
      title: _('hospitality_core.feedback.invalid'),
      message: _('hospitality_core.feedback.invalidHint'),
      tone: 'danger',
    })
  return null
}

const nightAuditFeedback = (_: Translator, state?: string | null): TemplateResult | null => {
  if (state === 'queued')
    return notice({
      title: _('hospitality_core.nightAudit.feedback.queued'),
      message: _('hospitality_core.nightAudit.feedback.queuedHint'),
      tone: 'positive',
    })
  if (state === 'invalid')
    return notice({
      title: _('hospitality_core.feedback.invalid'),
      message: _('hospitality_core.nightAudit.feedback.invalidHint'),
      tone: 'danger',
    })
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
    return framed(
      _,
      _('hospitality_core.screen.nightAudit.title'),
      frame,
      emptyState(
        _('hospitality_core.nightAudit.empty.property'),
        _('hospitality_core.nightAudit.empty.propertyHint'),
      ),
    )
  const lang: Record<string, string> = { lang: locale }
  return framed(
    _,
    _('hospitality_core.screen.nightAudit.title'),
    frame,
    stack([
      nightAuditFeedback(_, state),
      formCluster({
        label: _('hospitality_core.nightAudit.section.selection'),
        forms: [
          recordForm({
            action: '/admin/hospitality/night-audit',
            method: 'get',
            layout: 'inline',
            submit: _('hospitality_core.action.select'),
            submitVariant: 'secondary',
            hidden: { ...lang, auditDate: data.auditDate },
            fields: [
              {
                name: 'property',
                label: _('hospitality_core.menu.properties'),
                type: 'select',
                value: data.propertyId,
                options: choices(data.properties),
                required: true,
              },
            ],
          }),
          datePicker({
            action: '/admin/hospitality/night-audit',
            label: _('hospitality_core.nightAudit.field.auditDate'),
            fields: [
              {
                name: 'auditDate',
                label: _('hospitality_core.nightAudit.field.auditDate'),
                value: data.auditDate,
                max: data.today,
                required: true,
              },
            ],
            hidden: { ...lang, property: data.propertyId },
            submit: _('hospitality_core.nightAudit.action.preview'),
          }),
        ],
      }),
      data.preview
        ? cardGrid({
            items: [
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
            ],
            id: (item) => item.id,
            card: (item) => metric({ label: item.label, value: String(item.value), tone: item.id }),
          })
        : null,
      section({
        title: _('hospitality_core.nightAudit.section.run'),
        description: _('hospitality_core.nightAudit.section.runHint'),
        body: recordForm({
          action: '/admin/hospitality/night-audit',
          method: 'post',
          submit: _('hospitality_core.nightAudit.action.run'),
          submitVariant: 'primary',
          hidden: {
            ...lang,
            operation: 'request-night-audit',
            propertyId: data.propertyId,
            auditDate: data.auditDate,
          },
          fields: [],
        }),
      }),
      section({
        title: _('hospitality_core.nightAudit.section.history'),
        description: _('hospitality_core.nightAudit.section.historyHint'),
        body: data.runs.length
          ? dataTable(_, { columns: nightAuditColumns(_, locale), rows: data.runs, id: (row) => row.id })
          : emptyState(
              _('hospitality_core.nightAudit.empty.runs'),
              _('hospitality_core.nightAudit.empty.runsHint'),
            ),
      }),
    ]),
  )
}

const stayNoticeFeedback = (_: Translator, state?: string | null): TemplateResult | null => {
  if (state === 'refreshed' || state === 'submitted' || state === 'confirmed')
    return notice({
      title: _(`hospitality_core.stayNotice.feedback.${state}`),
      message: _(`hospitality_core.stayNotice.feedback.${state}Hint`),
      tone: 'positive',
    })
  if (state === 'invalid')
    return notice({
      title: _('hospitality_core.feedback.invalid'),
      message: _('hospitality_core.stayNotice.feedback.invalidHint'),
      tone: 'danger',
    })
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
    return recordForm({
      action: '/admin/hospitality/stay-notices',
      method: 'post',
      submit: _('hospitality_core.stayNotice.action.refresh'),
      submitVariant: 'secondary',
      hidden: { ...hidden, operation: 'refresh' },
      fields: [],
    })
  if (selected.state === 'ready')
    return recordForm({
      action: '/admin/hospitality/stay-notices',
      method: 'post',
      submit: _('hospitality_core.stayNotice.action.recordSubmission'),
      submitVariant: 'primary',
      hidden: { ...hidden, operation: 'record-submission' },
      fields: [
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
      ],
    })
  if (selected.state === 'submitted')
    return recordForm({
      action: '/admin/hospitality/stay-notices',
      method: 'post',
      submit: _('hospitality_core.stayNotice.action.confirm'),
      submitVariant: 'primary',
      hidden: { ...hidden, operation: 'confirm' },
      fields: [
        {
          name: 'receiptRef',
          label: _('hospitality_core.stayNotice.field.receiptRef'),
          value: selected.receiptRef,
          required: true,
        },
      ],
    })
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
    return framed(
      _,
      _('hospitality_core.screen.stayNotices.title'),
      frame,
      emptyState(
        _('hospitality_core.stayNotice.empty.property'),
        _('hospitality_core.stayNotice.empty.propertyHint'),
      ),
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
  return framed(
    _,
    _('hospitality_core.screen.stayNotices.title'),
    frame,
    stack([
      stayNoticeFeedback(_, feedbackState),
      notice({
        tone: 'info',
        title: _('hospitality_core.stayNotice.privacy.title'),
        message: _('hospitality_core.stayNotice.privacy.hint'),
      }),
      recordForm({
        action: '/admin/hospitality/stay-notices',
        method: 'get',
        layout: 'inline',
        submit: _('hospitality_core.action.select'),
        submitVariant: 'secondary',
        hidden: { lang: locale },
        fields: [
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
        ],
      }),
      cardGrid({
        items: ['attention', 'ready', 'submitted', 'confirmed'].map((state) => ({
          state,
          count: Number(counts[state] ?? 0),
        })),
        id: (item) => item.state,
        card: (item) =>
          metric({
            label: _(`hospitality_core.stayNotice.state.${item.state}`),
            value: String(item.count),
            tone: item.state,
          }),
      }),
      ...(data.selected
        ? [
            section({
              title: _('hospitality_core.stayNotice.section.selected'),
              description: _('hospitality_core.stayNotice.section.selectedHint'),
              body: stack([
                definitionList({
                  title: data.selected.guestName,
                  items: [
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
                  ],
                }),
                action,
              ]),
            }),
          ]
        : []),
      section({
        title: _('hospitality_core.stayNotice.section.queue'),
        description: _('hospitality_core.stayNotice.section.queueHint'),
        body: visibleRows.length
          ? dataTable(_, {
              columns: stayNoticeColumns(_, locale, timezone),
              rows: visibleRows,
              id: (row) => row.id,
              rowHref: (row) => stayNoticeHref(locale, data.propertyId!, data.state, row.id),
            })
          : emptyState(
              _('hospitality_core.stayNotice.empty.rows'),
              _('hospitality_core.stayNotice.empty.rowsHint'),
            ),
      }),
    ]),
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

  return framed(
    _,
    _('hospitality_core.screen.services.title'),
    frame,
    stack([
      feedback(_, state),
      recordForm({
        action: '/admin/hospitality/services',
        method: 'get',
        layout: 'inline',
        submit: _('hospitality_core.action.select'),
        submitVariant: 'secondary',
        hidden: { lang: locale },
        fields: [
          {
            name: 'property',
            label: _('hospitality_core.menu.properties'),
            type: 'select',
            value: data.propertyId,
            options: choices(data.properties),
            required: true,
          },
        ],
      }),
      cardGrid({
        items: [
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
          { id: 'posted', label: _('hospitality_core.services.metric.posted'), value: activeCharges.length },
          {
            id: 'value',
            label: _('hospitality_core.services.metric.postedValue'),
            value: formatMoney(_, totalPosted),
          },
        ],
        id: (item) => item.id,
        card: (item) => metric({ label: item.label, value: String(item.value), tone: item.id }),
      }),
      section({
        title: _('hospitality_core.services.section.fees'),
        description: _('hospitality_core.services.section.feesHint'),
        body: formCluster({
          label: _('hospitality_core.services.form.fee'),
          forms: [
            recordForm({
              action: `/admin/hospitality/services${baseQuery}`,
              submit: _('hospitality_core.services.action.saveFee'),
              submitVariant: 'secondary',
              hidden: {
                operation: 'save-property-charge',
                id: data.ids.propertyCharge,
                propertyId: data.propertyId ?? '',
              },
              fields: [
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
                { name: 'amount', label: _('hospitality_core.col.amount'), type: 'decimal', required: true },
                {
                  name: 'description',
                  label: _('hospitality_core.services.field.description'),
                  type: 'textarea',
                  span: 'full',
                },
                { name: 'active', label: _('hospitality_core.field.active'), type: 'checkbox', value: true },
              ],
            }),
          ],
        }),
      }),
      data.propertyCharges.length
        ? dataTable(_, { columns: propertyChargeColumns(_), rows: data.propertyCharges, id: (row) => row.id })
        : emptyState(
            _('hospitality_core.services.empty.fees'),
            _('hospitality_core.services.empty.feesHint'),
          ),
      section({
        title: _('hospitality_core.services.section.intentions'),
        description: _('hospitality_core.services.section.intentionsHint'),
        body:
          data.targets.length && data.products.length
            ? formCluster({
                label: _('hospitality_core.services.form.intention'),
                forms: [
                  recordForm({
                    action: `/admin/hospitality/services${baseQuery}`,
                    submit: _('hospitality_core.services.action.addIntention'),
                    submitVariant: 'primary',
                    hidden: {
                      operation: 'save-extra-line',
                      id: data.ids.extraLine,
                    },
                    fields: [
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
                    ],
                  }),
                ],
              })
            : emptyState(
                _('hospitality_core.services.empty.catalogue'),
                _('hospitality_core.services.empty.catalogueHint'),
              ),
      }),
      data.extraLines.length
        ? dataTable(_, { columns: extraLineColumns(_), rows: data.extraLines, id: (row) => row.id })
        : emptyState(
            _('hospitality_core.services.empty.intentions'),
            _('hospitality_core.services.empty.intentionsHint'),
          ),
      section({
        title: _('hospitality_core.services.section.post'),
        description: _('hospitality_core.services.section.postHint'),
        body: extraOptions.length
          ? recordForm({
              action: `/admin/hospitality/services${baseQuery}`,
              submit: _('hospitality_core.services.action.post'),
              submitVariant: 'primary',
              hidden: { operation: 'materialize-extra', requestKey: data.ids.requestKey },
              fields: [
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
              ],
            })
          : emptyState(
              _('hospitality_core.services.empty.post'),
              _('hospitality_core.services.empty.postHint'),
            ),
      }),
      section({
        title: _('hospitality_core.services.section.ledger'),
        description: _('hospitality_core.services.section.ledgerHint'),
        body: data.charges.length
          ? dataTable(_, {
              columns: serviceChargeColumns(_, locale, timezone),
              rows: data.charges,
              id: (row) => row.id,
            })
          : emptyState(
              _('hospitality_core.services.empty.ledger'),
              _('hospitality_core.services.empty.ledgerHint'),
            ),
      }),
    ]),
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
): TemplateResult =>
  framed(
    _,
    _('hospitality_core.screen.ratePlans.title'),
    frame,
    stack([
      feedback(_, state),
      recordForm({
        action: '/admin/hospitality/rate-plans',
        method: 'get',
        layout: 'inline',
        submit: _('hospitality_core.action.select'),
        submitVariant: 'secondary',
        fields: [
          {
            name: 'property',
            label: _('hospitality_core.menu.properties'),
            type: 'select',
            value: propertyId,
            options: choices(properties),
            required: true,
          },
        ],
      }),
      section({
        title: _('hospitality_core.screen.ratePlans.create'),
        description: _('hospitality_core.screen.ratePlans.createHint'),
        body: roomTypes.length
          ? recordForm({
              action: `/admin/hospitality/rate-plans${propertyId ? `?property=${encodeURIComponent(propertyId)}` : ''}`,
              method: 'post',
              submit: _('hospitality_core.action.saveRatePlan'),
              submitVariant: 'primary',
              hidden: { operation: 'save-rate-plan', propertyId: propertyId ?? '' },
              fields: [
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
              ],
            })
          : emptyState(
              _('hospitality_core.screen.ratePlans.noRoomTypes'),
              _('hospitality_core.screen.ratePlans.noRoomTypesHint'),
            ),
      }),
      section({
        title: _('hospitality_core.screen.ratePlans.list'),
        body: rows.length
          ? dataTable(_, { columns: ratePlanColumns(_), rows, id: (row) => row.id })
          : emptyState(
              _('hospitality_core.screen.ratePlans.empty'),
              _('hospitality_core.screen.ratePlans.emptyHint'),
            ),
      }),
    ]),
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
  return framed(
    _,
    _('hospitality_core.screen.inventory.title'),
    frame,
    stack([
      feedback(_, state),
      formCluster({
        label: _('hospitality_core.screen.inventory.filters'),
        forms: [
          recordForm({
            action: '/admin/hospitality/inventory',
            method: 'get',
            layout: 'inline',
            submit: _('hospitality_core.action.select'),
            submitVariant: 'secondary',
            hidden: { from: selected.from, to: selected.to },
            fields: [
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
            ],
          }),
          datePicker({
            action: '/admin/hospitality/inventory',
            label: _('hospitality_core.screen.inventory.dateRange'),
            fields: [
              { name: 'from', label: _('hospitality_core.field.from'), value: selected.from, required: true },
              { name: 'to', label: _('hospitality_core.field.to'), value: selected.to, required: true },
            ],
            hidden: {
              property: selected.propertyId ?? '',
              roomType: selected.roomTypeId ?? '',
            },
            submit: _('hospitality_core.action.apply'),
          }),
        ],
      }),
      cardGrid({
        items: [
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
        ],
        id: (item) => item.id,
        card: (item) => metric({ label: item.label, value: String(item.value), tone: item.id }),
      }),
      section({
        title: _('hospitality_core.screen.inventory.allotment'),
        description: _('hospitality_core.screen.inventory.allotmentHint'),
        body: selected.roomTypeId
          ? recordForm({
              action: '/admin/hospitality/inventory',
              method: 'post',
              submit: _('hospitality_core.action.updateAllotment'),
              submitVariant: 'primary',
              hidden: { ...hidden, operation: 'set-inventory' },
              fields: [
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
              ],
            })
          : emptyState(
              _('hospitality_core.screen.inventory.noRoomType'),
              _('hospitality_core.screen.inventory.noRoomTypeHint'),
            ),
      }),
      section({
        title: _('hospitality_core.screen.inventory.restrictions'),
        description: _('hospitality_core.screen.inventory.restrictionsHint'),
        body: selected.roomTypeId
          ? recordForm({
              action: '/admin/hospitality/inventory',
              method: 'post',
              submit: _('hospitality_core.action.updateRestrictions'),
              submitVariant: 'secondary',
              hidden: { ...hidden, operation: 'set-restrictions' },
              fields: [
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
                { name: 'closedToDeparture', label: _('hospitality_core.restriction.ctd'), type: 'checkbox' },
              ],
            })
          : null,
      }),
      rows.length
        ? dataTable(_, { columns: inventoryColumns(_), rows, id: (row) => row.id })
        : emptyState(
            _('hospitality_core.screen.inventory.empty'),
            _('hospitality_core.screen.inventory.emptyHint'),
          ),
    ]),
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
    cell: (row) => badge(_(`hospitality_core.provider.${row.provider}`), 'neutral'),
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
  totals: { arrivals: number; inHouse: number; departures: number; openFolios: number },
  locale: string,
  timezone: string,
  frame: Frame,
): TemplateResult =>
  framed(
    _,
    _('hospitality_core.screen.frontDesk.title'),
    frame,
    stack([
      cardGrid({
        items: [
          { id: 'arrivals', label: _('hospitality_core.metric.arrivals'), value: totals.arrivals },
          { id: 'in-house', label: _('hospitality_core.metric.inHouse'), value: totals.inHouse },
          { id: 'departures', label: _('hospitality_core.metric.departures'), value: totals.departures },
          { id: 'folios', label: _('hospitality_core.metric.openFolios'), value: totals.openFolios },
        ],
        id: (item) => item.id,
        card: (item) => metric({ label: item.label, value: String(item.value), tone: item.id }),
      }),
      rows.length
        ? dataTable(_, { columns: stayColumns(_, locale, timezone), rows, id: (row) => row.id })
        : emptyState(
            _('hospitality_core.screen.frontDesk.empty'),
            _('hospitality_core.screen.frontDesk.emptyHint'),
          ),
    ]),
  )

const reservationFeedback = (_: Translator, status?: string | null): TemplateResult | null => {
  if (status === 'saved')
    return notice({
      title: _('hospitality_core.reservation.feedback.saved'),
      message: _('hospitality_core.reservation.feedback.savedHint'),
      tone: 'positive',
    })
  if (status === 'quoted')
    return notice({
      title: _('hospitality_core.reservation.feedback.quoted'),
      message: _('hospitality_core.reservation.feedback.quotedHint'),
      tone: 'info',
    })
  if (status === 'invalid')
    return notice({
      title: _('hospitality_core.feedback.invalid'),
      message: _('hospitality_core.reservation.feedback.invalidHint'),
      tone: 'danger',
    })
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
  return framed(
    _,
    _('hospitality_core.screen.reservations.title'),
    frame,
    stack([
      reservationFeedback(_, status),
      recordForm({
        action: '/admin/hospitality/reservations',
        method: 'get',
        layout: 'inline',
        submit: _('hospitality_core.action.select'),
        submitVariant: 'secondary',
        hidden: { lang: locale },
        fields: [
          {
            name: 'property',
            label: _('hospitality_core.reservation.field.property'),
            type: 'select',
            value: data.values.propertyId,
            options: choices(data.properties),
            required: true,
          },
        ],
      }),
      section({
        title: _('hospitality_core.reservation.section.intake'),
        description: _('hospitality_core.reservation.section.intakeHint'),
        body:
          data.roomTypes.length && data.partners.length
            ? recordForm({
                action: '/admin/hospitality/reservations',
                method: 'post',
                submit: _('hospitality_core.reservation.action.quote'),
                submitVariant: 'primary',
                errors,
                hidden: {
                  operation: 'quote',
                  lang: locale,
                  property: data.values.propertyId,
                  id: data.values.id,
                },
                fields: [
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
                ],
              })
            : emptyState(
                data.roomTypes.length
                  ? _('hospitality_core.reservation.empty.partners')
                  : _('hospitality_core.reservation.empty.roomTypes'),
                data.roomTypes.length
                  ? _('hospitality_core.reservation.empty.partnersHint')
                  : _('hospitality_core.reservation.empty.roomTypesHint'),
              ),
      }),
      ...(quote
        ? [
            section({
              title: _('hospitality_core.reservation.section.quote'),
              description: _('hospitality_core.reservation.section.quoteHint'),
              body: stack([
                cardGrid({
                  items: [
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
                  ],
                  id: (item) => item.id,
                  card: (item) => metric({ label: item.label, value: item.value, tone: item.id }),
                }),
                recordForm({
                  action: '/admin/hospitality/reservations',
                  method: 'post',
                  submit: _('hospitality_core.reservation.action.create'),
                  submitVariant: 'primary',
                  hidden: {
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
                  },
                  fields: [],
                }),
              ]),
            }),
          ]
        : []),
      section({
        title: _('hospitality_core.reservation.section.list'),
        description: _('hospitality_core.reservation.section.listHint'),
        body: data.rows.length
          ? dataTable(_, {
              columns: reservationColumns(_, locale, timezone),
              rows: data.rows,
              id: (row) => row.id,
            })
          : emptyState(
              _('hospitality_core.screen.reservations.empty'),
              _('hospitality_core.screen.reservations.emptyHint'),
            ),
      }),
    ]),
  )
}

const reservationDetailFeedback = (
  _: Translator,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult | null => {
  if (status === 'checked-in')
    return notice({
      title: _('hospitality_core.reservation.feedback.checkedIn'),
      message: _('hospitality_core.reservation.feedback.checkedInHint'),
      tone: 'positive',
    })
  if (status === 'checked-out')
    return notice({
      title: _('hospitality_core.reservation.feedback.checkedOut'),
      message: _('hospitality_core.reservation.feedback.checkedOutHint'),
      tone: 'positive',
    })
  if (status === 'cancelled')
    return notice({
      title: _('hospitality_core.reservation.feedback.cancelled'),
      message: _('hospitality_core.reservation.feedback.cancelledHint'),
      tone: 'warning',
    })
  if (errors.length)
    return notice({
      title: _('hospitality_core.feedback.invalid'),
      message: errors.join(' '),
      tone: 'danger',
    })
  return null
}

export const reservationDetailScreen = (
  _: Translator,
  reservation: ReservationDetail,
  rooms: RoomRow[],
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

  if (reservation.state === 'confirmed' && reservation.stayId) {
    actions.push(
      section({
        title: _('hospitality_core.reservation.action.checkIn'),
        description: _('hospitality_core.reservation.action.checkInHint'),
        body: rooms.length
          ? recordForm({
              action,
              method: 'post',
              submit: _('hospitality_core.reservation.action.checkIn'),
              submitVariant: 'primary',
              hidden: { operation: 'check-in', lang: locale },
              fields: [
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
              ],
            })
          : emptyState(
              _('hospitality_core.reservation.empty.availableRooms'),
              _('hospitality_core.reservation.empty.availableRoomsHint'),
            ),
      }),
    )
  }

  if (reservation.state === 'checked_in' && reservation.stayId) {
    actions.push(
      section({
        title: _('hospitality_core.reservation.action.checkOut'),
        description: _('hospitality_core.reservation.action.checkOutHint'),
        body: recordForm({
          action,
          method: 'post',
          submit: _('hospitality_core.reservation.action.checkOut'),
          submitVariant: 'primary',
          hidden: { operation: 'check-out', lang: locale },
          fields: [],
        }),
      }),
    )
  }

  if (reservation.state === 'draft' || reservation.state === 'confirmed') {
    actions.push(
      section({
        title: _('hospitality_core.reservation.action.cancel'),
        description: _('hospitality_core.reservation.action.cancelHint'),
        body: recordForm({
          action,
          method: 'post',
          submit: _('hospitality_core.reservation.action.cancel'),
          submitVariant: 'destructive',
          hidden: { operation: 'cancel', lang: locale },
          fields: [
            {
              name: 'reason',
              label: _('hospitality_core.reservation.field.cancelReason'),
              type: 'textarea',
              help: _('hospitality_core.reservation.field.cancelReasonHint'),
            },
          ],
        }),
      }),
    )
  }

  return framed(
    _,
    _('hospitality_core.reservation.detail.title', { code: reservation.code }),
    frame,
    stack([
      reservationDetailFeedback(_, status, errors),
      recordWorkspace({
        kicker: _('hospitality_core.reservation.detail.kicker'),
        title: reservation.code,
        subtitle: guest,
        imageFallback: icon('hotel'),
        badges: [
          badge(
            _(`hospitality_core.reservationState.${reservation.state}`),
            workflowTone(reservation.state),
            reservation.state,
          ),
          badge(_(`hospitality_core.provider.${reservation.provider}`), 'neutral'),
        ],
        summary: [
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
        ],
        navigation: linkButton({
          label: _('hospitality_core.reservation.action.back'),
          href: backHref,
          variant: 'tertiary',
          icon: 'chevron-left',
        }),
        body: stack([
          section({
            title: _('hospitality_core.reservation.detail.stay'),
            description: _('hospitality_core.reservation.detail.stayHint'),
            body: definitionList({
              title: reservation.code,
              items: [
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
              ],
            }),
          }),
          ...actions,
        ]),
      }),
    ]),
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

const stayDetailFeedback = (
  _: Translator,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult | null => {
  if (status === 'guest-added')
    return notice({
      title: _('hospitality_core.stay.feedback.guestAdded'),
      message: _('hospitality_core.stay.feedback.guestAddedHint'),
      tone: 'positive',
    })
  if (status === 'room-moved')
    return notice({
      title: _('hospitality_core.stay.feedback.roomMoved'),
      message: _('hospitality_core.stay.feedback.roomMovedHint'),
      tone: 'positive',
    })
  if (errors.length)
    return notice({
      title: _('hospitality_core.feedback.invalid'),
      message: errors.join(' '),
      tone: 'danger',
    })
  return null
}

export const stayDetailScreen = (
  _: Translator,
  stay: StayRow,
  rooms: RoomRow[],
  partners: Choice[],
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
  const availableRooms = rooms.filter(
    (room) => room.active && room.status === 'available' && room.id !== stay.currentRoomId,
  )

  return framed(
    _,
    _('hospitality_core.stay.detail.title', { code: stay.code }),
    frame,
    stack([
      stayDetailFeedback(_, status, errors),
      recordWorkspace({
        kicker: _('hospitality_core.stay.detail.kicker'),
        title: stay.code,
        subtitle: guest,
        imageFallback: icon('hotel'),
        badges: [
          badge(_(`hospitality_core.stayState.${stay.state}`), workflowTone(stay.state), stay.state),
          badge(_(`hospitality_core.bookingType.${stay.bookingType}`), 'neutral'),
        ],
        summary: [
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
        ],
        navigation: linkButton({
          label: _('hospitality_core.stay.action.back'),
          href: `/admin/hospitality/stays?property=${encodeURIComponent(stay.propertyId)}&lang=${encodeURIComponent(locale)}`,
          variant: 'tertiary',
          icon: 'chevron-left',
        }),
        body: stack([
          section({
            title: _('hospitality_core.stay.section.information'),
            description: _('hospitality_core.stay.section.informationHint'),
            body: definitionList({
              title: stay.code,
              items: [
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
              ],
            }),
          }),
          section({
            title: _('hospitality_core.stay.section.assignments'),
            description: _('hospitality_core.stay.section.assignmentsHint'),
            body: stack([
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
              stay.state === 'checked_in'
                ? availableRooms.length
                  ? recordForm({
                      action,
                      method: 'post',
                      submit: _('hospitality_core.stay.action.moveRoom'),
                      submitVariant: 'secondary',
                      hidden: { operation: 'move-room', lang: locale },
                      fields: [
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
                      ],
                    })
                  : notice({
                      title: _('hospitality_core.stay.empty.availableRooms'),
                      message: _('hospitality_core.stay.empty.availableRoomsHint'),
                      tone: 'warning',
                    })
                : null,
            ]),
          }),
          section({
            title: _('hospitality_core.stay.section.guests'),
            description: _('hospitality_core.stay.section.guestsHint'),
            body: stack([
              guests.length
                ? dataTable(_, { columns: stayGuestColumns(_), rows: guests, id: (row) => row.id })
                : emptyState(
                    _('hospitality_core.stay.empty.guests'),
                    _('hospitality_core.stay.empty.guestsHint'),
                  ),
              stay.state === 'draft' || stay.state === 'checked_in'
                ? recordForm({
                    action,
                    method: 'post',
                    submit: _('hospitality_core.stay.action.addGuest'),
                    submitVariant: 'secondary',
                    hidden: { operation: 'add-guest', lang: locale },
                    fields: [
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
                    ],
                  })
                : null,
            ]),
          }),
        ]),
      }),
    ]),
  )
}

export const staysScreen = (
  _: Translator,
  rows: StayRow[],
  locale: string,
  timezone: string,
  frame: Frame,
): TemplateResult =>
  framed(
    _,
    _('hospitality_core.screen.stays.title'),
    frame,
    rows.length
      ? dataTable(_, { columns: stayColumns(_, locale, timezone), rows, id: (row) => row.id })
      : emptyState(_('hospitality_core.screen.stays.empty'), _('hospitality_core.screen.stays.emptyHint')),
  )

const folioDetailFeedback = (
  _: Translator,
  status?: string | null,
  errors: readonly string[] = [],
): TemplateResult | null => {
  if (status === 'charge-posted')
    return notice({
      title: _('hospitality_core.folio.feedback.chargePosted'),
      message: _('hospitality_core.folio.feedback.chargePostedHint'),
      tone: 'positive',
    })
  if (status === 'charge-voided')
    return notice({
      title: _('hospitality_core.folio.feedback.chargeVoided'),
      message: _('hospitality_core.folio.feedback.chargeVoidedHint'),
      tone: 'positive',
    })
  if (errors.length)
    return notice({
      title: _('hospitality_core.feedback.invalid'),
      message: errors.join(' '),
      tone: 'danger',
    })
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

  return framed(
    _,
    _('hospitality_core.folio.detail.title', { code: folio.code }),
    frame,
    stack([
      folioDetailFeedback(_, status, errors),
      notice({
        title: _('hospitality_core.folio.notice.operational'),
        message: _('hospitality_core.folio.notice.operationalHint'),
        tone: 'info',
      }),
      recordWorkspace({
        kicker: _('hospitality_core.folio.detail.kicker'),
        title: folio.code,
        subtitle: guest,
        imageFallback: icon('receipt-text'),
        badges: [
          badge(_(`hospitality_core.folioState.${folio.state}`), workflowTone(folio.state), folio.state),
        ],
        summary: [
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
        ],
        navigation: linkButton({
          label: _('hospitality_core.folio.action.back'),
          href: `/admin/hospitality/folios?property=${encodeURIComponent(folio.propertyId)}&lang=${encodeURIComponent(locale)}`,
          variant: 'tertiary',
          icon: 'chevron-left',
        }),
        body: stack([
          section({
            title: _('hospitality_core.folio.section.information'),
            description: _('hospitality_core.folio.section.informationHint'),
            body: definitionList({
              title: folio.code,
              items: [
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
              ],
            }),
          }),
          section({
            title: _('hospitality_core.folio.section.charges'),
            description: _('hospitality_core.folio.section.chargesHint'),
            body: stack([
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
              folio.state === 'open'
                ? recordForm({
                    action,
                    method: 'post',
                    submit: _('hospitality_core.folio.action.postCharge'),
                    submitVariant: 'secondary',
                    hidden: { operation: 'post-charge', id: chargeId, lang: locale },
                    fields: [
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
                    ],
                  })
                : null,
            ]),
          }),
          activeCharges.length && folio.state === 'open'
            ? section({
                title: _('hospitality_core.folio.section.correction'),
                description: _('hospitality_core.folio.section.correctionHint'),
                body: recordForm({
                  action,
                  method: 'post',
                  submit: _('hospitality_core.folio.action.voidCharge'),
                  submitVariant: 'destructive',
                  hidden: { operation: 'void-charge', lang: locale },
                  fields: [
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
                  ],
                }),
              })
            : null,
          section({
            title: _('hospitality_core.folio.section.stays'),
            description: _('hospitality_core.folio.section.staysHint'),
            body: stays.length
              ? dataTable(_, {
                  columns: folioStayColumns(_, locale, timezone),
                  rows: stays,
                  id: (stay) => stay.id,
                })
              : emptyState(
                  _('hospitality_core.folio.empty.stays'),
                  _('hospitality_core.folio.empty.staysHint'),
                ),
          }),
        ]),
      }),
    ]),
  )
}

export const foliosScreen = (
  _: Translator,
  rows: FolioRow[],
  locale: string,
  timezone: string,
  frame: Frame,
): TemplateResult =>
  framed(
    _,
    _('hospitality_core.screen.folios.title'),
    frame,
    rows.length
      ? dataTable(_, { columns: folioColumns(_, locale, timezone), rows, id: (row) => row.id })
      : emptyState(_('hospitality_core.screen.folios.empty'), _('hospitality_core.screen.folios.emptyHint')),
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
      detail: _(`hospitality_core.provider.${event.provider}`),
      state: event.state,
      tone: workflowTone(event.state),
    }
  })
  return framed(
    _,
    _('hospitality_core.screen.tapeChart.title'),
    frame,
    scheduleBoard({
      corner: _('hospitality_core.screen.tapeChart.corner'),
      days,
      rows,
      events,
      empty: emptyState(
        _('hospitality_core.screen.tapeChart.empty'),
        _('hospitality_core.screen.tapeChart.emptyHint'),
      ),
    }),
  )
}
