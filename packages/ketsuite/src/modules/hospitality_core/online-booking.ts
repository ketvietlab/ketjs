import { asc, defineFn, eq, from, gte, inArray, lte, localDateTimeToUtc } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { addCalendarDays, dateKeyIn } from './calendar.ts'
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

const onlineReservationOutput = (row: Row, existing: boolean) => ({
  ok: true,
  id: String(row.id),
  companyId: String(row.companyId),
  propertyId: String(row.propertyId),
  roomTypeId: String(row.roomTypeId),
  folioId: String(row.folioId),
  stayId: row.stayId == null ? null : String(row.stayId),
  code: String(row.code),
  state: String(row.state),
  rate: String(row.rate),
  quantity: Number(row.roomQuantity ?? 1),
  amountTotal: String(row.amountTotal),
  currency: String(row.currency ?? 'VND'),
  existing,
  errors: [],
})

const sameOnlineRequest = (row: Row, args: Record<string, unknown>): boolean =>
  row.provider === 'website' &&
  row.requestKey === args.requestKey &&
  row.propertyId === args.propertyId &&
  row.roomTypeId === args.roomTypeId &&
  row.partnerId === args.partnerId &&
  (args.ratePlanId == null || row.ratePlanId === args.ratePlanId) &&
  String(row.checkIn).slice(0, 10) === String(args.checkIn) &&
  String(row.checkOut).slice(0, 10) === String(args.checkOut) &&
  Number(row.adults) === Number(args.adults ?? 1) &&
  Number(row.children) === Number(args.children ?? 0) &&
  Number(row.infants ?? 0) === Number(args.infants ?? 0) &&
  Number(row.roomQuantity ?? 1) === Number(args.quantity ?? 1)

const existingOnlineReservation = async (ctx: Ctx, args: Record<string, unknown>): Promise<Row | null> => {
  const Reservation = ctx.table('hospitality_core.Reservation')
  const byId = await ctx.db.one(from(Reservation).where(eq(Reservation.id, args.id)))
  if (byId) return byId
  return ctx.db.one(
    from(Reservation).where(eq(Reservation.provider, 'website'), eq(Reservation.requestKey, args.requestKey)),
  )
}

const customerProjection = async (ctx: Ctx, row: Row, at = new Date()): Promise<Row> => {
  const property = await record(ctx, 'hospitality_core.Property', row.propertyId)
  const roomType = await record(ctx, 'hospitality_core.RoomType', row.roomTypeId)
  const policyId = roomType?.cancellationPolicyId ?? property?.defaultCancellationPolicyId
  const policy = policyId ? await record(ctx, 'hospitality_core.CancellationPolicy', policyId) : null
  const beforeCheckIn = at.getTime() < new Date(String(row.checkIn)).getTime()
  const cutoff =
    new Date(String(row.checkIn)).getTime() - Number(policy?.freeCancellationHours ?? 0) * 3_600_000
  const cancellationAllowed =
    row.state === 'confirmed' && beforeCheckIn && policy?.type !== 'non_refundable' && at.getTime() <= cutoff
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
    amountTotal: row.amountTotal,
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
      existing: 'bool?',
      errors: 'json?',
    },
    effects: bookingEffects,
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const requestKey = String(args.requestKey ?? '').trim()
      if (!requestKey) return failure(problem('requestKey', 'requestConflict'))
      const normalized = { ...args, requestKey }
      const existing = await existingOnlineReservation(ctx, normalized)
      if (existing)
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
      const code = `WEB-${String(args.id).toUpperCase()}`
      const folioId = `${String(args.id)}:folio`
      const stayId = `${String(args.id)}:stay`
      const inventoryDates = occupancyDates(
        planned.checkInAt,
        planned.checkOutAt,
        String(planned.property.timezone),
      )
      try {
        return await ctx.tx(async (tx) => {
          const raced = await existingOnlineReservation(tx, normalized)
          if (raced)
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
            code: `F-${code}`,
            propertyId: args.propertyId,
            partnerId: args.partnerId,
            state: 'open',
            amountTotal: item.amountTotal,
            version: 0,
            openedAt: createdAt,
          })
          await tx.db.insert('hospitality_core.Reservation', {
            id: args.id,
            code,
            propertyId: args.propertyId,
            roomTypeId: args.roomTypeId,
            ratePlanId: item.ratePlanId ?? undefined,
            folioId,
            stayId,
            partnerId: args.partnerId,
            provider: 'website',
            requestKey,
            channelRef: args.channelRef,
            bookingType: 'nightly',
            checkIn: planned.checkInAt,
            checkOut: planned.checkOutAt,
            adults: planned.adults,
            children: planned.children,
            infants: planned.infants,
            roomQuantity: planned.quantity,
            rate: item.unitRate,
            quantity: String(planned.nights),
            billingMode: 'upfront',
            amountTotal: item.amountTotal,
            currency: item.currency,
            state: 'confirmed',
            createdAt,
            updatedAt: createdAt,
          })
          await tx.db.insert('hospitality_core.Stay', {
            id: stayId,
            code: `S-${code}`,
            folioId,
            reservationId: args.id,
            partnerId: args.partnerId,
            propertyId: args.propertyId,
            roomTypeId: args.roomTypeId,
            bookingType: 'nightly',
            checkIn: planned.checkInAt,
            checkOut: planned.checkOutAt,
            adults: planned.adults,
            children: planned.children,
            infants: planned.infants,
            roomQuantity: planned.quantity,
            billingMode: 'upfront',
            rate: item.unitRate,
            state: 'draft',
          })
          await tx.db.insert('hospitality_core.StayGuest', {
            id: `${String(args.id)}:guest`,
            stayId,
            propertyId: args.propertyId,
            partnerId: args.partnerId,
            displayName: partner.name,
            primary: true,
            primaryKey: 'primary',
          })
          await tx.db.insert('hospitality_core.Charge', {
            id: `${String(args.id)}:room`,
            folioId,
            stayId,
            description: `room:${String(args.roomTypeId)}`,
            type: 'room',
            quantity: String(planned.nights * planned.quantity),
            unitPrice: item.unitRate,
            amount: item.amountTotal,
            occurredAt: createdAt,
            sourceKey: `reservation:${String(args.id)}:room`,
            state: 'active',
          })
          return onlineReservationOutput(
            {
              id: args.id,
              companyId: planned.property.companyId,
              propertyId: args.propertyId,
              roomTypeId: args.roomTypeId,
              folioId,
              stayId,
              code,
              state: 'confirmed',
              rate: item.unitRate,
              roomQuantity: planned.quantity,
              amountTotal: item.amountTotal,
              currency: item.currency,
            },
            false,
          )
        })
      } catch (error) {
        if (error instanceof InventoryConflict)
          return failure(problem('roomTypeId', 'inventoryUnavailable', error.problem.params))
        if (/unique|duplicate/i.test(String((error as Error)?.message ?? error))) {
          const raced = await existingOnlineReservation(ctx, normalized)
          if (raced && sameOnlineRequest(raced, normalized)) return onlineReservationOutput(raced, true)
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
      const offset = Math.max(0, Number(args.offset ?? 0))
      const limit = Math.min(200, Math.max(1, Number(args.limit ?? 50)))
      return Promise.all(rows.slice(offset, offset + limit).map((row) => customerProjection(ctx, row)))
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
    output: { ok: 'bool', id: 'id?', state: 'text?', existing: 'bool?', errors: 'json?' },
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
      try {
        return await ctx.tx(async (tx) => {
          const claimed = await tx.db.compareAndSet(
            'hospitality_core.Reservation',
            { id: reservation.id },
            { state: 'confirmed', updatedAt: reservation.updatedAt },
            {
              state: 'cancelled',
              cancelReason: String(args.reason ?? '').trim() || 'customer',
              updatedAt: at.toISOString(),
            },
          )
          if (!('matched' in claimed) || !claimed.matched) {
            const current = await record(tx, 'hospitality_core.Reservation', reservation.id)
            if (current?.state === 'cancelled')
              return { ok: true, id: String(current.id), state: 'cancelled', existing: true, errors: [] }
            return failure(problem('state', 'requestConflict'))
          }
          if (reservation.stayId)
            await tx.db.compareAndSet(
              'hospitality_core.Stay',
              { id: reservation.stayId },
              { state: 'draft' },
              { state: 'cancelled' },
            )
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
          await releaseInventory(
            tx,
            reservation.propertyId,
            reservation.roomTypeId,
            dates,
            Number(reservation.roomQuantity ?? 1),
          )
          if (dates.length)
            await recordInventoryChange(tx, {
              propertyId: reservation.propertyId,
              roomTypeId: reservation.roomTypeId,
              kind: 'availability',
              dateFrom: dates[0]!,
              dateTo: dates.at(-1)!,
              aggregateId: reservation.id,
            })
          return { ok: true, id: String(reservation.id), state: 'cancelled', existing: false, errors: [] }
        })
      } catch (error) {
        if (error instanceof InventoryConflict) return failure(problem('state', 'requestConflict'))
        throw error
      }
    },
  }),
}
