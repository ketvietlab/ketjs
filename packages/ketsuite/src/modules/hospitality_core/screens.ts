import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import { badge, code, dataTable, emptyState, framed, metric, stack, surface } from '../../ui/index.ts'
import type { Column, Frame } from '../../ui/index.ts'

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

const statusTone = (status: string): 'positive' | 'warning' | 'danger' | 'info' | 'neutral' => {
  if (status === 'available') return 'positive'
  if (status === 'dirty' || status === 'cleaning') return 'warning'
  if (status === 'maintenance' || status === 'out_of_order') return 'danger'
  if (status === 'occupied') return 'info'
  return 'neutral'
}

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
      surface({
        tone: 'subtle',
        body: stack(
          [
            metric({ label: _('hospitality_core.metric.properties'), value: String(rows.length) }),
            metric({ label: _('hospitality_core.metric.rooms'), value: String(totals.rooms) }),
            metric({
              label: _('hospitality_core.metric.available'),
              value: String(totals.available),
              tone: 'positive',
            }),
            metric({
              label: _('hospitality_core.metric.attention'),
              value: String(totals.attention),
              tone: 'warning',
            }),
          ],
          'compact',
        ),
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
