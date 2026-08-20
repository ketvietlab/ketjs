import { asc, defineFn, eq, from } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import {
  BILLING_MODES,
  BOOKING_PROVIDERS,
  BOOKING_TYPES,
  DOCUMENT_TYPES,
  GENDERS,
  OCR_STATES,
} from './types.ts'
import { dateKeyIn } from './calendar.ts'
import {
  defaultRatePlan,
  InventoryConflict,
  occupancyDates,
  quoteAvailability,
  recordInventoryChange,
  releaseInventory,
  reserveInventory,
  restrictionIssues,
} from './inventory.ts'
import { postCharge } from './services.ts'
import { initializeRecurringRent } from './night-audit.ts'

type Issue = { field: string; code: string; messageKey: string; params?: Record<string, unknown> }
type Schedule = {
  checkIn: string
  checkOut: string
  quantity: string
  amountTotal: string
}

const issue = (field: string, code: string, params?: Record<string, unknown>): Issue => ({
  field,
  code,
  messageKey: `hospitality_core.validation.${code}`,
  ...(params ? { params } : {}),
})
const success = (id: unknown, extra: Record<string, unknown> = {}) => ({
  ok: true,
  id: String(id),
  errors: [],
  ...extra,
})
const failure = (...errors: Issue[]): { ok: false; errors: Issue[] } => ({ ok: false, errors })
const oneOf = (values: readonly string[], value: unknown): boolean => values.includes(String(value))
const text = (value: unknown): string => String(value ?? '').trim()
const date = (value: unknown): Date | null => {
  const parsed = new Date(String(value ?? ''))
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

const record = async (ctx: Ctx, model: string, id: unknown): Promise<Row | null> => {
  const table = ctx.table(model)
  return ctx.db.one(from(table).where(eq(table.id, id)))
}

const calendarDays = (start: Date, end: Date, timezone: string): number => {
  const a = Date.parse(`${dateKeyIn(start, timezone)}T00:00:00Z`)
  const b = Date.parse(`${dateKeyIn(end, timezone)}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

const scheduleOf = (
  bookingType: unknown,
  checkInValue: unknown,
  checkOutValue: unknown,
  rateValue: unknown,
  timezone: string,
): { schedule?: Schedule; errors: Issue[] } => {
  const errors: Issue[] = []
  if (!oneOf(BOOKING_TYPES, bookingType)) errors.push(issue('bookingType', 'booking_type'))
  const checkIn = date(checkInValue)
  const checkOut = date(checkOutValue)
  if (!checkIn) errors.push(issue('checkIn', 'datetime'))
  if (!checkOut) errors.push(issue('checkOut', 'datetime'))
  if (checkIn && checkOut && checkOut <= checkIn) errors.push(issue('checkOut', 'schedule_order'))
  const rate = Number(rateValue ?? 0)
  if (!Number.isFinite(rate) || rate < 0) errors.push(issue('rate', 'non_negative'))
  if (errors.length || !checkIn || !checkOut) return { errors }

  const hours = (checkOut.getTime() - checkIn.getTime()) / 3_600_000
  const nights = calendarDays(checkIn, checkOut, timezone)
  let quantity = nights
  if (bookingType === 'hourly') quantity = Math.ceil(hours)
  if (bookingType === 'weekly') {
    if (nights < 7) errors.push(issue('checkOut', 'weekly_minimum'))
    quantity = Math.ceil(nights / 7)
  }
  if (bookingType === 'monthly') {
    if (nights < 30) errors.push(issue('checkOut', 'monthly_minimum'))
    quantity = Math.ceil(nights / 30)
  }
  if (bookingType === 'nightly' && nights < 1) errors.push(issue('checkOut', 'nightly_minimum'))
  if (bookingType === 'hourly' && hours < 1) errors.push(issue('checkOut', 'hourly_minimum'))
  if (errors.length) return { errors }
  return {
    errors: [],
    schedule: {
      checkIn: checkIn.toISOString(),
      checkOut: checkOut.toISOString(),
      quantity: String(quantity),
      amountTotal: String(quantity * rate),
    },
  }
}

const overlaps = (startA: unknown, endA: unknown, startB: Date, endB: Date): boolean => {
  const a = date(startA)
  const b = date(endA)
  return !!a && !!b && a < endB && b > startB
}

class TransitionConflict extends Error {
  readonly problem: Issue

  constructor(problem: Issue) {
    super(problem.code)
    this.problem = problem
  }
}

const transition = async <T>(run: () => Promise<T>): Promise<T | { ok: false; errors: Issue[] }> => {
  try {
    return await run()
  } catch (error) {
    if (error instanceof TransitionConflict) return failure(error.problem)
    if (error instanceof InventoryConflict) return failure(error.problem)
    throw error
  }
}

type ReservationPlanInput = {
  propertyId?: unknown
  roomTypeId?: unknown
  bookingType?: unknown
  checkIn?: unknown
  checkOut?: unknown
  adults?: unknown
  children?: unknown
  rate?: unknown
  billingMode?: unknown
}

const planReservation = async (ctx: Ctx, args: ReservationPlanInput) => {
  const property = await record(ctx, 'hospitality_core.Property', args.propertyId)
  const roomType = await record(ctx, 'hospitality_core.RoomType', args.roomTypeId)
  const bookingType = String(args.bookingType ?? 'nightly')
  const billingMode = String(
    args.billingMode ?? (bookingType === 'weekly' || bookingType === 'monthly' ? 'recurring' : 'upfront'),
  )
  const ratePlan = roomType ? await defaultRatePlan(ctx, args.roomTypeId, bookingType) : null
  const rate = String(args.rate ?? ratePlan?.amount ?? roomType?.baseRate ?? '0')
  const calculated = scheduleOf(
    bookingType,
    args.checkIn,
    args.checkOut,
    rate,
    String(property?.timezone ?? 'UTC'),
  )
  const errors = [...calculated.errors]
  if (!property) errors.push(issue('propertyId', 'property_missing'))
  if (!roomType) errors.push(issue('roomTypeId', 'room_type_missing'))
  else if (roomType.propertyId !== args.propertyId) errors.push(issue('roomTypeId', 'property_mismatch'))
  if (!oneOf(BILLING_MODES, billingMode)) errors.push(issue('billingMode', 'billing_mode'))
  if (Number(args.adults ?? 1) < 1) errors.push(issue('adults', 'positive'))
  if (Number(args.children ?? 0) < 0) errors.push(issue('children', 'non_negative'))
  if (calculated.schedule && ratePlan) {
    const quantity = Number(calculated.schedule.quantity)
    if (Number(ratePlan.minStay) > 0 && quantity < Number(ratePlan.minStay))
      errors.push(
        issue('checkOut', 'rate_plan_min_stay', {
          count: ratePlan.minStay,
          actual: quantity,
        }),
      )
    if (Number(ratePlan.maxStay) > 0 && quantity > Number(ratePlan.maxStay))
      errors.push(
        issue('checkOut', 'rate_plan_max_stay', {
          count: ratePlan.maxStay,
          actual: quantity,
        }),
      )
  }
  const inventoryDates =
    calculated.schedule && bookingType !== 'hourly'
      ? occupancyDates(
          calculated.schedule.checkIn,
          calculated.schedule.checkOut,
          String(property?.timezone ?? 'UTC'),
        )
      : []
  if (inventoryDates.length > 366) errors.push(issue('checkOut', 'inventory_horizon', { count: 366 }))
  let minimumAvailable: number | undefined
  if (property && roomType && roomType.propertyId === args.propertyId && calculated.schedule) {
    if (inventoryDates.length) {
      errors.push(
        ...(await restrictionIssues(
          ctx,
          args.propertyId,
          args.roomTypeId,
          inventoryDates,
          dateKeyIn(new Date(calculated.schedule.checkOut), String(property.timezone ?? 'UTC')),
        )),
      )
      const availability = await quoteAvailability(ctx, args.propertyId, args.roomTypeId, inventoryDates)
      minimumAvailable = availability.minimumAvailable
      errors.push(...availability.errors)
    } else if (bookingType === 'hourly') {
      minimumAvailable = (await quoteAvailability(ctx, args.propertyId, args.roomTypeId, [])).minimumAvailable
    }
  }
  return {
    property,
    roomType,
    bookingType,
    billingMode,
    ratePlan,
    rate,
    schedule: calculated.schedule,
    inventoryDates,
    minimumAvailable,
    errors,
  }
}

const reservationOutput = {
  id: 'id',
  code: 'text',
  propertyId: 'id',
  roomTypeId: 'id',
  folioId: 'id',
  stayId: 'id?',
  partnerId: 'id',
  provider: 'text',
  externalId: 'text?',
  channelRef: 'text?',
  bookingType: 'text',
  checkIn: 'datetime',
  checkOut: 'datetime',
  adults: 'int',
  children: 'int',
  rate: 'decimal',
  quantity: 'decimal',
  billingMode: 'text',
  amountTotal: 'decimal',
  state: 'text',
  cancelReason: 'text?',
  createdAt: 'datetime',
  updatedAt: 'datetime',
  partner: 'json?',
  roomType: 'json?',
  stay: 'json?',
  folio: 'json?',
}

const stayOutput = {
  id: 'id',
  code: 'text',
  folioId: 'id',
  reservationId: 'id?',
  partnerId: 'id',
  propertyId: 'id',
  roomTypeId: 'id',
  currentRoomId: 'id?',
  bookingType: 'text',
  checkIn: 'datetime',
  checkOut: 'datetime',
  adults: 'int',
  children: 'int',
  billingMode: 'text',
  rate: 'decimal',
  nextBillDate: 'date?',
  state: 'text',
  checkedInAt: 'datetime?',
  checkedOutAt: 'datetime?',
  partner: 'json?',
  roomType: 'json?',
  currentRoom: 'json?',
  reservation: 'json?',
  assignments: 'json?',
  guests: 'json?',
}

const reservationQuoteEffects = [
  'read:hospitality_core.Property',
  'read:hospitality_core.RoomType',
  'read:hospitality_core.Room',
  'read:hospitality_core.RatePlan',
  'read:hospitality_core.Restriction',
  'read:hospitality_core.AvailabilityLedger',
]

const bookingEffects = [
  ...reservationQuoteEffects,
  'read:partner.Partner',
  'read:hospitality_core.Reservation',
  'write:hospitality_core.Folio',
  'write:hospitality_core.Reservation',
  'write:hospitality_core.Stay',
  'write:hospitality_core.Charge',
  'write:hospitality_core.StayGuest',
  'write:hospitality_core.AvailabilityLedger',
  'write:hospitality_core.InventoryChange',
]

export const operations: Record<string, FnSpec> = {
  quoteReservation: defineFn({
    input: {
      propertyId: 'id',
      roomTypeId: 'id',
      bookingType: 'text?',
      checkIn: 'datetime',
      checkOut: 'datetime',
      adults: 'int?',
      children: 'int?',
      rate: 'decimal?',
      billingMode: 'text?',
    },
    output: {
      ok: 'bool',
      propertyId: 'id?',
      roomTypeId: 'id?',
      ratePlanId: 'id?',
      bookingType: 'text?',
      billingMode: 'text?',
      checkIn: 'datetime?',
      checkOut: 'datetime?',
      rate: 'decimal?',
      quantity: 'decimal?',
      amountTotal: 'decimal?',
      minimumAvailable: 'int?',
      errors: 'json?',
    },
    effects: reservationQuoteEffects,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const plan = await planReservation(ctx, args)
      if (plan.errors.length || !plan.schedule) return failure(...plan.errors)
      return {
        ok: true,
        propertyId: String(args.propertyId),
        roomTypeId: String(args.roomTypeId),
        ratePlanId: plan.ratePlan?.id,
        bookingType: plan.bookingType,
        billingMode: plan.billingMode,
        checkIn: plan.schedule.checkIn,
        checkOut: plan.schedule.checkOut,
        rate: plan.rate,
        quantity: plan.schedule.quantity,
        amountTotal: plan.schedule.amountTotal,
        minimumAvailable: plan.minimumAvailable,
        errors: [],
      }
    },
  }),

  createReservation: defineFn({
    input: {
      id: 'id',
      code: 'text?',
      propertyId: 'id',
      roomTypeId: 'id',
      partnerId: 'id',
      provider: 'text?',
      externalId: 'text?',
      channelRef: 'text?',
      bookingType: 'text?',
      checkIn: 'datetime',
      checkOut: 'datetime',
      adults: 'int?',
      children: 'int?',
      rate: 'decimal?',
      billingMode: 'text?',
      createdAt: 'datetime?',
    },
    output: { ok: 'bool', id: 'id?', folioId: 'id?', stayId: 'id?', existing: 'bool?', errors: 'json?' },
    effects: bookingEffects,
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const existing = await record(ctx, 'hospitality_core.Reservation', args.id)
      if (existing)
        return success(existing.id, {
          folioId: existing.folioId,
          stayId: existing.stayId,
          existing: true,
        })
      const partner = await record(ctx, 'partner.Partner', args.partnerId)
      const provider = String(args.provider ?? 'direct')
      const plan = await planReservation(ctx, args)
      const errors = [...plan.errors]
      if (!partner) errors.push(issue('partnerId', 'partner_missing'))
      if (!oneOf(BOOKING_PROVIDERS, provider)) errors.push(issue('provider', 'booking_provider'))
      if (args.externalId) {
        const R = ctx.table('hospitality_core.Reservation')
        const duplicate = await ctx.db.one(
          from(R).where(
            eq(R.propertyId, args.propertyId),
            eq(R.provider, provider),
            eq(R.externalId, args.externalId),
          ),
        )
        if (duplicate) errors.push(issue('externalId', 'provider_external_unique'))
      }
      if (errors.length || !plan.schedule) return failure(...errors)

      const schedule = plan.schedule
      const now = date(args.createdAt)?.toISOString() ?? new Date().toISOString()
      const folioId = `${String(args.id)}:folio`
      const stayId = `${String(args.id)}:stay`
      const chargeId = `${String(args.id)}:room`
      const guestId = `${String(args.id)}:guest`
      const code = text(args.code) || String(args.id).toUpperCase()
      const state = 'confirmed'
      const initialFolioTotal = plan.billingMode === 'upfront' ? schedule.amountTotal : '0'
      return transition(() =>
        ctx.tx(async (tx) => {
          if (plan.inventoryDates.length)
            await reserveInventory(tx, args.propertyId, args.roomTypeId, plan.inventoryDates)
          if (plan.inventoryDates.length)
            await recordInventoryChange(tx, {
              propertyId: args.propertyId,
              roomTypeId: args.roomTypeId,
              kind: 'availability',
              dateFrom: plan.inventoryDates[0]!,
              dateTo: plan.inventoryDates.at(-1)!,
              aggregateId: args.id,
            })
          await tx.db.insert('hospitality_core.Folio', {
            id: folioId,
            code: `F-${code}`,
            propertyId: args.propertyId,
            partnerId: args.partnerId,
            state: 'open',
            amountTotal: initialFolioTotal,
            version: 0,
            openedAt: now,
          })
          await tx.db.insert('hospitality_core.Reservation', {
            id: args.id,
            code,
            propertyId: args.propertyId,
            roomTypeId: args.roomTypeId,
            folioId,
            partnerId: args.partnerId,
            provider,
            externalId: args.externalId,
            channelRef: args.channelRef,
            bookingType: plan.bookingType,
            checkIn: schedule.checkIn,
            checkOut: schedule.checkOut,
            adults: Number(args.adults ?? 1),
            children: Number(args.children ?? 0),
            rate: plan.rate,
            quantity: schedule.quantity,
            billingMode: plan.billingMode,
            amountTotal: schedule.amountTotal,
            state,
            createdAt: now,
            updatedAt: now,
          })
          await tx.db.insert('hospitality_core.Stay', {
            id: stayId,
            code: `S-${code}`,
            folioId,
            reservationId: args.id,
            partnerId: args.partnerId,
            propertyId: args.propertyId,
            roomTypeId: args.roomTypeId,
            bookingType: plan.bookingType,
            checkIn: schedule.checkIn,
            checkOut: schedule.checkOut,
            adults: Number(args.adults ?? 1),
            children: Number(args.children ?? 0),
            billingMode: plan.billingMode,
            rate: plan.rate,
            state: 'draft',
          })
          await tx.db.update('hospitality_core.Reservation', { id: args.id }, { stayId })
          await tx.db.insert('hospitality_core.StayGuest', {
            id: guestId,
            stayId,
            propertyId: args.propertyId,
            partnerId: args.partnerId,
            displayName: partner!.name,
            primary: true,
            primaryKey: 'primary',
          })
          if (plan.billingMode === 'upfront')
            await tx.db.insert('hospitality_core.Charge', {
              id: chargeId,
              folioId,
              stayId,
              description: `room:${String(args.roomTypeId)}`,
              type: 'room',
              quantity: schedule.quantity,
              unitPrice: plan.rate,
              amount: schedule.amountTotal,
              occurredAt: now,
              sourceKey: `reservation:${String(args.id)}:room`,
              state: 'active',
            })
          return success(args.id, { folioId, stayId, existing: false })
        }),
      )
    },
  }),

  listReservations: defineFn({
    input: { propertyId: 'id?', state: 'text?', from: 'datetime?', to: 'datetime?' },
    output: reservationOutput,
    effects: [
      'read:hospitality_core.Reservation',
      'read:partner.Partner',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.Stay',
    ],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const R = ctx.table('hospitality_core.Reservation')
      let query = from(R).orderBy(asc(R.checkIn)).preload('partner', 'roomType', 'stay')
      if (args.propertyId) query = query.where(eq(R.propertyId, args.propertyId))
      if (args.state) query = query.where(eq(R.state, args.state))
      const start = args.from ? date(args.from) : null
      const end = args.to ? date(args.to) : null
      return (await ctx.db.all(query)).filter(
        (row) => (!start || date(row.checkOut)! > start) && (!end || date(row.checkIn)! < end),
      )
    },
  }),

  getReservation: defineFn({
    input: { id: 'id' },
    output: reservationOutput,
    effects: [
      'read:hospitality_core.Reservation',
      'read:partner.Partner',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.Stay',
      'read:hospitality_core.Folio',
    ],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const R = ctx.table('hospitality_core.Reservation')
      return ctx.db.one(from(R).where(eq(R.id, args.id)).preload('partner', 'roomType', 'stay', 'folio'))
    },
  }),

  cancelReservation: defineFn({
    input: { id: 'id', reason: 'text?', at: 'datetime?' },
    output: { ok: 'bool', id: 'id?', state: 'text?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Reservation',
      'read:hospitality_core.Charge',
      'read:hospitality_core.Folio',
      'read:hospitality_core.Property',
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
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const reservation = await record(ctx, 'hospitality_core.Reservation', args.id)
      if (!reservation) return failure(issue('id', 'reservation_missing'))
      if (reservation.state === 'cancelled') return success(args.id, { state: 'cancelled' })
      if (reservation.state === 'checked_in' || reservation.state === 'checked_out')
        return failure(issue('state', 'reservation_cannot_cancel'))
      const at = date(args.at)?.toISOString() ?? new Date().toISOString()
      const property = await record(ctx, 'hospitality_core.Property', reservation.propertyId)
      const inventoryDates =
        reservation.bookingType === 'hourly'
          ? []
          : occupancyDates(reservation.checkIn, reservation.checkOut, String(property?.timezone ?? 'UTC'))
      return transition(() =>
        ctx.tx(async (tx) => {
          const reservationClaim = await tx.db.compareAndSet(
            'hospitality_core.Reservation',
            { id: args.id },
            { state: reservation.state },
            { state: 'cancelled', cancelReason: args.reason, updatedAt: at },
          )
          if (!('matched' in reservationClaim) || !reservationClaim.matched)
            throw new TransitionConflict(issue('state', 'transition_conflict'))
          if (reservation.stayId) {
            const stayClaim = await tx.db.compareAndSet(
              'hospitality_core.Stay',
              { id: reservation.stayId },
              { state: 'draft' },
              { state: 'cancelled' },
            )
            if (!('matched' in stayClaim) || !stayClaim.matched)
              throw new TransitionConflict(issue('state', 'transition_conflict'))
          }
          const folio = await record(tx, 'hospitality_core.Folio', reservation.folioId)
          await tx.db.update(
            'hospitality_core.Folio',
            { id: reservation.folioId },
            { state: 'cancelled', amountTotal: '0', closedAt: at, version: Number(folio?.version ?? 0) + 1 },
          )
          const C = tx.table('hospitality_core.Charge')
          const charges = await tx.db.all(
            from(C).where(eq(C.folioId, reservation.folioId), eq(C.state, 'active')),
          )
          for (const charge of charges)
            await tx.db.update('hospitality_core.Charge', { id: charge.id }, { state: 'void' })
          if (inventoryDates.length)
            await releaseInventory(tx, reservation.propertyId, reservation.roomTypeId, inventoryDates)
          if (inventoryDates.length)
            await recordInventoryChange(tx, {
              propertyId: reservation.propertyId,
              roomTypeId: reservation.roomTypeId,
              kind: 'availability',
              dateFrom: inventoryDates[0]!,
              dateTo: inventoryDates.at(-1)!,
              aggregateId: reservation.id,
            })
          return success(args.id, { state: 'cancelled' })
        }),
      )
    },
  }),

  listStays: defineFn({
    input: { propertyId: 'id?', state: 'text?', from: 'datetime?', to: 'datetime?' },
    output: stayOutput,
    effects: [
      'read:hospitality_core.Stay',
      'read:partner.Partner',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.Room',
      'read:hospitality_core.Reservation',
    ],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const S = ctx.table('hospitality_core.Stay')
      let query = from(S).orderBy(asc(S.checkIn)).preload('partner', 'roomType', 'currentRoom', 'reservation')
      if (args.propertyId) query = query.where(eq(S.propertyId, args.propertyId))
      if (args.state) query = query.where(eq(S.state, args.state))
      const start = args.from ? date(args.from) : null
      const end = args.to ? date(args.to) : null
      return (await ctx.db.all(query)).filter(
        (row) => (!start || date(row.checkOut)! > start) && (!end || date(row.checkIn)! < end),
      )
    },
  }),

  getStay: defineFn({
    input: { id: 'id' },
    output: stayOutput,
    effects: [
      'read:hospitality_core.Stay',
      'read:partner.Partner',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.Room',
      'read:hospitality_core.Reservation',
      'read:hospitality_core.RoomAssignment',
      'read:hospitality_core.StayGuest',
    ],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const S = ctx.table('hospitality_core.Stay')
      return ctx.db.one(
        from(S)
          .where(eq(S.id, args.id))
          .preload('partner', 'roomType', 'currentRoom', 'reservation', 'assignments', 'guests'),
      )
    },
  }),

  checkIn: defineFn({
    input: { stayId: 'id', roomId: 'id?', assignmentId: 'id?', at: 'datetime?' },
    output: { ok: 'bool', id: 'id?', roomId: 'id?', state: 'text?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Stay',
      'read:hospitality_core.Property',
      'read:hospitality_core.Room',
      'read:hospitality_core.Folio',
      'read:hospitality_core.Charge',
      'write:hospitality_core.Charge',
      'write:hospitality_core.Room',
      'write:hospitality_core.Stay',
      'write:hospitality_core.Reservation',
      'write:hospitality_core.Folio',
      'write:hospitality_core.RoomAssignment',
      'enqueue:hospitality_core.prepareStayNotices',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const stay = await record(ctx, 'hospitality_core.Stay', args.stayId)
      if (!stay) return failure(issue('stayId', 'stay_missing'))
      if (stay.state === 'checked_in') {
        const property = await record(ctx, 'hospitality_core.Property', stay.propertyId)
        if (property) {
          const rent = await initializeRecurringRent(ctx, stay, property)
          if (rent.ok !== true) return rent
        }
        await ctx.jobs.enqueue(
          'hospitality_core.prepareStayNotices',
          { stayId: stay.id },
          { uniqueKey: `stay-notices:${String(stay.id)}` },
        )
        return success(stay.id, { roomId: stay.currentRoomId, state: stay.state })
      }
      if (stay.state !== 'draft') return failure(issue('state', 'stay_cannot_check_in'))
      const at = date(args.at) ?? new Date()
      const property = await record(ctx, 'hospitality_core.Property', stay.propertyId)
      if (property?.enforceTimes && at < date(stay.checkIn)!) return failure(issue('at', 'early_check_in'))

      const R = ctx.table('hospitality_core.Room')
      let room: Row | null = null
      if (args.roomId) room = await record(ctx, 'hospitality_core.Room', args.roomId)
      else {
        const candidates = await ctx.db.all(
          from(R).where(
            eq(R.propertyId, stay.propertyId),
            eq(R.roomTypeId, stay.roomTypeId),
            eq(R.status, 'available'),
            eq(R.active, true),
          ),
        )
        room = candidates[0] ?? null
      }
      if (!room) return failure(issue('roomId', 'no_available_room'))
      if (room.propertyId !== stay.propertyId) return failure(issue('roomId', 'property_mismatch'))
      if (room.roomTypeId !== stay.roomTypeId) return failure(issue('roomId', 'room_type_mismatch'))
      if (room.status !== 'available' || room.active !== true)
        return failure(issue('roomId', 'room_not_available'))

      const assignmentId = args.assignmentId ?? `${String(stay.id)}:assignment:1`
      const transitioned = await transition(() =>
        ctx.tx(async (tx) => {
          if (stay.reservationId) {
            const reservationClaim = await tx.db.compareAndSet(
              'hospitality_core.Reservation',
              { id: stay.reservationId },
              { state: 'confirmed' },
              { state: 'checked_in', updatedAt: at.toISOString() },
            )
            if (!('matched' in reservationClaim) || !reservationClaim.matched)
              throw new TransitionConflict(issue('state', 'transition_conflict'))
          }
          const stayClaim = await tx.db.compareAndSet(
            'hospitality_core.Stay',
            { id: stay.id },
            { state: 'draft' },
            { state: 'checked_in', currentRoomId: room!.id, checkedInAt: at.toISOString() },
          )
          if (!('matched' in stayClaim) || !stayClaim.matched)
            throw new TransitionConflict(issue('state', 'transition_conflict'))
          const roomClaim = await tx.db.compareAndSet(
            'hospitality_core.Room',
            { id: room!.id },
            { status: 'available', active: true },
            { status: 'occupied' },
          )
          if (!('matched' in roomClaim) || !roomClaim.matched)
            throw new TransitionConflict(issue('roomId', 'room_not_available'))
          await tx.db.insert('hospitality_core.RoomAssignment', {
            id: assignmentId,
            stayId: stay.id,
            propertyId: stay.propertyId,
            roomId: room!.id,
            roomTypeId: room!.roomTypeId,
            startAt: at.toISOString(),
            state: 'active',
          })
          await tx.db.update('hospitality_core.Folio', { id: stay.folioId }, { state: 'open' })
          await tx.jobs.enqueue(
            'hospitality_core.prepareStayNotices',
            { stayId: stay.id },
            { uniqueKey: `stay-notices:${String(stay.id)}` },
          )
          return success(stay.id, { roomId: room!.id, state: 'checked_in' })
        }),
      )
      if (transitioned.ok !== true) return transitioned
      const checkedIn = await record(ctx, 'hospitality_core.Stay', stay.id)
      if (checkedIn && property) {
        const rent = await initializeRecurringRent(ctx, checkedIn, property)
        if (rent.ok !== true) return rent
      }
      return transitioned
    },
  }),

  moveRoom: defineFn({
    input: { stayId: 'id', roomId: 'id', assignmentId: 'id', reason: 'text?', at: 'datetime?' },
    output: { ok: 'bool', id: 'id?', roomId: 'id?', state: 'text?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Stay',
      'read:hospitality_core.Room',
      'read:hospitality_core.RoomAssignment',
      'write:hospitality_core.Room',
      'write:hospitality_core.Stay',
      'write:hospitality_core.RoomAssignment',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const stay = await record(ctx, 'hospitality_core.Stay', args.stayId)
      const room = await record(ctx, 'hospitality_core.Room', args.roomId)
      if (!stay) return failure(issue('stayId', 'stay_missing'))
      if (stay.state !== 'checked_in' || !stay.currentRoomId)
        return failure(issue('state', 'stay_cannot_move'))
      if (!room) return failure(issue('roomId', 'room_missing'))
      if (room.propertyId !== stay.propertyId) return failure(issue('roomId', 'property_mismatch'))
      if (room.status !== 'available' || room.active !== true)
        return failure(issue('roomId', 'room_not_available'))
      if (room.id === stay.currentRoomId) return success(stay.id, { roomId: room.id, state: 'checked_in' })
      const A = ctx.table('hospitality_core.RoomAssignment')
      const current = await ctx.db.one(
        from(A).where(eq(A.stayId, stay.id), eq(A.roomId, stay.currentRoomId), eq(A.state, 'active')),
      )
      if (!current) return failure(issue('stayId', 'active_assignment_missing'))
      const at = date(args.at) ?? new Date()
      if (at <= date(current.startAt)!) return failure(issue('at', 'assignment_order'))

      return transition(() =>
        ctx.tx(async (tx) => {
          const roomClaim = await tx.db.compareAndSet(
            'hospitality_core.Room',
            { id: room.id },
            { status: 'available', active: true },
            { status: 'occupied' },
          )
          if (!('matched' in roomClaim) || !roomClaim.matched)
            throw new TransitionConflict(issue('roomId', 'room_not_available'))
          const stayClaim = await tx.db.compareAndSet(
            'hospitality_core.Stay',
            { id: stay.id },
            { state: 'checked_in', currentRoomId: stay.currentRoomId },
            { currentRoomId: room.id, roomTypeId: room.roomTypeId },
          )
          if (!('matched' in stayClaim) || !stayClaim.matched)
            throw new TransitionConflict(issue('state', 'transition_conflict'))
          await tx.db.update(
            'hospitality_core.RoomAssignment',
            { id: current.id },
            { state: 'closed', endAt: at.toISOString() },
          )
          await tx.db.update('hospitality_core.Room', { id: stay.currentRoomId }, { status: 'dirty' })
          await tx.db.insert('hospitality_core.RoomAssignment', {
            id: args.assignmentId,
            stayId: stay.id,
            propertyId: stay.propertyId,
            roomId: room.id,
            roomTypeId: room.roomTypeId,
            startAt: at.toISOString(),
            state: 'active',
            reason: args.reason,
          })
          return success(stay.id, { roomId: room.id, state: 'checked_in' })
        }),
      )
    },
  }),

  checkOut: defineFn({
    input: { stayId: 'id', at: 'datetime?' },
    output: { ok: 'bool', id: 'id?', roomId: 'id?', state: 'text?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Stay',
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomAssignment',
      'write:hospitality_core.Room',
      'write:hospitality_core.Stay',
      'write:hospitality_core.Reservation',
      'write:hospitality_core.Folio',
      'write:hospitality_core.RoomAssignment',
      'write:hospitality_core.CleaningTask',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const stay = await record(ctx, 'hospitality_core.Stay', args.stayId)
      if (!stay) return failure(issue('stayId', 'stay_missing'))
      if (stay.state === 'checked_out')
        return success(stay.id, { roomId: stay.currentRoomId, state: stay.state })
      if (stay.state !== 'checked_in' || !stay.currentRoomId)
        return failure(issue('state', 'stay_cannot_check_out'))
      const at = date(args.at) ?? new Date()
      const A = ctx.table('hospitality_core.RoomAssignment')
      const current = await ctx.db.one(from(A).where(eq(A.stayId, stay.id), eq(A.state, 'active')))
      if (!current) return failure(issue('stayId', 'active_assignment_missing'))
      if (at <= date(current.startAt)!) return failure(issue('at', 'assignment_order'))

      return transition(() =>
        ctx.tx(async (tx) => {
          if (stay.reservationId) {
            const reservationClaim = await tx.db.compareAndSet(
              'hospitality_core.Reservation',
              { id: stay.reservationId },
              { state: 'checked_in' },
              { state: 'checked_out', updatedAt: at.toISOString() },
            )
            if (!('matched' in reservationClaim) || !reservationClaim.matched)
              throw new TransitionConflict(issue('state', 'transition_conflict'))
          }
          const stayClaim = await tx.db.compareAndSet(
            'hospitality_core.Stay',
            { id: stay.id },
            { state: 'checked_in', currentRoomId: stay.currentRoomId },
            { state: 'checked_out', currentRoomId: null, checkedOutAt: at.toISOString() },
          )
          if (!('matched' in stayClaim) || !stayClaim.matched)
            throw new TransitionConflict(issue('state', 'transition_conflict'))
          await tx.db.update(
            'hospitality_core.RoomAssignment',
            { id: current.id },
            { state: 'closed', endAt: at.toISOString() },
          )
          await tx.db.update('hospitality_core.Room', { id: stay.currentRoomId }, { status: 'dirty' })
          await tx.db.insert('hospitality_core.CleaningTask', {
            id: `checkout:${stay.id}`,
            code: `HK-${stay.code}`,
            propertyId: stay.propertyId,
            roomId: stay.currentRoomId,
            stayId: stay.id,
            taskType: 'checkout_clean',
            priority: 'urgent',
            state: 'todo',
            requestedAt: at.toISOString(),
          })
          await tx.db.update(
            'hospitality_core.Folio',
            { id: stay.folioId },
            { state: 'closed', closedAt: at.toISOString() },
          )
          return success(stay.id, { roomId: stay.currentRoomId, state: 'checked_out' })
        }),
      )
    },
  }),

  addStayGuest: defineFn({
    input: { id: 'id', stayId: 'id', partnerId: 'id?', displayName: 'text', primary: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Stay',
      'read:hospitality_core.StayGuest',
      'read:partner.Partner',
      'write:hospitality_core.StayGuest',
      'enqueue:hospitality_core.prepareStayNotices',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const stay = await record(ctx, 'hospitality_core.Stay', args.stayId)
      const existing = await record(ctx, 'hospitality_core.StayGuest', args.id)
      if (existing) {
        if (stay?.state === 'checked_in')
          await ctx.jobs.enqueue(
            'hospitality_core.prepareStayNotices',
            { stayId: stay.id },
            { uniqueKey: `stay-notices:${String(stay.id)}` },
          )
        return success(existing.id)
      }
      const errors: Issue[] = []
      if (!stay) errors.push(issue('stayId', 'stay_missing'))
      if (!text(args.displayName)) errors.push(issue('displayName', 'required'))
      if (args.partnerId && !(await record(ctx, 'partner.Partner', args.partnerId)))
        errors.push(issue('partnerId', 'partner_missing'))
      if (args.primary === true && args.partnerId !== stay?.partnerId)
        errors.push(issue('partnerId', 'primary_guest_mismatch'))
      const G = ctx.table('hospitality_core.StayGuest')
      if (args.primary === true) {
        const primary = await ctx.db.one(from(G).where(eq(G.stayId, args.stayId), eq(G.primary, true)))
        if (primary) errors.push(issue('primary', 'primary_guest_unique'))
      }
      if (args.partnerId) {
        const duplicate = await ctx.db.one(
          from(G).where(eq(G.stayId, args.stayId), eq(G.partnerId, args.partnerId)),
        )
        if (duplicate) return success(duplicate.id)
      }
      if (errors.length || !stay) return failure(...errors)
      await ctx.tx(async (tx) => {
        await tx.db.insert('hospitality_core.StayGuest', {
          id: args.id,
          stayId: args.stayId,
          propertyId: stay.propertyId,
          partnerId: args.partnerId,
          displayName: text(args.displayName),
          primary: args.primary === true,
          primaryKey: args.primary === true ? 'primary' : null,
        })
        if (stay.state === 'checked_in')
          await tx.jobs.enqueue(
            'hospitality_core.prepareStayNotices',
            { stayId: stay.id },
            { uniqueKey: `stay-notices:${String(stay.id)}` },
          )
      })
      return success(args.id)
    },
  }),

  listStayGuests: defineFn({
    input: { stayId: 'id' },
    output: { id: 'id', stayId: 'id', displayName: 'text', primary: 'bool' },
    effects: ['read:hospitality_core.StayGuest'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const G = ctx.table('hospitality_core.StayGuest')
      return ctx.db.all(from(G).where(eq(G.stayId, args.stayId)).orderBy(asc(G.id)))
    },
  }),

  addCharge: defineFn({
    input: {
      id: 'id',
      folioId: 'id',
      stayId: 'id?',
      description: 'text',
      type: 'text?',
      quantity: 'decimal?',
      unitPrice: 'decimal',
      occurredAt: 'datetime?',
      sourceKey: 'text?',
    },
    output: { ok: 'bool', id: 'id?', amount: 'decimal?', existing: 'bool?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Folio',
      'read:hospitality_core.Stay',
      'read:hospitality_core.Charge',
      'write:hospitality_core.Folio',
      'write:hospitality_core.Charge',
    ],
    idempotent: true,
    agent: true,
    handler: postCharge,
  }),

  listFolios: defineFn({
    input: { propertyId: 'id?', state: 'text?' },
    output: {
      id: 'id',
      code: 'text',
      propertyId: 'id',
      partnerId: 'id',
      state: 'text',
      amountTotal: 'decimal',
      version: 'int',
      openedAt: 'datetime',
      closedAt: 'datetime?',
      partner: 'json?',
      stays: 'json?',
    },
    effects: ['read:hospitality_core.Folio', 'read:partner.Partner', 'read:hospitality_core.Stay'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const F = ctx.table('hospitality_core.Folio')
      let query = from(F).orderBy(asc(F.openedAt)).preload('partner', 'stays')
      if (args.propertyId) query = query.where(eq(F.propertyId, args.propertyId))
      if (args.state) query = query.where(eq(F.state, args.state))
      return ctx.db.all(query)
    },
  }),

  getFolio: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      code: 'text',
      propertyId: 'id',
      partnerId: 'id',
      state: 'text',
      amountTotal: 'decimal',
      version: 'int',
      openedAt: 'datetime',
      closedAt: 'datetime?',
      charges: 'json?',
      stays: 'json?',
    },
    effects: ['read:hospitality_core.Folio', 'read:hospitality_core.Charge', 'read:hospitality_core.Stay'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const F = ctx.table('hospitality_core.Folio')
      return ctx.db.one(from(F).where(eq(F.id, args.id)).preload('charges', 'stays'))
    },
  }),

  saveGuestDocument: defineFn({
    input: {
      id: 'id',
      stayId: 'id?',
      partnerId: 'id',
      type: 'text',
      number: 'text?',
      fullName: 'text',
      dateOfBirth: 'datetime?',
      gender: 'text?',
      nationality: 'text?',
      permanentAddress: 'text?',
      issueDate: 'datetime?',
      issuePlace: 'text?',
      frontAttachmentId: 'id?',
      backAttachmentId: 'id?',
      ocrState: 'text?',
      ocrRaw: 'json?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:partner.Partner',
      'read:hospitality_core.Stay',
      'read:hospitality_core.GuestDocument',
      'read:storage.Attachment',
      'write:hospitality_core.GuestDocument',
      'enqueue:hospitality_core.prepareStayNotices',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const partner = await record(ctx, 'partner.Partner', args.partnerId)
      const stay = args.stayId ? await record(ctx, 'hospitality_core.Stay', args.stayId) : null
      const errors: Issue[] = []
      if (!partner) errors.push(issue('partnerId', 'partner_missing'))
      if (args.stayId && !stay) errors.push(issue('stayId', 'stay_missing'))
      if (!oneOf(DOCUMENT_TYPES, args.type)) errors.push(issue('type', 'document_type'))
      if (!text(args.fullName)) errors.push(issue('fullName', 'required'))
      if (args.gender && !oneOf(GENDERS, args.gender)) errors.push(issue('gender', 'gender'))
      const ocrState = String(args.ocrState ?? 'pending')
      if (!oneOf(OCR_STATES, ocrState)) errors.push(issue('ocrState', 'ocr_state'))
      for (const field of ['frontAttachmentId', 'backAttachmentId'] as const)
        if (args[field] && !(await record(ctx, 'storage.Attachment', args[field])))
          errors.push(issue(field, 'attachment_missing'))
      if (errors.length) return failure(...errors)
      const existing = await record(ctx, 'hospitality_core.GuestDocument', args.id)
      const values = {
        stayId: args.stayId,
        partnerId: args.partnerId,
        type: args.type,
        number: text(args.number) || undefined,
        fullName: text(args.fullName),
        dateOfBirth: args.dateOfBirth,
        gender: args.gender,
        nationality: args.nationality,
        permanentAddress: args.permanentAddress,
        issueDate: args.issueDate,
        issuePlace: args.issuePlace,
        frontAttachmentId: args.frontAttachmentId,
        backAttachmentId: args.backAttachmentId,
        ocrState,
        ocrRaw: args.ocrRaw,
      }
      await ctx.tx(async (tx) => {
        if (existing) await tx.db.update('hospitality_core.GuestDocument', { id: args.id }, values)
        else await tx.db.insert('hospitality_core.GuestDocument', { id: args.id, ...values })
        if (stay?.state === 'checked_in')
          await tx.jobs.enqueue(
            'hospitality_core.prepareStayNotices',
            { stayId: stay.id },
            { uniqueKey: `stay-notices:${String(stay.id)}` },
          )
      })
      return success(args.id)
    },
  }),

  listGuestDocuments: defineFn({
    input: { stayId: 'id?', partnerId: 'id?' },
    output: {
      id: 'id',
      stayId: 'id?',
      partnerId: 'id',
      type: 'text',
      number: 'text?',
      fullName: 'text',
      nationality: 'text?',
      ocrState: 'text',
    },
    effects: ['read:hospitality_core.GuestDocument'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const D = ctx.table('hospitality_core.GuestDocument')
      let query = from(D).orderBy(asc(D.fullName))
      if (args.stayId) query = query.where(eq(D.stayId, args.stayId))
      if (args.partnerId) query = query.where(eq(D.partnerId, args.partnerId))
      return ctx.db.all(query)
    },
  }),

  getTapeChart: defineFn({
    input: { propertyId: 'id', from: 'datetime', to: 'datetime' },
    output: {
      propertyId: 'id',
      timezone: 'text',
      from: 'datetime',
      to: 'datetime',
      rooms: 'json',
      events: 'json',
    },
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.Room',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.Stay',
      'read:hospitality_core.RoomAssignment',
      'read:partner.Partner',
      'read:hospitality_core.Reservation',
    ],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const start = date(args.from)
      const end = date(args.to)
      const property = await record(ctx, 'hospitality_core.Property', args.propertyId)
      const timezone = String(property?.timezone ?? 'UTC')
      if (!start || !end || end <= start)
        return { propertyId: args.propertyId, timezone, from: args.from, to: args.to, rooms: [], events: [] }
      const R = ctx.table('hospitality_core.Room')
      const S = ctx.table('hospitality_core.Stay')
      const A = ctx.table('hospitality_core.RoomAssignment')
      const rooms = await ctx.db.all(
        from(R)
          .where(eq(R.propertyId, args.propertyId), eq(R.active, true))
          .orderBy(asc(R.name))
          .preload('roomType'),
      )
      const stays = (
        await ctx.db.all(from(S).where(eq(S.propertyId, args.propertyId)).preload('partner', 'reservation'))
      ).filter((stay) => stay.state !== 'cancelled' && overlaps(stay.checkIn, stay.checkOut, start, end))
      const stayIds = new Set(stays.map((stay) => stay.id))
      const assignments = (await ctx.db.all(from(A).where(eq(A.propertyId, args.propertyId)))).filter(
        (assignment) =>
          stayIds.has(assignment.stayId) &&
          overlaps(assignment.startAt, assignment.endAt ?? end.toISOString(), start, end),
      )
      const assigned = new Set(assignments.map((assignment) => assignment.stayId))
      type TapeEvent = {
        id: string
        stayId: string
        reservationId: string | null
        roomId: string | null
        roomTypeId: string
        guest: string
        provider: string
        state: string
        start: string
        end: string
      }
      const events: TapeEvent[] = assignments.map((assignment) => {
        const stay = stays.find((row) => row.id === assignment.stayId)!
        return {
          id: String(assignment.id),
          stayId: String(stay.id),
          reservationId: stay.reservationId ? String(stay.reservationId) : null,
          roomId: assignment.roomId ? String(assignment.roomId) : null,
          roomTypeId: String(assignment.roomTypeId),
          guest: String((stay.partner as Row | undefined)?.name ?? ''),
          provider: String((stay.reservation as Row | undefined)?.provider ?? 'direct'),
          state: String(stay.state),
          start: String(assignment.startAt),
          end: String(assignment.endAt ?? stay.checkOut),
        }
      })
      for (const stay of stays)
        if (!assigned.has(stay.id))
          events.push({
            id: `${String(stay.id)}:unassigned`,
            stayId: String(stay.id),
            reservationId: stay.reservationId ? String(stay.reservationId) : null,
            roomId: null,
            roomTypeId: String(stay.roomTypeId),
            guest: String((stay.partner as Row | undefined)?.name ?? ''),
            provider: String((stay.reservation as Row | undefined)?.provider ?? 'direct'),
            state: String(stay.state),
            start: String(stay.checkIn),
            end: String(stay.checkOut),
          })
      return {
        propertyId: args.propertyId,
        timezone,
        from: start.toISOString(),
        to: end.toISOString(),
        rooms,
        events,
      }
    },
  }),
}
