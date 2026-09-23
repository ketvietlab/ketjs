// What the search-filter bar offers on each hospitality list.
//
// All five lists here read a complete, authorised collection and narrow it in
// memory, so every one of them is a row list: the presets are predicates over
// the state or the shape the list already shows in its own status column.
//
// Only the columns each list displays are described, plus what a reader asks a
// front desk for by name — a guest or a room, which sit on joined rows and so
// arrive through `value`.
import { defineRowList } from '../backend/row-list.ts'

const STAY_STATES = ['draft', 'checked_in', 'checked_out', 'no_show', 'cancelled'] as const
const FOLIO_STATES = ['draft', 'open', 'closed', 'cancelled'] as const
const ACCOMMODATION = [
  'hotel',
  'resort',
  'hostel',
  'homestay',
  'villa',
  'boutique',
  'aparthotel',
  'serviced_apartment',
] as const
const POLICY_TYPES = ['flexible', 'moderate', 'strict', 'non_refundable'] as const
const AMENITY_SCOPES = ['property', 'room'] as const

const guest = (row: Record<string, unknown>): string =>
  ((row.partner as { name?: string } | null)?.name ?? '').toString()

const room = (row: Record<string, unknown>): string => {
  const current = row.currentRoom as { name?: string; code?: string } | null
  return `${current?.name ?? ''} ${current?.code ?? ''}`.trim()
}

export const stayListSearch = defineRowList({
  key: 'hospitality.stays',
  searchable: [{ key: 'code' }, { key: 'guest' }, { key: 'room' }],
  filterable: [
    { key: 'code', label: 'hospitality_core.col.code', type: 'text' },
    { key: 'guest', label: 'hospitality_core.col.guest', type: 'text' },
    { key: 'room', label: 'hospitality_core.col.room', type: 'text' },
    { key: 'state', label: 'hospitality_core.col.status', type: 'selection', choices: STAY_STATES },
    { key: 'checkIn', label: 'hospitality_core.col.checkIn', type: 'date' },
    { key: 'checkOut', label: 'hospitality_core.col.checkOut', type: 'date' },
  ],
  groupable: [
    { key: 'state', label: 'hospitality_core.col.status' },
    { key: 'checkIn', label: 'hospitality_core.col.checkIn', intervals: ['day', 'week', 'month'] },
    { key: 'checkOut', label: 'hospitality_core.col.checkOut', intervals: ['day', 'week', 'month'] },
  ],
  sortable: [
    { key: 'code', label: 'hospitality_core.col.code' },
    { key: 'checkIn', label: 'hospitality_core.col.checkIn' },
    { key: 'checkOut', label: 'hospitality_core.col.checkOut' },
  ],
  presets: [
    ...STAY_STATES.map((state) => ({
      key: state,
      label: `hospitality_core.stayState.${state}`,
      group: 'state',
      match: (row: Record<string, unknown>) => row.state === state,
    })),
    {
      // The one thing the list marks that no column names: somebody still in a
      // room the calendar says they have left.
      key: 'overdue',
      label: 'hospitality_core.stayState.overdue',
      group: 'overdue',
      match: (row) => row.state === 'checked_in' && String(row.checkOut ?? '') < new Date().toISOString(),
    },
  ],
  defaultSort: [{ key: 'checkIn', dir: 'desc' }],
  value: (row, key) => (key === 'guest' ? guest(row) : key === 'room' ? room(row) : row[key]),
})

export const folioListSearch = defineRowList({
  key: 'hospitality.folios',
  searchable: [{ key: 'code' }, { key: 'guest' }],
  filterable: [
    { key: 'code', label: 'hospitality_core.col.code', type: 'text' },
    { key: 'guest', label: 'hospitality_core.col.guest', type: 'text' },
    { key: 'state', label: 'hospitality_core.col.status', type: 'selection', choices: FOLIO_STATES },
    { key: 'openedAt', label: 'hospitality_core.col.checkIn', type: 'datetime' },
    { key: 'amountTotal', label: 'hospitality_core.col.amount', type: 'number' },
  ],
  groupable: [
    { key: 'state', label: 'hospitality_core.col.status' },
    { key: 'openedAt', label: 'hospitality_core.col.checkIn', intervals: ['day', 'week', 'month'] },
  ],
  sortable: [
    { key: 'code', label: 'hospitality_core.col.code' },
    { key: 'openedAt', label: 'hospitality_core.col.checkIn' },
    { key: 'amountTotal', label: 'hospitality_core.col.amount' },
  ],
  presets: FOLIO_STATES.map((state) => ({
    key: state,
    label: `hospitality_core.folioState.${state}`,
    group: 'state',
    match: (row: Record<string, unknown>) => row.state === state,
  })),
  defaultSort: [{ key: 'openedAt', dir: 'desc' }],
  value: (row, key) => (key === 'guest' ? guest(row) : row[key]),
})

export const propertyListSearch = defineRowList({
  key: 'hospitality.properties',
  searchable: [{ key: 'code' }, { key: 'name' }, { key: 'city' }],
  filterable: [
    { key: 'code', label: 'hospitality_core.col.code', type: 'text' },
    { key: 'name', label: 'hospitality_core.col.name', type: 'text' },
    {
      key: 'accommodationType',
      label: 'hospitality_core.col.type',
      type: 'selection',
      choices: ACCOMMODATION,
    },
    { key: 'city', label: 'hospitality_core.col.location', type: 'text' },
    { key: 'rooms', label: 'hospitality_core.col.rooms', type: 'number' },
    { key: 'starRating', label: 'hospitality_core.col.stars', type: 'number' },
    { key: 'active', label: 'hospitality_core.col.status', type: 'boolean' },
  ],
  groupable: [
    { key: 'accommodationType', label: 'hospitality_core.col.type' },
    { key: 'city', label: 'hospitality_core.col.location' },
    { key: 'starRating', label: 'hospitality_core.col.stars' },
  ],
  sortable: [
    { key: 'code', label: 'hospitality_core.col.code' },
    { key: 'name', label: 'hospitality_core.col.name' },
    { key: 'rooms', label: 'hospitality_core.col.rooms' },
    { key: 'starRating', label: 'hospitality_core.col.stars' },
  ],
  presets: [
    ...ACCOMMODATION.map((type) => ({
      key: type,
      label: `hospitality_core.accommodation.${type}`,
      group: 'accommodationType',
      match: (row: Record<string, unknown>) => row.accommodationType === type,
    })),
    {
      // Which houses have a room that wants looking at, which is the reason
      // this list carries that count at all.
      key: 'needsAttention',
      label: 'hospitality_core.filter.needsAttention',
      group: 'attention',
      match: (row) => Number(row.attentionRooms ?? 0) > 0,
    },
  ],
  defaultSort: [{ key: 'name', dir: 'asc' }],
})

export const amenityListSearch = defineRowList({
  key: 'hospitality.amenities',
  searchable: [{ key: 'code' }, { key: 'name' }],
  filterable: [
    { key: 'code', label: 'hospitality_core.col.code', type: 'text' },
    { key: 'name', label: 'hospitality_core.col.name', type: 'text' },
    { key: 'scope', label: 'hospitality_core.col.scope', type: 'selection', choices: AMENITY_SCOPES },
  ],
  groupable: [{ key: 'scope', label: 'hospitality_core.col.scope' }],
  sortable: [
    { key: 'code', label: 'hospitality_core.col.code' },
    { key: 'name', label: 'hospitality_core.col.name' },
  ],
  presets: AMENITY_SCOPES.map((scope) => ({
    key: scope,
    label: `hospitality_core.amenityScope.${scope}`,
    group: 'scope',
    match: (row: Record<string, unknown>) => row.scope === scope,
  })),
  defaultSort: [{ key: 'name', dir: 'asc' }],
})

export const policyListSearch = defineRowList({
  key: 'hospitality.policies',
  searchable: [{ key: 'code' }, { key: 'name' }],
  filterable: [
    { key: 'code', label: 'hospitality_core.col.code', type: 'text' },
    { key: 'name', label: 'hospitality_core.col.name', type: 'text' },
    { key: 'type', label: 'hospitality_core.col.policy', type: 'selection', choices: POLICY_TYPES },
    {
      key: 'freeCancellationHours',
      label: 'hospitality_core.col.freeCancellation',
      type: 'number',
    },
    { key: 'penaltyPercent', label: 'hospitality_core.col.penalty', type: 'number' },
  ],
  groupable: [{ key: 'type', label: 'hospitality_core.col.policy' }],
  sortable: [
    { key: 'code', label: 'hospitality_core.col.code' },
    { key: 'name', label: 'hospitality_core.col.name' },
    { key: 'penaltyPercent', label: 'hospitality_core.col.penalty' },
  ],
  presets: [
    ...POLICY_TYPES.map((type) => ({
      key: type,
      label: `hospitality_core.policy.${type}`,
      group: 'type',
      match: (row: Record<string, unknown>) => row.type === type,
    })),
    {
      key: 'freeCancellation',
      label: 'hospitality_core.filter.freeCancellation',
      group: 'cancellation',
      match: (row) => Number(row.freeCancellationHours ?? 0) > 0,
    },
  ],
  defaultSort: [{ key: 'name', dir: 'asc' }],
})
