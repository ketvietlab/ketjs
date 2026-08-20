import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  badge,
  cardGrid,
  code,
  dataTable,
  datePicker,
  emptyState,
  formCluster,
  formatMoney,
  framed,
  metric,
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
