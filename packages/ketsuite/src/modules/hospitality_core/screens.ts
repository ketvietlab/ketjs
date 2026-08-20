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
  metric,
  mediaPanel,
  notice,
  person,
  recordForm,
  scheduleBoard,
  section,
  stack,
} from '../../ui/index.ts'
import type { Column, Frame } from '../../ui/index.ts'
import { addCalendarDays, dateKeyIn, zonedMidnight } from './calendar.ts'

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
  rooms: number
  availableRooms: number
  attentionRooms: number
}

export type RoomRow = {
  id: string
  code: string
  name: string
  roomTypeId: string
  capacity: number
  status: string
  roomType?: { name?: string } | null
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
  taskType: string
  priority: string
  state: string
  requestedAt: string
  startedAt?: string | null
  room?: { code?: string; name?: string } | null
  assigneeId?: string | null
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

export type StayRow = {
  id: string
  code: string
  folioId: string
  partnerId: string
  roomTypeId: string
  currentRoomId?: string | null
  checkIn: string
  checkOut: string
  adults: number
  children: number
  state: string
  partner?: { name?: string } | null
  roomType?: { name?: string } | null
  currentRoom?: { name?: string; code?: string } | null
}

export type FolioRow = {
  id: string
  code: string
  partnerId: string
  state: string
  amountTotal: string | number
  openedAt: string
  closedAt?: string | null
  partner?: { name?: string } | null
  stays?: unknown[]
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

const cleaningTaskColumns = (_: Translator, locale: string): Array<Column<CleaningTaskRow>> => [
  { key: 'code', label: _('hospitality_core.col.code'), cell: (row) => code(row.code), kind: 'identifier' },
  {
    key: 'room',
    label: _('hospitality_core.col.room'),
    cell: (row) => row.room?.name ?? row.room?.code ?? '—',
    priority: 'primary',
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
    cell: (row) => dateTime(row.requestedAt, locale, 'UTC'),
    kind: 'date',
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
    key: 'status',
    label: _('hospitality_core.col.status'),
    cell: (row) =>
      badge(_(`hospitality_core.cleaningState.${row.state}`), workflowTone(row.state), row.state),
    kind: 'status',
    priority: 'primary',
  },
]

export const propertiesScreen = (
  _: Translator,
  rows: PropertyRow[],
  totals: { rooms: number; available: number; attention: number },
  frame: Frame,
): TemplateResult =>
  framed(
    _,
    _('hospitality_core.screen.properties.title'),
    frame,
    stack([
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
        ? dataTable(_, { columns: propertyColumns(_), rows, id: (row) => row.id })
        : emptyState(
            _('hospitality_core.screen.properties.empty'),
            _('hospitality_core.screen.properties.emptyHint'),
          ),
    ]),
  )

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
  rows: CleaningTaskRow[],
  locale: string,
  frame: Frame,
): TemplateResult =>
  framed(
    _,
    _('hospitality_core.screen.cleaningTasks.title'),
    frame,
    rows.length
      ? dataTable(_, { columns: cleaningTaskColumns(_, locale), rows, id: (row) => row.id })
      : emptyState(
          _('hospitality_core.screen.cleaningTasks.empty'),
          _('hospitality_core.screen.cleaningTasks.emptyHint'),
        ),
  )

export const housekeepingRoomsScreen = (_: Translator, rows: RoomRow[], frame: Frame): TemplateResult =>
  framed(
    _,
    _('hospitality_core.screen.housekeepingRooms.title'),
    frame,
    rows.length
      ? dataTable(_, { columns: roomColumns(_), rows, id: (row) => row.id })
      : emptyState(
          _('hospitality_core.screen.housekeepingRooms.empty'),
          _('hospitality_core.screen.housekeepingRooms.emptyHint'),
        ),
  )

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
  { key: 'code', label: _('hospitality_core.col.code'), cell: (row) => code(row.code), kind: 'identifier' },
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
  { key: 'code', label: _('hospitality_core.col.code'), cell: (row) => code(row.code), kind: 'identifier' },
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
  { key: 'code', label: _('hospitality_core.col.code'), cell: (row) => code(row.code), kind: 'identifier' },
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

export const reservationsScreen = (
  _: Translator,
  rows: ReservationRow[],
  locale: string,
  timezone: string,
  frame: Frame,
): TemplateResult =>
  framed(
    _,
    _('hospitality_core.screen.reservations.title'),
    frame,
    rows.length
      ? dataTable(_, { columns: reservationColumns(_, locale, timezone), rows, id: (row) => row.id })
      : emptyState(
          _('hospitality_core.screen.reservations.empty'),
          _('hospitality_core.screen.reservations.emptyHint'),
        ),
  )

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
