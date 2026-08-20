import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  badge,
  cardGrid,
  code,
  dataTable,
  emptyState,
  framed,
  metric,
  person,
  scheduleBoard,
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
  code: string
  name: string
  defaultCapacity: number
  baseRate: string | number
  published: boolean
  rooms?: unknown[]
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

const amount = (value: string | number, locale: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(value))

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
    cell: (row) => [row.city, row.country].filter(Boolean).join(', ') || '—',
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
    cell: (row) => String(row.baseRate),
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
    cell: (row) => amount(row.amountTotal, locale),
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
    cell: (row) => amount(row.amountTotal, locale),
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
