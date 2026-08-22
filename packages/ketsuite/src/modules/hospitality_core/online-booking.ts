import { asc, defineFn, eq, from, gte, inArray, lte, localDateTimeToUtc } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { addCalendarDays, dateKeyIn } from './calendar.ts'
import { cancellationTerms } from './operations.ts'
import {
  defaultRatePlan,
  InventoryConflict,
  occupancyDates,
  quoteAvailability as readAvailability,
  recordInventoryChange,
  releaseInventory,
  reserveInventory,
} from './inventory.ts'

const MAX_BOOKING_HORIZON_DAYS = 366
const MAX_STAY_NIGHTS = 90
const MAX_ROOM_QUANTITY = 10

type OnlineIssue = {
  field: string
  code: string
  messageKey: string
  params?: Record<string, unknown>
}

type QuoteItem = {
  roomTypeId: string
  ratePlanId: string | null
  availableQuantity: number
  requestedQuantity: number
  unitRate: string
  amountTotal: string
  currency: string
  restrictions: {
    minStay: number | null
    maxStay: number | null
    closedToArrival: boolean
    closedToDeparture: boolean
    stopSell: boolean
  }
}

type QuotePlan = {
  property: Row
  checkIn: string
  checkOut: string
  checkInAt: string
  checkOutAt: string
  nights: number
  quantity: number
  adults: number
  children: number
  infants: number
  items: QuoteItem[]
  errors: OnlineIssue[]
}

const problem = (field: string, code: string, params?: Record<string, unknown>): OnlineIssue => ({
  field,
  code,
  messageKey: `hospitality_core.error.${code}`,
  ...(params ? { params } : {}),
})

const failure = (...errors: OnlineIssue[]) => ({ ok: false, errors })

const record = async (ctx: Ctx, model: string, id: unknown): Promise<Row | null> => {
  const table = ctx.table(model)
  return ctx.db.one(from(table).where(eq(table.id, id)))
}

const dateKey = (value: unknown): string | null => {
  const key = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null
  const parsed = new Date(`${key}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === key ? key : null
}

const calendarDays = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000)

const positiveInt = (value: unknown, fallback: number): number => (value == null ? fallback : Number(value))

const clock = (value: unknown, fallback: string): string =>
  /^\d{2}:\d{2}$/.test(String(value ?? '')) ? String(value) : fallback

const money = (value: number): string => {
  if (!Number.isFinite(value)) return '0'
  return String(Math.round((value + Number.EPSILON) * 100) / 100)
}

const restrictionSummary = async (
  ctx: Ctx,
  propertyId: unknown,
  roomTypeId: unknown,
  dates: readonly string[],
  checkout: string,
): Promise<QuoteItem['restrictions']> => {
  if (!dates.length)
    return {
      minStay: null,
      maxStay: null,
      closedToArrival: false,
      closedToDeparture: false,
      stopSell: false,
    }
  const Restriction = ctx.table('hospitality_core.Restriction')
  const rows = await ctx.db.all(
    from(Restriction).where(
      eq(Restriction.propertyId, propertyId),
      eq(Restriction.roomTypeId, roomTypeId),
      gte(Restriction.date, dates[0]),
      lte(Restriction.date, checkout),
    ),
  )
  const byDate = new Map(rows.map((row) => [String(row.date), row]))
  const minStay = Math.max(0, ...dates.map((date) => Number(byDate.get(date)?.minLos ?? 0)))
  const positiveMaximums = dates
    .map((date) => Number(byDate.get(date)?.maxLos ?? 0))
    .filter((value) => value > 0)
  return {
    minStay: minStay || null,
    maxStay: positiveMaximums.length ? Math.min(...positiveMaximums) : null,
    closedToArrival: byDate.get(dates[0]!)?.closedToArrival === true,
    closedToDeparture: byDate.get(checkout)?.closedToDeparture === true,
    stopSell: dates.some((date) => byDate.get(date)?.stopSell === true),
  }
}

const restrictionProblems = (restrictions: QuoteItem['restrictions'], nights: number): OnlineIssue[] => {
  const errors: OnlineIssue[] = []
  if (restrictions.stopSell) errors.push(problem('checkIn', 'stopSell'))
  if (restrictions.closedToArrival) errors.push(problem('checkIn', 'closedToArrival'))
  if (restrictions.closedToDeparture) errors.push(problem('checkOut', 'closedToDeparture'))
  if (restrictions.minStay && nights < restrictions.minStay)
    errors.push(problem('checkOut', 'minimumStay', { required: restrictions.minStay, actual: nights }))
  if (restrictions.maxStay && nights > restrictions.maxStay)
    errors.push(problem('checkOut', 'maximumStay', { maximum: restrictions.maxStay, actual: nights }))
  return errors
}

const capacityProblems = (
  roomType: Row,
  quantity: number,
  adults: number,
  children: number,
  infants: number,
): OnlineIssue[] => {
  const exceeded =
    adults > Number(roomType.maxAdults ?? roomType.defaultCapacity ?? 1) * quantity ||
    children > Number(roomType.maxChildren ?? 0) * quantity ||
    infants > Number(roomType.maxInfants ?? 0) * quantity ||
    adults + children > Number(roomType.defaultCapacity ?? 1) * quantity
  return exceeded
    ? [
        problem('adults', 'capacityExceeded', {
          adults,
          children,
          infants,
          quantity,
        }),
      ]
    : []
}

const rateFor = async (
  ctx: Ctx,
  propertyId: unknown,
  roomType: Row,
  requestedRatePlanId: unknown,
): Promise<{ ratePlan: Row | null; rate: number; errors: OnlineIssue[] }> => {
  let ratePlan: Row | null = null
  if (requestedRatePlanId) {
    ratePlan = await record(ctx, 'hospitality_core.RatePlan', requestedRatePlanId)
    if (
      ratePlan?.active !== true ||
      ratePlan.propertyId !== propertyId ||
      ratePlan.roomTypeId !== roomType.id ||
      ratePlan.rateType !== 'nightly'
    )
      return { ratePlan: null, rate: 0, errors: [problem('ratePlanId', 'ratePlanUnavailable')] }
  } else {
    ratePlan = await defaultRatePlan(ctx, roomType.id, 'nightly')
  }
  const rate = Number(ratePlan?.amount ?? roomType.baseRate ?? 0)
  if (!Number.isFinite(rate) || rate < 0)
    return { ratePlan, rate: 0, errors: [problem('ratePlanId', 'ratePlanUnavailable')] }
  return { ratePlan, rate, errors: [] }
}

const planQuote = async (ctx: Ctx, args: Record<string, unknown>): Promise<QuotePlan | OnlineIssue[]> => {
  const property = await record(ctx, 'hospitality_core.Property', args.propertyId)
  if (property?.active !== true) return [problem('propertyId', 'propertyNotFound')]
  if (args.ratePlanId && !args.roomTypeId) return [problem('ratePlanId', 'ratePlanUnavailable')]

  const checkIn = dateKey(args.checkIn)
  const checkOut = dateKey(args.checkOut)
  if (!checkIn || !checkOut || checkOut <= checkIn)
    return [problem(!checkIn ? 'checkIn' : 'checkOut', 'invalidStayDates')]
  const timezone = String(property.timezone ?? 'UTC')
  const today = dateKeyIn(new Date(), timezone)
  const nights = calendarDays(checkIn, checkOut)
  if (checkIn < today) return [problem('checkIn', 'pastStayDate')]
  if (checkIn > addCalendarDays(today, MAX_BOOKING_HORIZON_DAYS))
    return [problem('checkIn', 'bookingHorizonExceeded', { days: MAX_BOOKING_HORIZON_DAYS })]
  if (nights > MAX_STAY_NIGHTS)
    return [problem('checkOut', 'stayLengthExceeded', { nights: MAX_STAY_NIGHTS })]

  const quantity = positiveInt(args.quantity, 1)
  const adults = positiveInt(args.adults, 1)
  const children = positiveInt(args.children, 0)
  const infants = positiveInt(args.infants, 0)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ROOM_QUANTITY)
    return [problem('quantity', 'invalidQuantity', { maximum: MAX_ROOM_QUANTITY })]
  if (
    !Number.isInteger(adults) ||
    adults < 1 ||
    !Number.isInteger(children) ||
    children < 0 ||
    !Number.isInteger(infants) ||
    infants < 0
  )
    return [problem('adults', 'invalidGuestCount')]

  let checkInAt: string
  let checkOutAt: string
  try {
    checkInAt = localDateTimeToUtc(`${checkIn}T${clock(property.defaultCheckIn, '14:00')}`, timezone)
    checkOutAt = localDateTimeToUtc(`${checkOut}T${clock(property.defaultCheckOut, '12:00')}`, timezone)
  } catch {
    return [problem('checkIn', 'invalidStayDates')]
  }
  const dates = occupancyDates(checkInAt, checkOutAt, timezone)
  const Company = ctx.table('company.Company')
  const company = property.companyId
    ? await ctx.db.one(from(Company).where(eq(Company.id, property.companyId)))
    : null
  const currency = String(company?.currency ?? 'VND')

  const RoomType = ctx.table('hospitality_core.RoomType')
  let roomTypes: Row[]
  if (args.roomTypeId) {
    const roomType = await record(ctx, 'hospitality_core.RoomType', args.roomTypeId)
    if (!roomType) return [problem('roomTypeId', 'roomTypeNotFound')]
    if (roomType.propertyId !== property.id) return [problem('roomTypeId', 'propertyMismatch')]
    if (roomType.active !== true || roomType.published !== true)
      return [problem('roomTypeId', 'roomTypeNotFound')]
    roomTypes = [roomType]
  } else {
    roomTypes = await ctx.db.all(
      from(RoomType)
        .where(eq(RoomType.propertyId, property.id), eq(RoomType.active, true), eq(RoomType.published, true))
        .orderBy(asc(RoomType.name), asc(RoomType.id)),
    )
  }

  const items: QuoteItem[] = []
  const errors: OnlineIssue[] = []
  for (const roomType of roomTypes) {
    const capacityErrors = capacityProblems(roomType, quantity, adults, children, infants)
    const priced = await rateFor(ctx, property.id, roomType, args.ratePlanId)
    const restrictions = await restrictionSummary(ctx, property.id, roomType.id, dates, checkOut)
    const availability = await readAvailability(ctx, property.id, roomType.id, dates, quantity)
    const itemErrors = [
      ...capacityErrors,
      ...priced.errors,
      ...restrictionProblems(restrictions, nights),
      ...(priced.ratePlan && Number(priced.ratePlan.minStay) > 0 && nights < Number(priced.ratePlan.minStay)
        ? [
            problem('checkOut', 'minimumStay', {
              required: Number(priced.ratePlan.minStay),
              actual: nights,
            }),
          ]
        : []),
      ...(priced.ratePlan && Number(priced.ratePlan.maxStay) > 0 && nights > Number(priced.ratePlan.maxStay)
        ? [
            problem('checkOut', 'maximumStay', {
              maximum: Number(priced.ratePlan.maxStay),
              actual: nights,
            }),
          ]
        : []),
      ...(availability.errors.length
        ? [
            problem('roomTypeId', 'inventoryUnavailable', {
              available: availability.minimumAvailable,
              required: quantity,
            }),
          ]
        : []),
    ]
    if (args.roomTypeId && itemErrors.length) errors.push(...itemErrors)
    if (!args.roomTypeId && itemErrors.length) continue
    items.push({
      roomTypeId: String(roomType.id),
      ratePlanId: priced.ratePlan ? String(priced.ratePlan.id) : null,
      availableQuantity: availability.minimumAvailable,
      requestedQuantity: quantity,
      unitRate: money(priced.rate),
      amountTotal: money(priced.rate * nights * quantity),
      currency,
      restrictions,
    })
  }
  return {
    property,
    checkIn,
    checkOut,
    checkInAt,
    checkOutAt,
    nights,
    quantity,
    adults,
    children,
    infants,
    items,
    errors,
  }
}

/**
 * A checkout for N rooms is N reservations. Unit zero keeps the caller's own id,
 * request key and code, so a single-room booking — which is nearly all of them —
 * produces exactly the records and identifiers it always did.
 */
const unitSuffix = (index: number): string => (index === 0 ? '' : `#${index + 1}`)
const unitReservationId = (id: unknown, index: number): string => `${String(id)}${unitSuffix(index)}`
const unitCode = (base: string, index: number): string =>
  index === 0 ? base : `${base}-${String(index + 1)}`
const unitRequestKey = (key: string, index: number): string => `${key}${unitSuffix(index)}`

const onlineReservationOutput = (group: Row[], existing: boolean) => {
  const first = group[0]!
  return {
    ok: true,
    id: String(first.id),
    companyId: String(first.companyId),
    propertyId: String(first.propertyId),
    roomTypeId: String(first.roomTypeId),
    folioId: String(first.folioId),
    stayId: first.stayId == null ? null : String(first.stayId),
    code: String(first.code),
    state: String(first.state),
    rate: String(first.rate),
    quantity: group.length,
    amountTotal: money(group.reduce((total, row) => total + Number(row.amountTotal ?? 0), 0)),
    currency: String(first.currency ?? 'VND'),
    // One row per room, so the desk has something to assign each guest to.
    units: group.map((row) => ({
      reservationId: String(row.id),
      stayId: row.stayId == null ? null : String(row.stayId),
      code: String(row.code),
      amountTotal: String(row.amountTotal),
    })),
    existing,
    errors: [],
  }
}

const sameOnlineRequest = (group: Row[], args: Record<string, unknown>): boolean => {
  const row = group[0]
  return (
    !!row &&
    row.provider === 'website' &&
    row.propertyId === args.propertyId &&
    row.roomTypeId === args.roomTypeId &&
    row.partnerId === args.partnerId &&
    (args.ratePlanId == null || row.ratePlanId === args.ratePlanId) &&
    String(row.checkIn).slice(0, 10) === String(args.checkIn) &&
    String(row.checkOut).slice(0, 10) === String(args.checkOut) &&
    Number(row.adults) === Number(args.adults ?? 1) &&
    Number(row.children) === Number(args.children ?? 0) &&
    Number(row.infants ?? 0) === Number(args.infants ?? 0) &&
    group.length === Number(args.quantity ?? 1)
  )
}

const orderedGroup = (rows: Row[]): Row[] =>
  [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id)))

/** Every reservation belonging to one checkout, oldest identifier first. */
export const reservationGroup = async (ctx: Ctx, row: Row): Promise<Row[]> => {
  if (!row.groupKey) return [row]
  const Reservation = ctx.table('hospitality_core.Reservation')
  const rows = await ctx.db.all(
    from(Reservation).where(eq(Reservation.provider, row.provider), eq(Reservation.groupKey, row.groupKey)),
  )
  return rows.length ? orderedGroup(rows) : [row]
}

const existingOnlineGroup = async (ctx: Ctx, args: Record<string, unknown>): Promise<Row[]> => {
  const Reservation = ctx.table('hospitality_core.Reservation')
  const byGroup = await ctx.db.all(
    from(Reservation).where(eq(Reservation.provider, 'website'), eq(Reservation.groupKey, String(args.id))),
  )
  if (byGroup.length) return orderedGroup(byGroup)
  const byId = await ctx.db.one(from(Reservation).where(eq(Reservation.id, args.id)))
  if (byId) return reservationGroup(ctx, byId)
  const byKey = await ctx.db.one(
    from(Reservation).where(eq(Reservation.provider, 'website'), eq(Reservation.requestKey, args.requestKey)),
  )
  return byKey ? reservationGroup(ctx, byKey) : []
}

const customerProjection = async (ctx: Ctx, row: Row, at = new Date(), group?: Row[]): Promise<Row> => {
  // The terms the guest booked under, not whatever the policy says today.
  const terms = row.cancellationPolicyType
    ? row
    : await cancellationTerms(ctx, row.propertyId, row.roomTypeId)
  const beforeCheckIn = at.getTime() < new Date(String(row.checkIn)).getTime()
  const cutoff =
    new Date(String(row.checkIn)).getTime() - Number(terms.freeCancellationHours ?? 0) * 3_600_000
  const cancellationAllowed =
    row.state === 'confirmed' &&
    beforeCheckIn &&
    terms.cancellationPolicyType !== 'non_refundable' &&
    at.getTime() <= cutoff
  // A three-room checkout is three reservations but one thing the guest bought,
  // so the customer view reports the purchase, not its units.
  const rooms = group ?? (await reservationGroup(ctx, row))
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    propertyId: row.propertyId,
    roomTypeId: row.roomTypeId,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    adults: row.adults,
    children: row.children,
    rooms: rooms.length,
    amountTotal: money(rooms.reduce((total, unit) => total + Number(unit.amountTotal ?? 0), 0)),
    currency: row.currency ?? 'VND',
    state: row.state,
    cancellationAllowed,
  }
}

const quoteEffects = [
  'read:company.Company',
  'read:hospitality_core.Property',
  'read:hospitality_core.RoomType',
  'read:hospitality_core.Room',
  'read:hospitality_core.RatePlan',
  'read:hospitality_core.Restriction',
  'read:hospitality_core.AvailabilityLedger',
]

const bookingEffects = [
  ...quoteEffects,
  'read:partner.Partner',
  // The cancellation terms are snapshotted onto the reservation at creation.
  'read:hospitality_core.CancellationPolicy',
  'read:hospitality_core.Reservation',
  'write:hospitality_core.Folio',
  'write:hospitality_core.Reservation',
  'write:hospitality_core.Stay',
  'write:hospitality_core.StayGuest',
  'write:hospitality_core.Charge',
  'write:hospitality_core.AvailabilityLedger',
  'write:hospitality_core.InventoryChange',
]

const customerReadEffects = [
  'read:hospitality_core.Reservation',
  'read:hospitality_core.Property',
  'read:hospitality_core.RoomType',
  'read:hospitality_core.CancellationPolicy',
]

export const onlineBooking: Record<string, FnSpec> = {
  quoteAvailability: defineFn({
    exposure: 'internal',
    input: {
      propertyId: 'id',
      roomTypeId: 'id?',
      checkIn: 'date',
      checkOut: 'date',
      adults: 'int',
      children: 'int?',
      infants: 'int?',
      quantity: 'int?',
      ratePlanId: 'id?',
    },
    output: {
      ok: 'bool',
      propertyId: 'id?',
      companyId: 'id?',
      checkIn: 'date?',
      checkOut: 'date?',
      nights: 'int?',
      items: 'json?',
      errors: 'json?',
    },
    effects: quoteEffects,
    handler: async (ctx: Ctx, args) => {
      const planned = await planQuote(ctx, args)
      if (Array.isArray(planned)) return failure(...planned)
      if (planned.errors.length) return failure(...planned.errors)
      return {
        ok: true,
        propertyId: String(planned.property.id),
        companyId: String(planned.property.companyId),
        checkIn: planned.checkIn,
        checkOut: planned.checkOut,
        nights: planned.nights,
        items: planned.items,
        errors: [],
      }
    },
  }),

  createOnlineReservation: defineFn({
    exposure: 'internal',
    input: {
      id: 'id',
      requestKey: 'text',
      propertyId: 'id',
      roomTypeId: 'id',
      ratePlanId: 'id?',
      partnerId: 'id',
      checkIn: 'date',
      checkOut: 'date',
      adults: 'int',
      children: 'int?',
      infants: 'int?',
      quantity: 'int?',
      channelRef: 'text?',
      createdAt: 'datetime?',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      companyId: 'id?',
      propertyId: 'id?',
      roomTypeId: 'id?',
      folioId: 'id?',
      stayId: 'id?',
      code: 'text?',
      state: 'text?',
      rate: 'decimal?',
      quantity: 'decimal?',
      amountTotal: 'decimal?',
      currency: 'text?',
      units: 'json?',
      existing: 'bool?',
      errors: 'json?',
    },
    effects: bookingEffects,
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const requestKey = String(args.requestKey ?? '').trim()
      if (!requestKey) return failure(problem('requestKey', 'requestConflict'))
      const normalized = { ...args, requestKey }
      const existing = await existingOnlineGroup(ctx, normalized)
      if (existing.length)
        return sameOnlineRequest(existing, normalized)
          ? onlineReservationOutput(existing, true)
          : failure(problem('requestKey', 'requestConflict'))

      const partner = await record(ctx, 'partner.Partner', args.partnerId)
      if (!partner) return failure(problem('partnerId', 'partnerNotFound'))
      const planned = await planQuote(ctx, normalized)
      if (Array.isArray(planned)) return failure(...planned)
      if (planned.errors.length || planned.items.length !== 1) return failure(...planned.errors)
      const item = planned.items[0]!
      const now = args.createdAt ? new Date(String(args.createdAt)) : new Date()
      const createdAt = Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString()
      const terms = await cancellationTerms(ctx, args.propertyId, args.roomTypeId)
      const groupKey = String(args.id)
      const baseCode = `WEB-${groupKey.toUpperCase()}`
      const folioId = `${groupKey}:folio`
      // Each room carries its own nights; the folio carries what was bought.
      const unitAmount = money(Number(item.unitRate) * planned.nights)
      const inventoryDates = occupancyDates(
        planned.checkInAt,
        planned.checkOutAt,
        String(planned.property.timezone),
      )
      try {
        return await ctx.tx(async (tx) => {
          const raced = await existingOnlineGroup(tx, normalized)
          if (raced.length)
            return sameOnlineRequest(raced, normalized)
              ? onlineReservationOutput(raced, true)
              : failure(problem('requestKey', 'requestConflict'))
          await reserveInventory(tx, args.propertyId, args.roomTypeId, inventoryDates, planned.quantity)
          await recordInventoryChange(tx, {
            propertyId: args.propertyId,
            roomTypeId: args.roomTypeId,
            kind: 'availability',
            dateFrom: inventoryDates[0]!,
            dateTo: inventoryDates.at(-1)!,
            aggregateId: args.id,
          })
          await tx.db.insert('hospitality_core.Folio', {
            id: folioId,
            code: `F-${baseCode}`,
            propertyId: args.propertyId,
            partnerId: args.partnerId,
            state: 'open',
            amountTotal: item.amountTotal,
            version: 0,
            openedAt: createdAt,
          })
          const written: Row[] = []
          for (let index = 0; index < planned.quantity; index++) {
            const reservationId = unitReservationId(groupKey, index)
            const code = unitCode(baseCode, index)
            const stayId = `${reservationId}:stay`
            const values = {
              id: reservationId,
              code,
              propertyId: args.propertyId,
              roomTypeId: args.roomTypeId,
              ratePlanId: item.ratePlanId ?? undefined,
              folioId,
              stayId,
              partnerId: args.partnerId,
              ...terms,
              provider: 'website',
              requestKey: unitRequestKey(requestKey, index),
              groupKey,
              channelRef: args.channelRef,
              bookingType: 'nightly',
              checkIn: planned.checkInAt,
              checkOut: planned.checkOutAt,
              adults: planned.adults,
              children: planned.children,
              infants: planned.infants,
              roomQuantity: 1,
              rate: item.unitRate,
              quantity: String(planned.nights),
              billingMode: 'upfront',
              amountTotal: unitAmount,
              currency: item.currency,
              state: 'confirmed',
              createdAt,
              updatedAt: createdAt,
            }
            await tx.db.insert('hospitality_core.Reservation', values)
            await tx.db.insert('hospitality_core.Stay', {
              id: stayId,
              code: `S-${code}`,
              folioId,
              reservationId,
              partnerId: args.partnerId,
              propertyId: args.propertyId,
              roomTypeId: args.roomTypeId,
              bookingType: 'nightly',
              checkIn: planned.checkInAt,
              checkOut: planned.checkOutAt,
              adults: planned.adults,
              children: planned.children,
              infants: planned.infants,
              roomQuantity: 1,
              billingMode: 'upfront',
              rate: item.unitRate,
              state: 'draft',
            })
            await tx.db.insert('hospitality_core.StayGuest', {
              id: `${reservationId}:guest`,
              stayId,
              propertyId: args.propertyId,
              partnerId: args.partnerId,
              displayName: partner.name,
              primary: true,
              primaryKey: 'primary',
            })
            await tx.db.insert('hospitality_core.Charge', {
              id: `${reservationId}:room`,
              folioId,
              stayId,
              description: `room:${String(args.roomTypeId)}`,
              type: 'room',
              quantity: String(planned.nights),
              unitPrice: item.unitRate,
              amount: unitAmount,
              occurredAt: createdAt,
              sourceKey: `reservation:${reservationId}:room`,
              state: 'active',
            })
            written.push({ ...values, companyId: planned.property.companyId })
          }
          return onlineReservationOutput(written, false)
        })
      } catch (error) {
        if (error instanceof InventoryConflict)
          return failure(problem('roomTypeId', 'inventoryUnavailable', error.problem.params))
        if (/unique|duplicate/i.test(String((error as Error)?.message ?? error))) {
          const raced = await existingOnlineGroup(ctx, normalized)
          if (raced.length && sameOnlineRequest(raced, normalized))
            return onlineReservationOutput(raced, true)
          return failure(problem('requestKey', 'requestConflict'))
        }
        throw error
      }
    },
  }),

  listPartnerReservations: defineFn({
    exposure: 'internal',
    input: {
      partnerId: 'id',
      propertyIds: 'json?',
      state: 'text?',
      from: 'datetime?',
      to: 'datetime?',
      limit: 'int?',
      offset: 'int?',
    },
    output: {
      id: 'id',
      companyId: 'id',
      code: 'text',
      propertyId: 'id',
      roomTypeId: 'id',
      checkIn: 'datetime',
      checkOut: 'datetime',
      adults: 'int',
      children: 'int',
      rooms: 'int',
      amountTotal: 'decimal',
      currency: 'text',
      state: 'text',
      cancellationAllowed: 'bool',
    },
    effects: customerReadEffects,
    handler: async (ctx: Ctx, args) => {
      const Reservation = ctx.table('hospitality_core.Reservation')
      let query = from(Reservation)
        .where(eq(Reservation.partnerId, args.partnerId))
        .orderBy(asc(Reservation.checkIn))
      const propertyIds = Array.isArray(args.propertyIds) ? [...new Set(args.propertyIds.map(String))] : null
      if (propertyIds?.length === 0) return []
      if (propertyIds?.length) query = query.where(inArray(Reservation.propertyId, propertyIds))
      if (args.state) query = query.where(eq(Reservation.state, args.state))
      const fromAt = args.from ? new Date(String(args.from)).getTime() : null
      const toAt = args.to ? new Date(String(args.to)).getTime() : null
      const rows = (await ctx.db.all(query)).filter(
        (row) =>
          (fromAt == null || new Date(String(row.checkOut)).getTime() > fromAt) &&
          (toAt == null || new Date(String(row.checkIn)).getTime() < toAt),
      )
      // Group siblings are one purchase to the guest, so only the unit that
      // carries the group identity is listed, with the whole group behind it.
      const groups = new Map<string, Row[]>()
      const purchases: Row[] = []
      for (const row of rows) {
        if (!row.groupKey) {
          purchases.push(row)
          continue
        }
        const key = `${String(row.provider)}\u0000${String(row.groupKey)}`
        const seen = groups.get(key)
        if (seen) {
          seen.push(row)
          continue
        }
        groups.set(key, [row])
        purchases.push(row)
      }
      const offset = Math.max(0, Number(args.offset ?? 0))
      const limit = Math.min(200, Math.max(1, Number(args.limit ?? 50)))
      return Promise.all(
        purchases.slice(offset, offset + limit).map((row) => {
          const key = `${String(row.provider)}\u0000${String(row.groupKey)}`
          return customerProjection(ctx, row, new Date(), row.groupKey ? groups.get(key) : [row])
        }),
      )
    },
  }),

  getPartnerReservation: defineFn({
    exposure: 'internal',
    input: { id: 'id', partnerId: 'id' },
    output: { ok: 'bool', reservation: 'json?', errors: 'json?' },
    effects: customerReadEffects,
    handler: async (ctx: Ctx, args) => {
      const Reservation = ctx.table('hospitality_core.Reservation')
      const row = await ctx.db.one(
        from(Reservation).where(eq(Reservation.id, args.id), eq(Reservation.partnerId, args.partnerId)),
      )
      return row
        ? { ok: true, reservation: await customerProjection(ctx, row), errors: [] }
        : failure(problem('id', 'reservationNotOwned'))
    },
  }),

  cancelPartnerReservation: defineFn({
    exposure: 'internal',
    input: { id: 'id', partnerId: 'id', reason: 'text?', at: 'datetime?' },
    output: { ok: 'bool', id: 'id?', state: 'text?', rooms: 'int?', existing: 'bool?', errors: 'json?' },
    effects: [
      ...customerReadEffects,
      'read:hospitality_core.Charge',
      'read:hospitality_core.Folio',
      'read:hospitality_core.Room',
      'read:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.Reservation',
      'write:hospitality_core.Stay',
      'write:hospitality_core.Folio',
      'write:hospitality_core.Charge',
      'write:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.InventoryChange',
    ],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const Reservation = ctx.table('hospitality_core.Reservation')
      const reservation = await ctx.db.one(
        from(Reservation).where(eq(Reservation.id, args.id), eq(Reservation.partnerId, args.partnerId)),
      )
      if (!reservation) return failure(problem('id', 'reservationNotOwned'))
      if (reservation.state === 'cancelled')
        return { ok: true, id: String(reservation.id), state: 'cancelled', existing: true, errors: [] }
      const at = args.at ? new Date(String(args.at)) : new Date()
      if (!Number.isFinite(at.getTime())) return failure(problem('state', 'cancellationNotAllowed'))
      const projected = await customerProjection(ctx, reservation, at)
      if (projected.cancellationAllowed !== true) return failure(problem('state', 'cancellationNotAllowed'))
      const property = await record(ctx, 'hospitality_core.Property', reservation.propertyId)
      const dates = occupancyDates(
        reservation.checkIn,
        reservation.checkOut,
        String(property?.timezone ?? 'UTC'),
      )
      // "Cancel my booking" means the whole purchase. Cancelling one room of a
      // three-room checkout would leave a folio the guest never agreed to.
      const group = await reservationGroup(ctx, reservation)
      const open = group.filter((unit) => unit.state !== 'cancelled')
      try {
        return await ctx.tx(async (tx) => {
          for (const unit of open) {
            const claimed = await tx.db.compareAndSet(
              'hospitality_core.Reservation',
              { id: unit.id },
              { state: 'confirmed', updatedAt: unit.updatedAt },
              {
                state: 'cancelled',
                cancelReason: String(args.reason ?? '').trim() || 'customer',
                updatedAt: at.toISOString(),
              },
            )
            if (!('matched' in claimed) || !claimed.matched) {
              const current = await record(tx, 'hospitality_core.Reservation', unit.id)
              if (current?.state === 'cancelled') continue
              return failure(problem('state', 'requestConflict'))
            }
            if (unit.stayId)
              await tx.db.compareAndSet(
                'hospitality_core.Stay',
                { id: unit.stayId },
                { state: 'draft' },
                { state: 'cancelled' },
              )
          }
          const folio = await record(tx, 'hospitality_core.Folio', reservation.folioId)
          await tx.db.update(
            'hospitality_core.Folio',
            { id: reservation.folioId },
            {
              state: 'cancelled',
              amountTotal: '0',
              closedAt: at.toISOString(),
              version: Number(folio?.version ?? 0) + 1,
            },
          )
          const Charge = tx.table('hospitality_core.Charge')
          const charges = await tx.db.all(
            from(Charge).where(eq(Charge.folioId, reservation.folioId), eq(Charge.state, 'active')),
          )
          for (const charge of charges)
            await tx.db.update('hospitality_core.Charge', { id: charge.id }, { state: 'void' })
          const released = open.reduce((total, unit) => total + Number(unit.roomQuantity ?? 1), 0)
          if (released)
            await releaseInventory(tx, reservation.propertyId, reservation.roomTypeId, dates, released)
          if (dates.length && released)
            await recordInventoryChange(tx, {
              propertyId: reservation.propertyId,
              roomTypeId: reservation.roomTypeId,
              kind: 'availability',
              dateFrom: dates[0]!,
              dateTo: dates.at(-1)!,
              aggregateId: reservation.id,
            })
          return {
            ok: true,
            id: String(reservation.id),
            state: 'cancelled',
            rooms: group.length,
            existing: false,
            errors: [],
          }
        })
      } catch (error) {
        if (error instanceof InventoryConflict) return failure(problem('state', 'requestConflict'))
        throw error
      }
    },
  }),
}
