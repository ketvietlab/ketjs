import { randomUUID } from 'node:crypto'
import { and, asc, defineFn, eq, from, gt, gte, inArray, lte, not, or } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { addCalendarDays, dateKeyIn } from './calendar.ts'
import { MEAL_PLANS, OUT_OF_SERVICE_ROOM_STATUSES, RATE_TYPES } from './types.ts'

export type InventoryIssue = {
  field: string
  code: string
  messageKey: string
  params?: Record<string, unknown>
}

const issue = (field: string, code: string, params?: Record<string, unknown>): InventoryIssue => ({
  field,
  code,
  messageKey: `hospitality_core.validation.${code}`,
  ...(params ? { params } : {}),
})
const failure = (...errors: InventoryIssue[]) => ({ ok: false, errors })
const cleanCode = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toUpperCase()
const cleanText = (value: unknown): string => String(value ?? '').trim()
const oneOf = (values: readonly string[], value: unknown): boolean => values.includes(String(value))
const natural = (value: unknown): number => Number(value ?? 0)
const isNatural = (value: unknown): boolean => Number.isInteger(natural(value)) && natural(value) >= 0

const record = async (ctx: Ctx, model: string, id: unknown): Promise<Row | null> => {
  const table = ctx.table(model)
  return ctx.db.one(from(table).where(eq(table.id, id)))
}

const validDateKey = (value: unknown): value is string => {
  const key = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  const parsed = new Date(`${key}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === key
}

const dateRange = (
  from: unknown,
  to: unknown,
  maximum = 366,
): { dates: string[]; errors: InventoryIssue[] } => {
  const errors: InventoryIssue[] = []
  if (!validDateKey(from)) errors.push(issue('from', 'date'))
  if (!validDateKey(to)) errors.push(issue('to', 'date'))
  if (errors.length) return { dates: [], errors }
  if (String(to) < String(from)) return { dates: [], errors: [issue('to', 'date_range_order')] }
  const dates: string[] = []
  for (let value = String(from); value <= String(to); value = addCalendarDays(value, 1)) {
    dates.push(value)
    if (dates.length > maximum)
      return { dates: [], errors: [issue('to', 'inventory_horizon', { count: maximum })] }
  }
  return { dates, errors: [] }
}

/** Calendar nights occupied by a stay; checkout is deliberately excluded. */
export const occupancyDates = (checkIn: unknown, checkOut: unknown, timezone: string): string[] => {
  const start = new Date(String(checkIn ?? ''))
  const end = new Date(String(checkOut ?? ''))
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return []
  const first = dateKeyIn(start, timezone)
  const checkout = dateKeyIn(end, timezone)
  const dates: string[] = []
  for (let value = first; value < checkout && dates.length <= 366; value = addCalendarDays(value, 1))
    dates.push(value)
  return dates
}

export class InventoryConflict extends Error {
  readonly problem: InventoryIssue

  constructor(problem: InventoryIssue) {
    super(problem.code)
    this.problem = problem
  }
}

export type InventoryChangeInput = {
  propertyId: unknown
  roomTypeId: unknown
  kind: 'rate' | 'availability' | 'restriction'
  dateFrom: string
  dateTo: string
  aggregateId?: unknown
}

/** Record a durable signal inside the caller's current transaction. */
export const recordInventoryChange = async (ctx: Ctx, values: InventoryChangeInput): Promise<void> => {
  await ctx.db.insert('hospitality_core.InventoryChange', {
    id: randomUUID(),
    propertyId: values.propertyId,
    roomTypeId: values.roomTypeId,
    kind: values.kind,
    dateFrom: values.dateFrom,
    dateTo: values.dateTo,
    aggregateId: values.aggregateId,
    createdAt: new Date().toISOString(),
  })
}

/**
 * Rooms a room type can actually sell tonight: active, and not withdrawn from
 * service. Occupied and dirty rooms stay in the pool because they are sold or
 * about to be; maintenance and out-of-order rooms cannot be handed to a guest,
 * so counting them is what let a reservation be taken against a room the front
 * desk can never assign.
 */
export const sellableRooms = async (ctx: Ctx, propertyId: unknown, roomTypeId: unknown): Promise<number> => {
  const Room = ctx.table('hospitality_core.Room')
  return ctx.db.count(
    from(Room).where(
      eq(Room.propertyId, propertyId),
      eq(Room.roomTypeId, roomTypeId),
      eq(Room.active, true),
      not(inArray(Room.status, [...OUT_OF_SERVICE_ROOM_STATUSES])),
    ),
  )
}

const physicalTotal = sellableRooms

/** Read-only availability used by quotes. The final reservation still claims with compare-and-set. */
export const quoteAvailability = async (
  ctx: Ctx,
  propertyId: unknown,
  roomTypeId: unknown,
  dates: readonly string[],
  quantity = 1,
): Promise<{ minimumAvailable: number; errors: InventoryIssue[] }> => {
  const total = await physicalTotal(ctx, propertyId, roomTypeId)
  if (!dates.length) return { minimumAvailable: total, errors: [] }
  const Ledger = ctx.table('hospitality_core.AvailabilityLedger')
  const rows = await ctx.db.all(
    from(Ledger).where(
      eq(Ledger.propertyId, propertyId),
      eq(Ledger.roomTypeId, roomTypeId),
      gte(Ledger.date, dates[0]),
      lte(Ledger.date, dates.at(-1)),
    ),
  )
  const byDate = new Map(rows.map((row) => [String(row.date), row]))
  let minimumAvailable = Number.POSITIVE_INFINITY
  const errors: InventoryIssue[] = []
  for (const date of dates) {
    const row = byDate.get(date)
    const available = Number(row?.available ?? total)
    minimumAvailable = Math.min(minimumAvailable, available)
    if (available < quantity)
      errors.push(issue('roomTypeId', 'no_availability', { date, available, required: quantity }))
  }
  return {
    minimumAvailable: Number.isFinite(minimumAvailable) ? minimumAvailable : total,
    errors,
  }
}

const ledgerId = (roomTypeId: unknown, date: string): string => `${String(roomTypeId)}:${date}`
const restrictionId = (roomTypeId: unknown, date: string): string => `${String(roomTypeId)}:${date}`

const ensureLedgerRows = async (
  ctx: Ctx,
  propertyId: unknown,
  roomTypeId: unknown,
  dates: readonly string[],
): Promise<void> => {
  if (!dates.length) return
  const total = await physicalTotal(ctx, propertyId, roomTypeId)
  for (const date of dates)
    await ctx.db.insertIfAbsent('hospitality_core.AvailabilityLedger', {
      id: ledgerId(roomTypeId, date),
      propertyId,
      roomTypeId,
      date,
      total,
      totalManual: false,
      sold: 0,
      blocked: 0,
      available: total,
      version: 0,
    })
}

/**
 * Bring every unclaimed future ledger row back in line with the sellable room
 * count, and report the dates that are now committed beyond capacity so the
 * caller can refuse the change or warn the operator.
 *
 * Rows an operator set by hand are left alone: an allotment is a decision, not
 * a cache of the room table. Past dates are history and are never rewritten.
 */
export const syncLedgerCapacity = async (
  ctx: Ctx,
  propertyId: unknown,
  roomTypeId: unknown,
  today: string,
): Promise<{ changed: number; overcommitted: Array<{ date: string; committed: number; total: number }> }> => {
  const total = await sellableRooms(ctx, propertyId, roomTypeId)
  const Ledger = ctx.table('hospitality_core.AvailabilityLedger')
  const rows = await ctx.db.all(
    from(Ledger).where(
      eq(Ledger.propertyId, propertyId),
      eq(Ledger.roomTypeId, roomTypeId),
      eq(Ledger.totalManual, false),
      gte(Ledger.date, today),
    ),
  )
  const overcommitted: Array<{ date: string; committed: number; total: number }> = []
  let changed = 0
  for (const row of rows) {
    const committed = Number(row.sold) + Number(row.blocked)
    if (committed > total) overcommitted.push({ date: String(row.date), committed, total })
    if (Number(row.total) === total) continue
    const version = Number(row.version)
    const applied = await ctx.db.compareAndSet(
      'hospitality_core.AvailabilityLedger',
      { id: row.id },
      { version },
      { total, available: total - Number(row.sold) - Number(row.blocked), version: version + 1 },
    )
    if ('dryRun' in applied || applied.matched) changed += 1
  }
  return { changed, overcommitted }
}

/**
 * Rooms free for an hourly stay. Hourly bookings never touch the date ledger —
 * a room resold at 18:00 is not a second room-night — so concurrency is read
 * from the reservations themselves: the peak of overlapping arrivals is what a
 * new booking has to fit under.
 */
export const hourlyAvailable = async (
  ctx: Ctx,
  propertyId: unknown,
  roomTypeId: unknown,
  from_: unknown,
  to: unknown,
  excludeReservationId?: unknown,
): Promise<number> => {
  const start = new Date(String(from_ ?? '')).getTime()
  const end = new Date(String(to ?? '')).getTime()
  const total = await sellableRooms(ctx, propertyId, roomTypeId)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return total
  const Reservation = ctx.table('hospitality_core.Reservation')
  const rows = await ctx.db.all(
    from(Reservation).where(
      eq(Reservation.propertyId, propertyId),
      eq(Reservation.roomTypeId, roomTypeId),
      inArray(Reservation.state, ['draft', 'confirmed', 'checked_in']),
    ),
  )
  const events: Array<[number, number]> = []
  for (const row of rows) {
    if (excludeReservationId != null && row.id === excludeReservationId) continue
    const rowStart = new Date(String(row.checkIn)).getTime()
    const rowEnd = new Date(String(row.checkOut)).getTime()
    if (!Number.isFinite(rowStart) || !Number.isFinite(rowEnd)) continue
    if (rowStart >= end || rowEnd <= start) continue
    const quantity = Math.max(1, Number(row.roomQuantity ?? 1))
    events.push([rowStart, quantity], [rowEnd, -quantity])
  }
  events.sort((left, right) => left[0] - right[0] || left[1] - right[1])
  let running = 0
  let peak = 0
  for (const [, delta] of events) {
    running += delta
    peak = Math.max(peak, running)
  }
  return Math.max(total - peak, 0)
}

type LedgerPatch = (
  current: Row,
) => { total: number; sold: number; blocked: number; totalManual?: boolean } | InventoryIssue

const changeLedger = async (
  ctx: Ctx,
  propertyId: unknown,
  roomTypeId: unknown,
  date: string,
  patch: LedgerPatch,
): Promise<void> => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await record(ctx, 'hospitality_core.AvailabilityLedger', ledgerId(roomTypeId, date))
    if (!current || current.propertyId !== propertyId || current.roomTypeId !== roomTypeId)
      throw new InventoryConflict(issue('roomTypeId', 'ledger_missing', { date }))
    const next = patch(current)
    if ('field' in next) throw new InventoryConflict(next)
    const version = Number(current.version)
    const changed = await ctx.db.compareAndSet(
      'hospitality_core.AvailabilityLedger',
      { id: current.id },
      { version },
      {
        ...next,
        available: next.total - next.sold - next.blocked,
        version: version + 1,
      },
    )
    if ('matched' in changed && changed.matched) return
  }
  throw new InventoryConflict(issue('roomTypeId', 'transition_conflict'))
}

export const reserveInventory = async (
  ctx: Ctx,
  propertyId: unknown,
  roomTypeId: unknown,
  dates: readonly string[],
  quantity = 1,
): Promise<void> => {
  await ensureLedgerRows(ctx, propertyId, roomTypeId, dates)
  for (const date of [...dates].sort())
    await changeLedger(ctx, propertyId, roomTypeId, date, (current) => {
      const total = Number(current.total)
      const sold = Number(current.sold)
      const blocked = Number(current.blocked)
      const available = total - sold - blocked
      if (available < quantity)
        return issue('roomTypeId', 'no_availability', { date, available, required: quantity })
      return { total, sold: sold + quantity, blocked }
    })
}

export const releaseInventory = async (
  ctx: Ctx,
  propertyId: unknown,
  roomTypeId: unknown,
  dates: readonly string[],
  quantity = 1,
): Promise<void> => {
  await ensureLedgerRows(ctx, propertyId, roomTypeId, dates)
  for (const date of [...dates].sort())
    await changeLedger(ctx, propertyId, roomTypeId, date, (current) => ({
      total: Number(current.total),
      sold: Math.max(Number(current.sold) - quantity, 0),
      blocked: Number(current.blocked),
    }))
}

/**
 * Replace one reservation's room-night claim without exposing a release window.
 * Deltas are applied in one stable order so two concurrent room-type swaps do
 * not lock the same ledger rows in opposite order.
 */
export const replaceReservedInventory = async (
  ctx: Ctx,
  propertyId: unknown,
  previousRoomTypeId: unknown,
  previousDates: readonly string[],
  nextRoomTypeId: unknown,
  nextDates: readonly string[],
  quantity = 1,
): Promise<void> => {
  const deltas = new Map<string, { roomTypeId: unknown; date: string; delta: number }>()
  const add = (roomTypeId: unknown, date: string, delta: number) => {
    const key = `${String(roomTypeId)}\u0000${date}`
    const current = deltas.get(key)
    deltas.set(key, { roomTypeId, date, delta: (current?.delta ?? 0) + delta })
  }
  for (const date of previousDates) add(previousRoomTypeId, date, -quantity)
  for (const date of nextDates) add(nextRoomTypeId, date, quantity)

  const changes = [...deltas.entries()]
    .filter(([, value]) => value.delta !== 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value)
  const datesByRoomType = new Map<unknown, string[]>()
  for (const change of changes) {
    const dates = datesByRoomType.get(change.roomTypeId) ?? []
    dates.push(change.date)
    datesByRoomType.set(change.roomTypeId, dates)
  }
  for (const [roomTypeId, dates] of datesByRoomType)
    await ensureLedgerRows(ctx, propertyId, roomTypeId, dates)
  for (const change of changes)
    await changeLedger(ctx, propertyId, change.roomTypeId, change.date, (current) => {
      const total = Number(current.total)
      const sold = Number(current.sold)
      const blocked = Number(current.blocked)
      if (change.delta > 0 && total - sold - blocked < change.delta)
        return issue('roomTypeId', 'no_availability', {
          date: change.date,
          available: total - sold - blocked,
          required: change.delta,
        })
      return { total, sold: Math.max(sold + change.delta, 0), blocked }
    })
}

export const defaultRatePlan = async (
  ctx: Ctx,
  roomTypeId: unknown,
  rateType: unknown,
): Promise<Row | null> => {
  const Plan = ctx.table('hospitality_core.RatePlan')
  return ctx.db.one(
    from(Plan).where(
      eq(Plan.roomTypeId, roomTypeId),
      eq(Plan.rateType, rateType),
      eq(Plan.isDefault, true),
      eq(Plan.active, true),
    ),
  )
}

export const restrictionIssues = async (
  ctx: Ctx,
  propertyId: unknown,
  roomTypeId: unknown,
  dates: readonly string[],
  checkoutDate: string,
): Promise<InventoryIssue[]> => {
  if (!dates.length) return []
  const Restriction = ctx.table('hospitality_core.Restriction')
  const rows = await ctx.db.all(
    from(Restriction).where(
      eq(Restriction.propertyId, propertyId),
      eq(Restriction.roomTypeId, roomTypeId),
      gte(Restriction.date, dates[0]),
      lte(Restriction.date, checkoutDate),
    ),
  )
  const byDate = new Map(rows.map((row) => [String(row.date), row]))
  const errors: InventoryIssue[] = []
  for (const date of dates) {
    const restriction = byDate.get(date)
    if (!restriction) continue
    if (restriction.stopSell === true) errors.push(issue('checkIn', 'stop_sell', { date }))
    if (Number(restriction.minLos) > 0 && dates.length < Number(restriction.minLos))
      errors.push(issue('checkOut', 'min_los', { date, count: restriction.minLos, actual: dates.length }))
    if (Number(restriction.maxLos) > 0 && dates.length > Number(restriction.maxLos))
      errors.push(issue('checkOut', 'max_los', { date, count: restriction.maxLos, actual: dates.length }))
  }
  if (byDate.get(dates[0]!)?.closedToArrival === true)
    errors.push(issue('checkIn', 'closed_to_arrival', { date: dates[0] }))
  if (byDate.get(checkoutDate)?.closedToDeparture === true)
    errors.push(issue('checkOut', 'closed_to_departure', { date: checkoutDate }))
  return errors
}

const planOutput = {
  id: 'id',
  propertyId: 'id',
  roomTypeId: 'id',
  code: 'text',
  name: 'text',
  rateType: 'text',
  amount: 'decimal',
  isDefault: 'bool',
  mealPlan: 'text?',
  minStay: 'int',
  maxStay: 'int',
  active: 'bool',
  roomType: 'json?',
}

export const inventory: Record<string, FnSpec> = {
  listRatePlans: defineFn({
    input: { propertyId: 'id?', roomTypeId: 'id?', active: 'bool?' },
    output: planOutput,
    effects: ['read:hospitality_core.RatePlan', 'read:hospitality_core.RoomType'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const Plan = ctx.table('hospitality_core.RatePlan')
      let query = from(Plan).orderBy(asc(Plan.rateType), asc(Plan.name)).preload('roomType')
      if (args.propertyId) query = query.where(eq(Plan.propertyId, args.propertyId))
      if (args.roomTypeId) query = query.where(eq(Plan.roomTypeId, args.roomTypeId))
      if (args.active !== undefined) query = query.where(eq(Plan.active, args.active))
      return ctx.db.all(query)
    },
  }),

  saveRatePlan: defineFn({
    input: {
      id: 'id',
      propertyId: 'id',
      roomTypeId: 'id',
      code: 'text',
      name: 'text',
      rateType: 'text',
      amount: 'decimal',
      isDefault: 'bool?',
      mealPlan: 'text?',
      minStay: 'int?',
      maxStay: 'int?',
      active: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.RatePlan',
      'write:hospitality_core.RatePlan',
      'write:hospitality_core.InventoryChange',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const property = await record(ctx, 'hospitality_core.Property', args.propertyId)
      const roomType = await record(ctx, 'hospitality_core.RoomType', args.roomTypeId)
      const existing = await record(ctx, 'hospitality_core.RatePlan', args.id)
      const code = cleanCode(args.code)
      const name = cleanText(args.name)
      const rateType = String(args.rateType)
      const amount = Number(args.amount)
      const minStay = natural(args.minStay)
      const maxStay = natural(args.maxStay)
      const active = args.active ?? existing?.active ?? true
      const isDefault = args.isDefault ?? existing?.isDefault ?? false
      const mealPlan = cleanText(args.mealPlan) || undefined
      const errors: InventoryIssue[] = []
      if (!property) errors.push(issue('propertyId', 'property_missing'))
      if (!roomType) errors.push(issue('roomTypeId', 'room_type_missing'))
      else if (roomType.propertyId !== args.propertyId) errors.push(issue('roomTypeId', 'property_mismatch'))
      if (!code) errors.push(issue('code', 'required'))
      if (!name) errors.push(issue('name', 'required'))
      if (!oneOf(RATE_TYPES, rateType)) errors.push(issue('rateType', 'rate_type'))
      if (!Number.isFinite(amount) || amount < 0) errors.push(issue('amount', 'non_negative'))
      if (!isNatural(args.minStay)) errors.push(issue('minStay', 'non_negative'))
      if (!isNatural(args.maxStay)) errors.push(issue('maxStay', 'non_negative'))
      if (maxStay > 0 && maxStay < minStay) errors.push(issue('maxStay', 'los_order'))
      if (mealPlan && !oneOf(MEAL_PLANS, mealPlan)) errors.push(issue('mealPlan', 'meal_plan'))
      const Plan = ctx.table('hospitality_core.RatePlan')
      const sameCode = await ctx.db.all(
        from(Plan).where(eq(Plan.roomTypeId, args.roomTypeId), eq(Plan.code, code)),
      )
      if (sameCode.some((row) => row.id !== args.id)) errors.push(issue('code', 'unique'))
      if (active && isDefault) {
        const defaults = await ctx.db.all(
          from(Plan).where(
            eq(Plan.roomTypeId, args.roomTypeId),
            eq(Plan.rateType, rateType),
            eq(Plan.active, true),
            eq(Plan.isDefault, true),
          ),
        )
        if (defaults.some((row) => row.id !== args.id)) errors.push(issue('isDefault', 'default_rate_unique'))
      }
      if (errors.length) return failure(...errors)
      const values = {
        id: args.id,
        propertyId: args.propertyId,
        roomTypeId: args.roomTypeId,
        code,
        name,
        rateType,
        amount: String(args.amount),
        isDefault,
        defaultKey: active && isDefault ? 'active' : undefined,
        mealPlan,
        minStay,
        maxStay,
        active,
      }
      await ctx.tx(async (tx) => {
        if (existing) await tx.db.update('hospitality_core.RatePlan', { id: args.id }, values)
        else await tx.db.insert('hospitality_core.RatePlan', values)
        const today = dateKeyIn(new Date(), String(property!.timezone ?? 'UTC'))
        await recordInventoryChange(tx, {
          propertyId: args.propertyId,
          roomTypeId: args.roomTypeId,
          kind: 'rate',
          dateFrom: today,
          dateTo: addCalendarDays(today, 365),
          aggregateId: args.id,
        })
      })
      return { ok: true, id: String(args.id), errors: [] }
    },
  }),

  listInventory: defineFn({
    input: { propertyId: 'id', roomTypeId: 'id', from: 'date', to: 'date' },
    output: {
      id: 'id',
      propertyId: 'id',
      roomTypeId: 'id',
      date: 'date',
      total: 'int',
      totalManual: 'bool',
      sold: 'int',
      blocked: 'int',
      available: 'int',
      minLos: 'int',
      maxLos: 'int',
      closedToArrival: 'bool',
      closedToDeparture: 'bool',
      stopSell: 'bool',
      persisted: 'bool',
    },
    effects: [
      'read:hospitality_core.RoomType',
      'read:hospitality_core.Room',
      'read:hospitality_core.AvailabilityLedger',
      'read:hospitality_core.Restriction',
    ],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const roomType = await record(ctx, 'hospitality_core.RoomType', args.roomTypeId)
      const range = dateRange(args.from, args.to)
      if (!roomType || roomType.propertyId !== args.propertyId || range.errors.length) return []
      const Ledger = ctx.table('hospitality_core.AvailabilityLedger')
      const Restriction = ctx.table('hospitality_core.Restriction')
      const [total, ledger, restrictions] = await Promise.all([
        physicalTotal(ctx, args.propertyId, args.roomTypeId),
        ctx.db.all(
          from(Ledger)
            .where(
              eq(Ledger.propertyId, args.propertyId),
              eq(Ledger.roomTypeId, args.roomTypeId),
              gte(Ledger.date, args.from),
              lte(Ledger.date, args.to),
            )
            .orderBy(asc(Ledger.date)),
        ),
        ctx.db.all(
          from(Restriction).where(
            eq(Restriction.propertyId, args.propertyId),
            eq(Restriction.roomTypeId, args.roomTypeId),
            gte(Restriction.date, args.from),
            lte(Restriction.date, args.to),
          ),
        ),
      ])
      const ledgerByDate = new Map(ledger.map((row) => [String(row.date), row]))
      const restrictionByDate = new Map(restrictions.map((row) => [String(row.date), row]))
      return range.dates.map((date) => {
        const row = ledgerByDate.get(date)
        const restriction = restrictionByDate.get(date)
        return {
          id: row?.id ?? ledgerId(args.roomTypeId, date),
          propertyId: args.propertyId,
          roomTypeId: args.roomTypeId,
          date,
          total: Number(row?.total ?? total),
          totalManual: row?.totalManual === true,
          sold: Number(row?.sold ?? 0),
          blocked: Number(row?.blocked ?? 0),
          available: Number(row?.available ?? total),
          minLos: Number(restriction?.minLos ?? 0),
          maxLos: Number(restriction?.maxLos ?? 0),
          closedToArrival: restriction?.closedToArrival === true,
          closedToDeparture: restriction?.closedToDeparture === true,
          stopSell: restriction?.stopSell === true,
          persisted: !!row,
        }
      })
    },
  }),

  setInventoryRange: defineFn({
    input: {
      propertyId: 'id',
      roomTypeId: 'id',
      from: 'date',
      to: 'date',
      total: 'int?',
      blocked: 'int?',
      followRooms: 'bool?',
    },
    output: { ok: 'bool', count: 'int?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.Room',
      'read:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.InventoryChange',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const property = await record(ctx, 'hospitality_core.Property', args.propertyId)
      const roomType = await record(ctx, 'hospitality_core.RoomType', args.roomTypeId)
      const range = dateRange(args.from, args.to)
      const errors = [...range.errors]
      if (!property) errors.push(issue('propertyId', 'property_missing'))
      if (!roomType) errors.push(issue('roomTypeId', 'room_type_missing'))
      else if (roomType.propertyId !== args.propertyId) errors.push(issue('roomTypeId', 'property_mismatch'))
      if (args.total === undefined && args.blocked === undefined && args.followRooms !== true)
        errors.push(issue('total', 'inventory_change_required'))
      if (args.total !== undefined && args.followRooms === true)
        errors.push(issue('total', 'inventory_total_conflict'))
      if (args.total !== undefined && !isNatural(args.total)) errors.push(issue('total', 'non_negative'))
      if (args.blocked !== undefined && !isNatural(args.blocked))
        errors.push(issue('blocked', 'non_negative'))
      if (errors.length) return failure(...errors)
      const roomCount = await sellableRooms(ctx, args.propertyId, args.roomTypeId)
      try {
        return await ctx.tx(async (tx) => {
          await ensureLedgerRows(tx, args.propertyId, args.roomTypeId, range.dates)
          for (const date of range.dates)
            await changeLedger(tx, args.propertyId, args.roomTypeId, date, (current) => {
              if (args.followRooms === true) {
                const sold = Number(current.sold)
                const blocked = args.blocked === undefined ? Number(current.blocked) : natural(args.blocked)
                if (sold + blocked > roomCount)
                  return issue('total', 'inventory_capacity', {
                    date,
                    total: roomCount,
                    committed: sold + blocked,
                  })
                return { total: roomCount, sold, blocked, totalManual: false }
              }
              const total = args.total === undefined ? Number(current.total) : natural(args.total)
              const sold = Number(current.sold)
              const blocked = args.blocked === undefined ? Number(current.blocked) : natural(args.blocked)
              if (sold + blocked > total)
                return issue('total', 'inventory_capacity', { date, total, committed: sold + blocked })
              return {
                total,
                sold,
                blocked,
                // Naming a total is an allotment decision; it must survive the
                // next room the property opens or closes.
                ...(args.total === undefined ? {} : { totalManual: true }),
              }
            })
          await recordInventoryChange(tx, {
            propertyId: args.propertyId,
            roomTypeId: args.roomTypeId,
            kind: 'availability',
            dateFrom: String(args.from),
            dateTo: String(args.to),
          })
          return { ok: true, count: range.dates.length, errors: [] }
        })
      } catch (error) {
        if (error instanceof InventoryConflict) return failure(error.problem)
        throw error
      }
    },
  }),

  setRestrictionRange: defineFn({
    input: {
      propertyId: 'id',
      roomTypeId: 'id',
      from: 'date',
      to: 'date',
      minLos: 'int?',
      maxLos: 'int?',
      closedToArrival: 'bool?',
      closedToDeparture: 'bool?',
      stopSell: 'bool?',
    },
    output: { ok: 'bool', count: 'int?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.Restriction',
      'write:hospitality_core.Restriction',
      'write:hospitality_core.InventoryChange',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const property = await record(ctx, 'hospitality_core.Property', args.propertyId)
      const roomType = await record(ctx, 'hospitality_core.RoomType', args.roomTypeId)
      const range = dateRange(args.from, args.to)
      const minLos = natural(args.minLos)
      const maxLos = natural(args.maxLos)
      const errors = [...range.errors]
      if (!property) errors.push(issue('propertyId', 'property_missing'))
      if (!roomType) errors.push(issue('roomTypeId', 'room_type_missing'))
      else if (roomType.propertyId !== args.propertyId) errors.push(issue('roomTypeId', 'property_mismatch'))
      if (!isNatural(args.minLos)) errors.push(issue('minLos', 'non_negative'))
      if (!isNatural(args.maxLos)) errors.push(issue('maxLos', 'non_negative'))
      if (maxLos > 0 && maxLos < minLos) errors.push(issue('maxLos', 'los_order'))
      if (errors.length) return failure(...errors)
      try {
        return await ctx.tx(async (tx) => {
          for (const date of range.dates) {
            const id = restrictionId(args.roomTypeId, date)
            const values = {
              id,
              propertyId: args.propertyId,
              roomTypeId: args.roomTypeId,
              date,
              minLos,
              maxLos,
              closedToArrival: args.closedToArrival ?? false,
              closedToDeparture: args.closedToDeparture ?? false,
              stopSell: args.stopSell ?? false,
              version: 0,
            }
            const inserted = await tx.db.insertIfAbsent('hospitality_core.Restriction', values)
            if ('inserted' in inserted && inserted.inserted) continue
            let saved = false
            for (let attempt = 0; attempt < 5; attempt++) {
              const current = await record(tx, 'hospitality_core.Restriction', id)
              if (!current) continue
              const version = Number(current.version)
              const changed = await tx.db.compareAndSet(
                'hospitality_core.Restriction',
                { id },
                { version },
                { ...values, version: version + 1 },
              )
              if ('matched' in changed && changed.matched) {
                saved = true
                break
              }
            }
            if (!saved) throw new InventoryConflict(issue('roomTypeId', 'transition_conflict'))
          }
          await recordInventoryChange(tx, {
            propertyId: args.propertyId,
            roomTypeId: args.roomTypeId,
            kind: 'restriction',
            dateFrom: String(args.from),
            dateTo: String(args.to),
          })
          return { ok: true, count: range.dates.length, errors: [] }
        })
      } catch (error) {
        if (error instanceof InventoryConflict) return failure(error.problem)
        throw error
      }
    },
  }),

  listInventoryChanges: defineFn({
    input: { propertyId: 'id', afterAt: 'datetime?', afterId: 'id?', limit: 'int?' },
    output: {
      id: 'id',
      propertyId: 'id',
      roomTypeId: 'id',
      kind: 'text',
      dateFrom: 'date',
      dateTo: 'date',
      aggregateId: 'text?',
      createdAt: 'datetime',
    },
    effects: ['read:hospitality_core.InventoryChange'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const Change = ctx.table('hospitality_core.InventoryChange')
      let query = from(Change)
        .where(eq(Change.propertyId, args.propertyId))
        .orderBy(asc(Change.createdAt), asc(Change.id))
      if (args.afterAt && args.afterId)
        query = query.where(
          or(
            gt(Change.createdAt, args.afterAt),
            and(eq(Change.createdAt, args.afterAt), gt(Change.id, args.afterId)),
          ),
        )
      else if (args.afterAt) query = query.where(gt(Change.createdAt, args.afterAt))
      return ctx.db.all(query.limit(Math.max(1, Math.min(500, Number(args.limit ?? 100)))))
    },
  }),
}
