import { asc, defineFn, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import {
  addDecimals,
  canonicalDecimalText,
  compareDecimals,
  moneyMinor,
  minorText,
  multiplyDecimals,
  percentOfMinor,
  scaleOf,
  subtractDecimals,
} from '../account/money.ts'
import {
  BILLING_MODES,
  BOOKING_PROVIDERS,
  BOOKING_TYPES,
  DOCUMENT_TYPES,
  GENDERS,
  OCR_STATES,
  OUT_OF_SERVICE_ROOM_STATUSES,
} from './types.ts'
import { dateKeyIn } from './calendar.ts'
import {
  defaultRatePlan,
  hourlyAvailable,
  InventoryConflict,
  occupancyDates,
  quoteAvailability,
  recordInventoryChange,
  releaseInventory,
  replaceReservedInventory,
  reserveInventory,
  restrictionIssues,
} from './inventory.ts'
import { FolioConflict, postCharge, settleCancelledFolio } from './services.ts'
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
  let rate = ''
  try {
    rate = canonicalDecimalText(String(rateValue ?? '0'))
    if (compareDecimals(rate, '0') < 0) errors.push(issue('rate', 'non_negative'))
  } catch {
    errors.push(issue('rate', 'non_negative'))
  }
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
      amountTotal: multiplyDecimals(String(quantity), rate),
    },
  }
}

/** The cancellation terms in force for a room type, resolved once at booking. */
export const cancellationTerms = async (ctx: Ctx, propertyId: unknown, roomTypeId: unknown): Promise<Row> => {
  const roomType = await record(ctx, 'hospitality_core.RoomType', roomTypeId)
  const property = await record(ctx, 'hospitality_core.Property', propertyId)
  const policyId = roomType?.cancellationPolicyId ?? property?.defaultCancellationPolicyId
  const policy = policyId ? await record(ctx, 'hospitality_core.CancellationPolicy', policyId) : null
  return {
    cancellationPolicyId: policy?.id,
    cancellationPolicyType: policy?.type,
    freeCancellationHours: policy ? Number(policy.freeCancellationHours ?? 0) : undefined,
    penaltyPercent: policy ? String(policy.penaltyPercent ?? '0') : undefined,
  }
}

/**
 * The fee a policy charges for cancelling now. `penaltyPercent` was stored,
 * validated and shown for a long time without anything ever reading it, so a
 * strict or non-refundable rate cancelled exactly like a flexible one.
 */
const cancellationFee = async (
  ctx: Ctx,
  reservation: Row,
  at: Date,
): Promise<{ amount: string; code: string }> => {
  // Reservations booked before the snapshot existed fall back to the live
  // policy; new ones carry their own terms and are immune to later edits.
  const terms = reservation.cancellationPolicyType
    ? reservation
    : await cancellationTerms(ctx, reservation.propertyId, reservation.roomTypeId)
  if (!terms.cancellationPolicyType) return { amount: '0', code: 'policy' }
  const total = canonicalDecimalText(String(reservation.amountTotal ?? '0'))
  if (compareDecimals(total, '0') <= 0) return { amount: '0', code: 'policy' }
  const percent = canonicalDecimalText(
    terms.cancellationPolicyType === 'non_refundable'
      ? '100'
      : at.getTime() >
          new Date(String(reservation.checkIn)).getTime() -
            Number(terms.freeCancellationHours ?? 0) * 3_600_000
        ? String(terms.penaltyPercent ?? '0')
        : '0',
  )
  const code = String(terms.cancellationPolicyType)
  if (compareDecimals(percent, '0') <= 0) return { amount: '0', code }
  const bounded = compareDecimals(percent, '100') > 0 ? '100' : percent
  const company = await record(ctx, 'company.Company', ctx.scope.company)
  const scale = scaleOf(company?.currency)
  return { amount: minorText(percentOfMinor(moneyMinor(total, scale), bounded), scale), code }
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
    if (error instanceof FolioConflict) return failure(error.problem)
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
  provider?: unknown
  excludeReservationId?: unknown
}

/**
 * Hourly, weekly and monthly stays are operating models a property opts into,
 * on both the property and the room type. Selling one the operator never
 * enabled produces a booking the front desk has no process for.
 */
const bookingTypeIssues = (bookingType: string, property: Row | null, roomType: Row | null): Issue[] => {
  const flag = { hourly: 'allowHourly', weekly: 'allowWeekly', monthly: 'allowMonthly' }[bookingType]
  if (!flag) return []
  if (property && property[flag] !== true) return [issue('bookingType', 'property_booking_type_closed')]
  if (roomType && roomType[flag] !== true) return [issue('bookingType', 'room_type_booking_type_closed')]
  return []
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
  errors.push(...bookingTypeIssues(bookingType, property, roomType))
  // A long stay is a contract, not a channel product; the predecessor kept it on
  // the direct desk and nothing downstream is ready to amend one from an OTA.
  if (
    (bookingType === 'weekly' || bookingType === 'monthly') &&
    args.provider != null &&
    String(args.provider) !== 'direct'
  )
    errors.push(issue('provider', 'long_stay_direct_only'))
  if (
    bookingType === 'hourly' &&
    roomType &&
    calculated.schedule &&
    Math.ceil(
      (Date.parse(calculated.schedule.checkOut) - Date.parse(calculated.schedule.checkIn)) / 3_600_000,
    ) < Number(roomType.minHourlyHours ?? 1)
  )
    errors.push(issue('checkOut', 'hourly_minimum_hours', { count: Number(roomType.minHourlyHours ?? 1) }))
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
      // Hourly stays never claim a room-night, so the date ledger cannot bound
      // them. Peak overlap against live reservations is what does.
      minimumAvailable = await hourlyAvailable(
        ctx,
        args.propertyId,
        args.roomTypeId,
        calculated.schedule.checkIn,
        calculated.schedule.checkOut,
        args.excludeReservationId,
      )
      if (minimumAvailable < 1)
        errors.push(
          issue('roomTypeId', 'no_availability_hourly', {
            available: minimumAvailable,
            required: 1,
          }),
        )
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
  companyId: 'id',
  code: 'text',
  propertyId: 'id',
  roomTypeId: 'id',
  ratePlanId: 'id?',
  folioId: 'id',
  stayId: 'id?',
  partnerId: 'id',
  provider: 'text',
  requestKey: 'text?',
  externalId: 'text?',
  channelRef: 'text?',
  bookingType: 'text',
  checkIn: 'datetime',
  checkOut: 'datetime',
  adults: 'int',
  children: 'int',
  infants: 'int?',
  roomQuantity: 'int?',
  rate: 'decimal',
  quantity: 'decimal',
  billingMode: 'text',
  amountTotal: 'decimal',
  currency: 'text?',
  state: 'text',
  cancelReason: 'text?',
  noShowAt: 'datetime?',
  noShowReason: 'text?',
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
  noShowAt: 'datetime?',
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
  // An hourly quote is bounded by overlapping reservations, not by the ledger.
  'read:hospitality_core.Reservation',
]

const bookingEffects = [
  ...reservationQuoteEffects,
  'read:partner.Partner',
  // The cancellation terms are snapshotted onto the reservation at creation.
  'read:hospitality_core.CancellationPolicy',
  'read:hospitality_core.Reservation',
  'write:hospitality_core.Folio',
  'write:hospitality_core.Reservation',
  'write:hospitality_core.Stay',
  'write:hospitality_core.Charge',
  'write:hospitality_core.StayGuest',
  'write:hospitality_core.AvailabilityLedger',
  'write:hospitality_core.InventoryChange',
]

const voidPostedCharge = async (ctx: Ctx, args: Record<string, unknown>) => {
  const reason = text(args.reason)
  if (!reason) return failure(issue('reason', 'required'))
  const voidedAt = date(args.voidedAt)?.toISOString() ?? new Date().toISOString()

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await ctx.tx(async (tx) => {
        const charge = await record(tx, 'hospitality_core.Charge', args.id)
        if (!charge) return failure(issue('id', 'charge_missing'))
        if (charge.folioId !== args.folioId) return failure(issue('folioId', 'folio_mismatch'))
        if (charge.state === 'void') return success(charge.id, { amount: charge.amount, existing: true })
        if (charge.state !== 'active') return failure(issue('id', 'charge_not_active'))

        const folio = await record(tx, 'hospitality_core.Folio', charge.folioId)
        if (!folio) return failure(issue('folioId', 'folio_missing'))
        if (folio.state !== 'open') return failure(issue('folioId', 'folio_not_open'))

        const nextTotal = subtractDecimals(String(folio.amountTotal), String(charge.amount))
        const changedFolio = await tx.db.compareAndSet(
          'hospitality_core.Folio',
          { id: folio.id },
          { state: 'open', version: folio.version },
          { amountTotal: nextTotal, version: Number(folio.version) + 1 },
        )
        if (!('dryRun' in changedFolio) && !changedFolio.matched)
          throw new TransitionConflict(issue('folioId', 'transition_conflict'))

        const changedCharge = await tx.db.compareAndSet(
          'hospitality_core.Charge',
          { id: charge.id },
          { state: 'active' },
          { state: 'void', voidedAt, voidReason: reason },
        )
        if (!('dryRun' in changedCharge) && !changedCharge.matched)
          throw new TransitionConflict(issue('id', 'transition_conflict'))
        return success(charge.id, { amount: charge.amount, amountTotal: nextTotal, existing: false })
      })
    } catch (error) {
      if (!(error instanceof TransitionConflict)) throw error
      if (attempt === 4) return failure(error.problem)
    }
  }
  return failure(issue('id', 'transition_conflict'))
}

/**
 * Close out a reservation whose guest never arrived: the stay ends, the folio
 * closes and the held room-nights go back on sale. Shared so the night audit
 * closes the business date the same way the front desk does by hand.
 */
export const applyNoShow = async (
  ctx: Ctx,
  reservation: Row,
  reason: string,
  at: Date,
): Promise<{ ok: boolean; id?: string; errors: Issue[]; state?: string }> => {
  const timestamp = at.toISOString()
  const property = await record(ctx, 'hospitality_core.Property', reservation.propertyId)
  // A guest who never arrived owes what the cancellation policy says, not the
  // whole stay. The folio used to close with every room night still active on
  // it, so a flexible booking nobody showed up for was billed in full — a
  // no-show is the cancellation the guest never got around to making.
  const fee = await cancellationFee(ctx, reservation, at)
  const inventoryDates =
    reservation.bookingType === 'hourly'
      ? []
      : occupancyDates(reservation.checkIn, reservation.checkOut, String(property?.timezone ?? 'UTC'))
  return ctx.tx(async (tx) => {
    const reservationClaim = await tx.db.compareAndSet(
      'hospitality_core.Reservation',
      { id: reservation.id },
      { state: 'confirmed', updatedAt: reservation.updatedAt },
      { state: 'no_show', noShowAt: timestamp, noShowReason: reason, updatedAt: timestamp },
    )
    if (!('matched' in reservationClaim) || !reservationClaim.matched)
      throw new TransitionConflict(issue('state', 'transition_conflict'))
    if (reservation.stayId) {
      const stayClaim = await tx.db.compareAndSet(
        'hospitality_core.Stay',
        { id: reservation.stayId },
        { state: 'draft' },
        { state: 'no_show', noShowAt: timestamp },
      )
      if (!('matched' in stayClaim) || !stayClaim.matched)
        throw new TransitionConflict(issue('state', 'transition_conflict'))
      await closeHold(tx, reservation.stayId, 'room_hold_no_show')
    }
    const folio = await record(tx, 'hospitality_core.Folio', reservation.folioId)
    if (folio?.state !== 'open') throw new TransitionConflict(issue('folioId', 'folio_not_open'))
    await settleCancelledFolio(tx, {
      folioId: folio.id,
      stayId: reservation.stayId,
      fee: fee.amount,
      chargeId: `${String(reservation.id)}:no_show`,
      sourceKey: `reservation:${String(reservation.id)}:no_show`,
      reason: fee.code,
      kind: 'no_show',
      at: timestamp,
    })
    if (inventoryDates.length) {
      await releaseInventory(
        tx,
        reservation.propertyId,
        reservation.roomTypeId,
        inventoryDates,
        Number(reservation.roomQuantity ?? 1),
      )
      await recordInventoryChange(tx, {
        propertyId: reservation.propertyId,
        roomTypeId: reservation.roomTypeId,
        kind: 'availability',
        dateFrom: inventoryDates[0]!,
        dateTo: inventoryDates.at(-1)!,
        aggregateId: reservation.id,
      })
    }
    return success(reservation.id, { state: 'no_show', noShowFee: fee.amount })
  })
}

/**
 * Put the room's own name on the assignments that carry only its id.
 *
 * `roomName` has been on the assignment row all along and nothing ever filled
 * it, so every screen fell back to printing an id. One read of the rooms named
 * by the assignments in hand is enough for a whole page of them.
 */
const nameAssignedRooms = async (ctx: Ctx, stays: Row[]): Promise<Row[]> => {
  const wanted = new Set<string>()
  for (const stay of stays)
    for (const assignment of (stay.assignments ?? []) as Row[])
      if (assignment.roomId) wanted.add(String(assignment.roomId))
  if (!wanted.size) return stays
  const R = ctx.table('hospitality_core.Room')
  const rooms = await ctx.db.all(from(R).where(inArray(R.id, [...wanted])))
  const names = new Map(rooms.map((room) => [String(room.id), String(room.name ?? room.code ?? room.id)]))
  for (const stay of stays)
    for (const assignment of (stay.assignments ?? []) as Row[])
      assignment.roomName = names.get(String(assignment.roomId)) ?? assignment.roomName

  return stays
}

/**
 * A room is kept for one stay at a time over the nights it is kept for.
 *
 * Room `status` cannot carry this. A room held for next Tuesday is an ordinary
 * available room today and must stay sellable; `occupied` is about now, not
 * about a calendar. So the exclusion lives in the assignment schedule, and this
 * is the question every writer of one has to ask first.
 */
const roomTakenBetween = async (
  ctx: Ctx,
  roomId: unknown,
  startAt: string,
  endAt: string | null,
  exceptStayId?: unknown,
): Promise<boolean> => {
  const A = ctx.table('hospitality_core.RoomAssignment')
  const rows = await ctx.db.all(from(A).where(eq(A.roomId, roomId)))
  return rows.some((row) => {
    if (row.state === 'closed') return false
    if (exceptStayId != null && row.stayId === exceptStayId) return false
    // An assignment with no end is open-ended: a guest in the room now, with no
    // departure recorded yet. It collides with everything from its start on.
    const otherStart = Date.parse(String(row.startAt))
    const otherEnd = row.endAt ? Date.parse(String(row.endAt)) : Number.POSITIVE_INFINITY
    const start = Date.parse(startAt)
    const end = endAt ? Date.parse(endAt) : Number.POSITIVE_INFINITY
    return otherStart < end && otherEnd > start
  })
}

/** The room being kept for this stay, if the desk has chosen one. */
const heldAssignment = async (ctx: Ctx, stayId: unknown): Promise<Row | null> => {
  const A = ctx.table('hospitality_core.RoomAssignment')
  return ctx.db.one(from(A).where(eq(A.stayId, stayId), eq(A.state, 'held')))
}

/**
 * Let go of a room kept for a stay that will not use it.
 *
 * Shared by cancelling, marking a no-show and choosing a different room, so a
 * hold cannot outlive the reason it was made — a room kept for a guest who
 * cancelled in March is a room nobody can be put in until somebody notices.
 */
const closeHold = async (ctx: Ctx, stayId: unknown, reason: string): Promise<void> => {
  const held = await heldAssignment(ctx, stayId)
  if (!held) return
  await ctx.db.update('hospitality_core.RoomAssignment', { id: held.id }, { state: 'closed', reason })
}

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
      const plan = await planReservation(ctx, { ...args, provider })
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
      const terms = await cancellationTerms(ctx, args.propertyId, args.roomTypeId)
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
          // Hourly holds no ledger row, so the only place the race can be closed
          // is here, with the write transaction already open.
          if (plan.bookingType === 'hourly' && schedule) {
            const free = await hourlyAvailable(
              tx,
              args.propertyId,
              args.roomTypeId,
              schedule.checkIn,
              schedule.checkOut,
            )
            if (free < 1)
              throw new TransitionConflict(
                issue('roomTypeId', 'no_availability_hourly', { available: free, required: 1 }),
              )
          }
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
            ...terms,
            provider,
            externalId: args.externalId,
            channelRef: args.channelRef,
            bookingType: plan.bookingType,
            checkIn: schedule.checkIn,
            checkOut: schedule.checkOut,
            adults: Number(args.adults ?? 1),
            children: Number(args.children ?? 0),
            infants: 0,
            roomQuantity: 1,
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
            infants: 0,
            roomQuantity: 1,
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

  amendReservation: defineFn({
    input: {
      id: 'id',
      roomTypeId: 'id',
      partnerId: 'id',
      checkIn: 'datetime',
      checkOut: 'datetime',
      adults: 'int',
      children: 'int',
      rate: 'decimal',
      at: 'datetime?',
    },
    output: { ok: 'bool', id: 'id?', amountTotal: 'decimal?', errors: 'json?' },
    effects: [
      ...reservationQuoteEffects,
      'read:partner.Partner',
      'read:hospitality_core.Reservation',
      'read:hospitality_core.Stay',
      'read:hospitality_core.StayGuest',
      'read:hospitality_core.Folio',
      'read:hospitality_core.Charge',
      'write:hospitality_core.Reservation',
      'write:hospitality_core.Stay',
      'write:hospitality_core.StayGuest',
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
      if (reservation.provider !== 'direct')
        return failure(issue('provider', 'reservation_external_readonly'))
      if (reservation.state !== 'confirmed') return failure(issue('state', 'reservation_cannot_amend'))
      const stay = reservation.stayId ? await record(ctx, 'hospitality_core.Stay', reservation.stayId) : null
      if (stay?.state !== 'draft') return failure(issue('state', 'reservation_cannot_amend'))
      const partner = await record(ctx, 'partner.Partner', args.partnerId)
      const plan = await planReservation(ctx, {
        ...args,
        propertyId: reservation.propertyId,
        bookingType: reservation.bookingType,
        billingMode: reservation.billingMode,
        provider: reservation.provider,
        excludeReservationId: reservation.id,
      })
      const errors = plan.errors.filter((problem) => problem.code !== 'no_availability')
      if (!partner) errors.push(issue('partnerId', 'partner_missing'))
      if (errors.length || !plan.schedule) return failure(...errors)

      const property = plan.property!
      const previousDates =
        reservation.bookingType === 'hourly'
          ? []
          : occupancyDates(reservation.checkIn, reservation.checkOut, String(property.timezone ?? 'UTC'))
      const at = date(args.at)?.toISOString() ?? new Date().toISOString()
      const schedule = plan.schedule
      return transition(() =>
        ctx.tx(async (tx) => {
          const claimed = await tx.db.compareAndSet(
            'hospitality_core.Reservation',
            { id: reservation.id },
            { state: 'confirmed', updatedAt: reservation.updatedAt },
            { updatedAt: at },
          )
          if (!('matched' in claimed) || !claimed.matched)
            throw new TransitionConflict(issue('state', 'transition_conflict'))

          await replaceReservedInventory(
            tx,
            reservation.propertyId,
            reservation.roomTypeId,
            previousDates,
            args.roomTypeId,
            plan.inventoryDates,
            Number(reservation.roomQuantity ?? 1),
          )
          const inventoryChanged =
            reservation.roomTypeId !== args.roomTypeId ||
            previousDates.join(',') !== plan.inventoryDates.join(',')
          if (inventoryChanged && previousDates.length)
            await recordInventoryChange(tx, {
              propertyId: reservation.propertyId,
              roomTypeId: reservation.roomTypeId,
              kind: 'availability',
              dateFrom: previousDates[0]!,
              dateTo: previousDates.at(-1)!,
              aggregateId: reservation.id,
            })
          if (inventoryChanged && plan.inventoryDates.length)
            await recordInventoryChange(tx, {
              propertyId: reservation.propertyId,
              roomTypeId: args.roomTypeId,
              kind: 'availability',
              dateFrom: plan.inventoryDates[0]!,
              dateTo: plan.inventoryDates.at(-1)!,
              aggregateId: reservation.id,
            })

          const changedStay = await tx.db.compareAndSet(
            'hospitality_core.Stay',
            { id: stay.id },
            { state: 'draft' },
            {
              partnerId: args.partnerId,
              roomTypeId: args.roomTypeId,
              checkIn: schedule.checkIn,
              checkOut: schedule.checkOut,
              adults: Number(args.adults),
              children: Number(args.children),
              rate: plan.rate,
            },
          )
          if (!('matched' in changedStay) || !changedStay.matched)
            throw new TransitionConflict(issue('state', 'transition_conflict'))

          await tx.db.update(
            'hospitality_core.Reservation',
            { id: reservation.id },
            {
              partnerId: args.partnerId,
              roomTypeId: args.roomTypeId,
              checkIn: schedule.checkIn,
              checkOut: schedule.checkOut,
              adults: Number(args.adults),
              children: Number(args.children),
              rate: plan.rate,
              quantity: schedule.quantity,
              amountTotal: schedule.amountTotal,
              updatedAt: at,
            },
          )
          const Guest = tx.table('hospitality_core.StayGuest')
          const primaryGuest = await tx.db.one(
            from(Guest).where(eq(Guest.stayId, stay.id), eq(Guest.primary, true)),
          )
          if (primaryGuest)
            await tx.db.update(
              'hospitality_core.StayGuest',
              { id: primaryGuest.id },
              { partnerId: args.partnerId, displayName: partner!.name },
            )

          if (reservation.billingMode === 'upfront') {
            const charge = await record(tx, 'hospitality_core.Charge', `${String(reservation.id)}:room`)
            const folio = await record(tx, 'hospitality_core.Folio', reservation.folioId)
            if (charge?.state !== 'active')
              throw new TransitionConflict(issue('folioId', 'room_charge_missing'))
            if (folio?.state !== 'open') throw new TransitionConflict(issue('folioId', 'folio_not_open'))
            const nextFolioTotal = addDecimals(
              subtractDecimals(String(folio.amountTotal), String(charge.amount)),
              schedule.amountTotal,
            )
            await tx.db.update(
              'hospitality_core.Charge',
              { id: charge.id },
              {
                description: `room:${String(args.roomTypeId)}`,
                quantity: schedule.quantity,
                unitPrice: plan.rate,
                amount: schedule.amountTotal,
              },
            )
            await tx.db.update(
              'hospitality_core.Folio',
              { id: folio.id },
              {
                partnerId: args.partnerId,
                amountTotal: nextFolioTotal,
                version: Number(folio.version) + 1,
              },
            )
          } else {
            await tx.db.update(
              'hospitality_core.Folio',
              { id: reservation.folioId },
              { partnerId: args.partnerId },
            )
          }
          return success(reservation.id, { amountTotal: schedule.amountTotal })
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
    output: { ok: 'bool', id: 'id?', state: 'text?', cancellationFee: 'decimal?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Reservation',
      'read:hospitality_core.Charge',
      'read:hospitality_core.Folio',
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.CancellationPolicy',
      'read:company.Company',
      'read:hospitality_core.Room',
      'read:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.Reservation',
      'write:hospitality_core.Stay',
      'write:hospitality_core.Folio',
      'write:hospitality_core.Charge',
      'write:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.InventoryChange',
      'read:hospitality_core.RoomAssignment',
      'write:hospitality_core.RoomAssignment',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const reservation = await record(ctx, 'hospitality_core.Reservation', args.id)
      if (!reservation) return failure(issue('id', 'reservation_missing'))
      if (reservation.state === 'cancelled') return success(args.id, { state: 'cancelled' })
      if (reservation.state === 'no_show') return success(args.id, { state: 'no_show' })
      if (reservation.state === 'checked_in' || reservation.state === 'checked_out')
        return failure(issue('state', 'reservation_cannot_cancel'))
      const cancelledAt = date(args.at) ?? new Date()
      const at = cancelledAt.toISOString()
      const property = await record(ctx, 'hospitality_core.Property', reservation.propertyId)
      const fee = await cancellationFee(ctx, reservation, cancelledAt)
      const inventoryDates =
        reservation.bookingType === 'hourly'
          ? []
          : occupancyDates(reservation.checkIn, reservation.checkOut, String(property?.timezone ?? 'UTC'))
      return transition(() =>
        ctx.tx(async (tx) => {
          const reservationClaim = await tx.db.compareAndSet(
            'hospitality_core.Reservation',
            { id: args.id },
            { state: reservation.state, updatedAt: reservation.updatedAt },
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
            await closeHold(tx, reservation.stayId, 'room_hold_cancelled')
          }
          await settleCancelledFolio(tx, {
            folioId: reservation.folioId,
            stayId: reservation.stayId,
            fee: fee.amount,
            chargeId: `${String(reservation.id)}:cancellation`,
            sourceKey: `reservation:${String(reservation.id)}:cancellation`,
            reason: fee.code,
            at,
          })
          if (inventoryDates.length)
            await releaseInventory(
              tx,
              reservation.propertyId,
              reservation.roomTypeId,
              inventoryDates,
              Number(reservation.roomQuantity ?? 1),
            )
          if (inventoryDates.length)
            await recordInventoryChange(tx, {
              propertyId: reservation.propertyId,
              roomTypeId: reservation.roomTypeId,
              kind: 'availability',
              dateFrom: inventoryDates[0]!,
              dateTo: inventoryDates.at(-1)!,
              aggregateId: reservation.id,
            })
          return success(args.id, { state: 'cancelled', cancellationFee: fee.amount })
        }),
      )
    },
  }),

  markNoShow: defineFn({
    input: { id: 'id', reason: 'text', at: 'datetime?' },
    output: { ok: 'bool', id: 'id?', state: 'text?', noShowFee: 'decimal?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Reservation',
      'read:hospitality_core.Charge',
      'read:hospitality_core.Folio',
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.CancellationPolicy',
      'read:company.Company',
      'read:hospitality_core.Room',
      'read:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.Reservation',
      'write:hospitality_core.Stay',
      'write:hospitality_core.Folio',
      'write:hospitality_core.Charge',
      'write:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.InventoryChange',
      'read:hospitality_core.RoomAssignment',
      'write:hospitality_core.RoomAssignment',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const reservation = await record(ctx, 'hospitality_core.Reservation', args.id)
      if (!reservation) return failure(issue('id', 'reservation_missing'))
      if (reservation.state === 'no_show') return success(args.id, { state: 'no_show' })
      if (reservation.state !== 'confirmed') return failure(issue('state', 'reservation_cannot_no_show'))
      const reason = text(args.reason)
      if (!reason) return failure(issue('reason', 'required'))
      const at = date(args.at) ?? new Date()
      if (at < date(reservation.checkIn)!) return failure(issue('at', 'reservation_no_show_too_early'))
      return transition(() => applyNoShow(ctx, reservation, reason, at))
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
      'read:hospitality_core.RoomAssignment',
    ],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const S = ctx.table('hospitality_core.Stay')
      let query = from(S)
        .orderBy(asc(S.checkIn))
        .preload('partner', 'roomType', 'currentRoom', 'reservation', 'assignments')
      if (args.propertyId) query = query.where(eq(S.propertyId, args.propertyId))
      if (args.state) query = query.where(eq(S.state, args.state))
      const start = args.from ? date(args.from) : null
      const end = args.to ? date(args.to) : null
      const rows = (await ctx.db.all(query)).filter(
        (row) => (!start || date(row.checkOut)! > start) && (!end || date(row.checkIn)! < end),
      )
      return nameAssignedRooms(ctx, rows)
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
    input: { stayId: 'id', roomId: 'id?', assignmentId: 'id?', at: 'datetime?', earlyReason: 'text?' },
    output: { ok: 'bool', id: 'id?', roomId: 'id?', state: 'text?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Stay',
      'read:hospitality_core.Reservation',
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
      'read:hospitality_core.RoomAssignment',
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
      const reservation = stay.reservationId
        ? await record(ctx, 'hospitality_core.Reservation', stay.reservationId)
        : null
      if (stay.reservationId && !reservation) return failure(issue('state', 'transition_conflict'))
      const at = date(args.at) ?? new Date()
      const property = await record(ctx, 'hospitality_core.Property', stay.propertyId)
      // A guest standing at the desk before check-in time is routine. Refusing
      // outright left the front desk with no move at all, so the arrival is
      // allowed once someone puts a reason against it.
      const early = property?.enforceTimes === true && at < date(stay.checkIn)!
      if (early && !text(args.earlyReason)) return failure(issue('at', 'early_check_in'))

      const R = ctx.table('hospitality_core.Room')
      const held = await heldAssignment(ctx, stay.id)
      let room: Row | null = null
      if (args.roomId) room = await record(ctx, 'hospitality_core.Room', args.roomId)
      // The desk already decided which room this guest gets; arriving is not the
      // moment to decide it again. A clerk who passes a room explicitly still
      // overrides, and the hold is closed either way below.
      else if (held) room = await record(ctx, 'hospitality_core.Room', held.roomId)
      else {
        const candidates = await ctx.db.all(
          from(R).where(
            eq(R.propertyId, stay.propertyId),
            eq(R.roomTypeId, stay.roomTypeId),
            eq(R.status, 'available'),
            eq(R.active, true),
          ),
        )
        // A room kept for somebody arriving later is not a free room now.
        for (const candidate of candidates) {
          if (await roomTakenBetween(ctx, candidate.id, String(stay.checkIn), String(stay.checkOut), stay.id))
            continue
          room = candidate
          break
        }
      }
      if (!room) return failure(issue('roomId', 'no_available_room'))
      if (room.propertyId !== stay.propertyId) return failure(issue('roomId', 'property_mismatch'))
      if (room.roomTypeId !== stay.roomTypeId) return failure(issue('roomId', 'room_type_mismatch'))
      if (room.status !== 'available' || room.active !== true)
        return failure(issue('roomId', 'room_not_available'))
      if (await roomTakenBetween(ctx, room.id, String(stay.checkIn), String(stay.checkOut), stay.id))
        return failure(issue('roomId', 'room_already_held'))

      const assignmentId = args.assignmentId ?? `${String(stay.id)}:assignment:1`
      const transitioned = await transition(() =>
        ctx.tx(async (tx) => {
          if (stay.reservationId) {
            const reservationClaim = await tx.db.compareAndSet(
              'hospitality_core.Reservation',
              { id: stay.reservationId },
              { state: 'confirmed', updatedAt: reservation!.updatedAt },
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
          await closeHold(tx, stay.id, 'room_hold_taken')
          await tx.db.insert('hospitality_core.RoomAssignment', {
            id: assignmentId,
            stayId: stay.id,
            propertyId: stay.propertyId,
            roomId: room!.id,
            roomTypeId: room!.roomTypeId,
            startAt: at.toISOString(),
            state: 'active',
            reason: early ? text(args.earlyReason) : undefined,
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

  adjustStayDeparture: defineFn({
    input: { stayId: 'id', checkOut: 'datetime', at: 'datetime?' },
    output: { ok: 'bool', id: 'id?', checkOut: 'datetime?', amountTotal: 'decimal?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Stay',
      'read:hospitality_core.Reservation',
      'read:hospitality_core.Property',
      'read:hospitality_core.Room',
      'read:hospitality_core.Folio',
      'read:hospitality_core.Charge',
      'read:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.Stay',
      'write:hospitality_core.Reservation',
      'write:hospitality_core.Folio',
      'write:hospitality_core.Charge',
      'write:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.InventoryChange',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const stay = await record(ctx, 'hospitality_core.Stay', args.stayId)
      if (!stay) return failure(issue('stayId', 'stay_missing'))
      if (stay.state !== 'checked_in') return failure(issue('state', 'stay_cannot_adjust_departure'))
      const reservation = stay.reservationId
        ? await record(ctx, 'hospitality_core.Reservation', stay.reservationId)
        : null
      if (reservation?.state !== 'checked_in') return failure(issue('state', 'transition_conflict'))
      const property = await record(ctx, 'hospitality_core.Property', stay.propertyId)
      if (!property) return failure(issue('propertyId', 'property_missing'))
      const calculated = scheduleOf(
        stay.bookingType,
        stay.checkIn,
        args.checkOut,
        stay.rate,
        String(property.timezone ?? 'UTC'),
      )
      if (calculated.errors.length || !calculated.schedule) return failure(...calculated.errors)
      const schedule = calculated.schedule
      if (schedule.checkOut === new Date(String(stay.checkOut)).toISOString())
        return success(stay.id, { checkOut: schedule.checkOut, amountTotal: schedule.amountTotal })
      const at = date(args.at) ?? new Date()
      if (date(schedule.checkOut)! <= at) return failure(issue('checkOut', 'departure_not_future'))
      const previousDates =
        stay.bookingType === 'hourly'
          ? []
          : occupancyDates(stay.checkIn, stay.checkOut, String(property.timezone ?? 'UTC'))
      const nextDates =
        stay.bookingType === 'hourly'
          ? []
          : occupancyDates(stay.checkIn, schedule.checkOut, String(property.timezone ?? 'UTC'))
      const timestamp = at.toISOString()
      return transition(() =>
        ctx.tx(async (tx) => {
          const reservationClaim = await tx.db.compareAndSet(
            'hospitality_core.Reservation',
            { id: reservation.id },
            { state: 'checked_in', updatedAt: reservation.updatedAt },
            {
              checkOut: schedule.checkOut,
              quantity: schedule.quantity,
              amountTotal: schedule.amountTotal,
              updatedAt: timestamp,
            },
          )
          if (!('matched' in reservationClaim) || !reservationClaim.matched)
            throw new TransitionConflict(issue('state', 'transition_conflict'))
          const stayClaim = await tx.db.compareAndSet(
            'hospitality_core.Stay',
            { id: stay.id },
            { state: 'checked_in', checkOut: stay.checkOut },
            { checkOut: schedule.checkOut },
          )
          if (!('matched' in stayClaim) || !stayClaim.matched)
            throw new TransitionConflict(issue('state', 'transition_conflict'))
          await replaceReservedInventory(
            tx,
            stay.propertyId,
            stay.roomTypeId,
            previousDates,
            stay.roomTypeId,
            nextDates,
            Number(stay.roomQuantity ?? 1),
          )
          if (previousDates.join(',') !== nextDates.join(',')) {
            const changedDates = [...previousDates, ...nextDates].sort()
            if (changedDates.length)
              await recordInventoryChange(tx, {
                propertyId: stay.propertyId,
                roomTypeId: stay.roomTypeId,
                kind: 'availability',
                dateFrom: changedDates[0]!,
                dateTo: changedDates.at(-1)!,
                aggregateId: reservation.id,
              })
          }
          if (stay.billingMode === 'upfront') {
            const charge = await record(tx, 'hospitality_core.Charge', `${String(reservation.id)}:room`)
            const folio = await record(tx, 'hospitality_core.Folio', stay.folioId)
            if (charge?.state !== 'active')
              throw new TransitionConflict(issue('folioId', 'room_charge_missing'))
            if (folio?.state !== 'open') throw new TransitionConflict(issue('folioId', 'folio_not_open'))
            const nextFolioTotal = addDecimals(
              subtractDecimals(String(folio.amountTotal), String(charge.amount)),
              schedule.amountTotal,
            )
            await tx.db.update(
              'hospitality_core.Charge',
              { id: charge.id },
              { quantity: schedule.quantity, amount: schedule.amountTotal },
            )
            const folioClaim = await tx.db.compareAndSet(
              'hospitality_core.Folio',
              { id: folio.id },
              { state: 'open', version: folio.version },
              { amountTotal: nextFolioTotal, version: Number(folio.version) + 1 },
            )
            if (!('matched' in folioClaim) || !folioClaim.matched)
              throw new TransitionConflict(issue('folioId', 'transition_conflict'))
          }
          return success(stay.id, { checkOut: schedule.checkOut, amountTotal: schedule.amountTotal })
        }),
      )
    },
  }),

  /**
   * Keep a named room for a guest who has not arrived.
   *
   * Availability is counted per room type per night, and the reservation has
   * already taken one of those. Holding a specific room takes nothing further —
   * it only says which room the guest walks into — so this never touches the
   * ledger. What it does take is the room itself, for those nights, from
   * everybody else.
   */
  holdRoom: defineFn({
    input: { stayId: 'id', roomId: 'id', reason: 'text?' },
    output: { ok: 'bool', id: 'id?', roomId: 'id?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Stay',
      'read:hospitality_core.Room',
      'read:hospitality_core.RoomAssignment',
      'write:hospitality_core.RoomAssignment',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const stay = await record(ctx, 'hospitality_core.Stay', args.stayId)
      if (!stay) return failure(issue('stayId', 'stay_missing'))
      // A guest already in a room has one; changing it is `moveRoom`, which
      // knows how to hand the old room back to housekeeping.
      if (stay.state !== 'draft') return failure(issue('state', 'stay_cannot_hold_room'))
      const room = await record(ctx, 'hospitality_core.Room', args.roomId)
      if (!room) return failure(issue('roomId', 'room_missing'))
      if (room.propertyId !== stay.propertyId) return failure(issue('roomId', 'property_mismatch'))
      if (room.roomTypeId !== stay.roomTypeId) return failure(issue('roomId', 'room_type_mismatch'))
      if (room.active !== true || oneOf(OUT_OF_SERVICE_ROOM_STATUSES, room.status))
        return failure(issue('roomId', 'room_not_available'))

      const startAt = String(stay.checkIn)
      const endAt = String(stay.checkOut)
      if (await roomTakenBetween(ctx, room.id, startAt, endAt, stay.id))
        return failure(issue('roomId', 'room_already_held'))

      const id = `${String(stay.id)}:hold`
      return transition(() =>
        ctx.tx(async (tx) => {
          // One hold to a stay: choosing again replaces the choice rather than
          // quietly keeping two rooms for one guest.
          const existing = await heldAssignment(tx, stay.id)
          if (existing && existing.id !== id)
            await tx.db.update(
              'hospitality_core.RoomAssignment',
              { id: existing.id },
              { state: 'closed', reason: 'room_hold_replaced' },
            )
          const values = {
            stayId: stay.id,
            propertyId: stay.propertyId,
            roomId: room.id,
            roomTypeId: room.roomTypeId,
            startAt,
            endAt,
            state: 'held',
            reason: text(args.reason) || undefined,
          }
          const current = await record(tx, 'hospitality_core.RoomAssignment', id)
          if (current) await tx.db.update('hospitality_core.RoomAssignment', { id }, values)
          else await tx.db.insert('hospitality_core.RoomAssignment', { id, ...values })
          return success(id, { roomId: room.id })
        }),
      )
    },
  }),

  /** Give back a room kept for a guest, without cancelling anything else. */
  releaseRoomHold: defineFn({
    input: { stayId: 'id', reason: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:hospitality_core.RoomAssignment', 'write:hospitality_core.RoomAssignment'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const held = await heldAssignment(ctx, args.stayId)
      if (!held) return success(args.stayId)
      await closeHold(ctx, args.stayId, text(args.reason) || 'room_hold_released')
      return success(held.id)
    },
  }),

  moveRoom: defineFn({
    input: {
      stayId: 'id',
      roomId: 'id',
      assignmentId: 'id',
      reason: 'text?',
      at: 'datetime?',
      allowRoomTypeChange: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', roomId: 'id?', roomTypeId: 'id?', state: 'text?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Stay',
      'read:hospitality_core.Room',
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomAssignment',
      'read:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.Room',
      'write:hospitality_core.Stay',
      'write:hospitality_core.RoomAssignment',
      'write:hospitality_core.CleaningTask',
      'write:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.InventoryChange',
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
      if (room.id === stay.currentRoomId)
        return success(stay.id, { roomId: room.id, roomTypeId: stay.roomTypeId, state: 'checked_in' })
      // An upgrade re-prices nothing by itself, but it does move room-nights
      // between two sellable products. Both belong to whoever authorised it.
      const changesRoomType = room.roomTypeId !== stay.roomTypeId
      if (changesRoomType && args.allowRoomTypeChange !== true)
        return failure(issue('roomId', 'room_type_change_not_allowed'))
      const A = ctx.table('hospitality_core.RoomAssignment')
      const current = await ctx.db.one(
        from(A).where(eq(A.stayId, stay.id), eq(A.roomId, stay.currentRoomId), eq(A.state, 'active')),
      )
      if (!current) return failure(issue('stayId', 'active_assignment_missing'))
      const at = date(args.at) ?? new Date()
      if (at <= date(current.startAt)!) return failure(issue('at', 'assignment_order'))
      const property = await record(ctx, 'hospitality_core.Property', stay.propertyId)
      const timezone = String(property?.timezone ?? 'UTC')
      // Nights already slept stay charged to the room type that hosted them;
      // only the remainder of the stay moves.
      const movedDates =
        changesRoomType && stay.bookingType !== 'hourly'
          ? occupancyDates(stay.checkIn, stay.checkOut, timezone).filter(
              (value) => value >= dateKeyIn(at, timezone),
            )
          : []

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
          await tx.db.insert('hospitality_core.CleaningTask', {
            id: `move:${String(current.id)}:clean`,
            code: `HK-${String(stay.code)}-MOVE`,
            propertyId: stay.propertyId,
            roomId: stay.currentRoomId,
            stayId: stay.id,
            taskType: 'daily_clean',
            priority: 'normal',
            state: 'todo',
            requestedAt: at.toISOString(),
            notes: args.reason,
          })
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
          if (movedDates.length) {
            await replaceReservedInventory(
              tx,
              stay.propertyId,
              stay.roomTypeId,
              movedDates,
              room.roomTypeId,
              movedDates,
              Number(stay.roomQuantity ?? 1),
            )
            const sorted = [...movedDates].sort()
            for (const roomTypeId of [stay.roomTypeId, room.roomTypeId])
              await recordInventoryChange(tx, {
                propertyId: stay.propertyId,
                roomTypeId,
                kind: 'availability',
                dateFrom: sorted[0]!,
                dateTo: sorted.at(-1)!,
                aggregateId: stay.reservationId ?? stay.id,
              })
          }
          return success(stay.id, { roomId: room.id, roomTypeId: room.roomTypeId, state: 'checked_in' })
        }),
      )
    },
  }),

  checkOut: defineFn({
    input: { stayId: 'id', at: 'datetime?', lateReason: 'text?' },
    output: {
      ok: 'bool',
      id: 'id?',
      roomId: 'id?',
      state: 'text?',
      inventoryReleased: 'int?',
      errors: 'json?',
    },
    effects: [
      'read:hospitality_core.Stay',
      'read:hospitality_core.Property',
      'read:hospitality_core.Room',
      'read:hospitality_core.RoomAssignment',
      'read:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.Room',
      'write:hospitality_core.Stay',
      'write:hospitality_core.Reservation',
      'write:hospitality_core.Folio',
      'write:hospitality_core.RoomAssignment',
      'write:hospitality_core.CleaningTask',
      'write:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.InventoryChange',
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
      const property = await record(ctx, 'hospitality_core.Property', stay.propertyId)
      if (!property) return failure(issue('propertyId', 'property_missing'))
      // The departure side had no policy at all, so a stay could be closed hours
      // past checkout with nothing recorded and nothing to charge against.
      if (property.enforceTimes === true && at > date(stay.checkOut)! && !text(args.lateReason))
        return failure(issue('at', 'late_check_out'))
      const remainingInventoryDates =
        stay.bookingType === 'hourly'
          ? []
          : occupancyDates(stay.checkIn, stay.checkOut, String(property.timezone ?? 'UTC')).filter(
              (value) => value >= dateKeyIn(at, String(property.timezone ?? 'UTC')),
            )
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
          if (remainingInventoryDates.length) {
            await releaseInventory(
              tx,
              stay.propertyId,
              stay.roomTypeId,
              remainingInventoryDates,
              Number(stay.roomQuantity ?? 1),
            )
            await recordInventoryChange(tx, {
              propertyId: stay.propertyId,
              roomTypeId: stay.roomTypeId,
              kind: 'availability',
              dateFrom: remainingInventoryDates[0]!,
              dateTo: remainingInventoryDates.at(-1)!,
              aggregateId: stay.reservationId ?? stay.id,
            })
          }
          return success(stay.id, {
            roomId: stay.currentRoomId,
            state: 'checked_out',
            inventoryReleased: remainingInventoryDates.length,
          })
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
      productId: 'id?',
      uomId: 'id?',
      description: 'text',
      type: 'text?',
      fulfillmentKind: 'text?',
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
      'read:product.Product',
      'read:product.Template',
      'read:product.ProductUom',
      'read:uom.Unit',
      'write:hospitality_core.Folio',
      'write:hospitality_core.Charge',
    ],
    idempotent: true,
    agent: true,
    handler: postCharge,
  }),

  voidCharge: defineFn({
    input: { id: 'id', folioId: 'id', reason: 'text', voidedAt: 'datetime?' },
    output: {
      ok: 'bool',
      id: 'id?',
      amount: 'decimal?',
      amountTotal: 'decimal?',
      existing: 'bool?',
      errors: 'json?',
    },
    effects: [
      'read:hospitality_core.Folio',
      'read:hospitality_core.Charge',
      'write:hospitality_core.Folio',
      'write:hospitality_core.Charge',
    ],
    idempotent: true,
    agent: true,
    handler: voidPostedCharge,
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
      partner: 'json?',
      charges: 'json?',
      stays: 'json?',
    },
    effects: [
      'read:hospitality_core.Folio',
      'read:partner.Partner',
      'read:hospitality_core.Charge',
      'read:hospitality_core.Stay',
    ],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const F = ctx.table('hospitality_core.Folio')
      return ctx.db.one(from(F).where(eq(F.id, args.id)).preload('partner', 'charges', 'stays'))
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
      'read:hospitality_core.StayGuest',
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
      const existing = await record(ctx, 'hospitality_core.GuestDocument', args.id)
      const errors: Issue[] = []
      if (!partner) errors.push(issue('partnerId', 'partner_missing'))
      if (args.stayId && !stay) errors.push(issue('stayId', 'stay_missing'))
      if (stay) {
        const G = ctx.table('hospitality_core.StayGuest')
        const registered = await ctx.db.one(
          from(G).where(eq(G.stayId, stay.id), eq(G.partnerId, args.partnerId)),
        )
        if (!registered) errors.push(issue('partnerId', 'guest_not_registered'))
      }
      if (
        existing &&
        (existing.partnerId !== args.partnerId || String(existing.stayId ?? '') !== String(args.stayId ?? ''))
      )
        errors.push(issue('id', 'document_owner_immutable'))
      if (!oneOf(DOCUMENT_TYPES, args.type)) errors.push(issue('type', 'document_type'))
      if (!text(args.fullName)) errors.push(issue('fullName', 'required'))
      if (args.gender && !oneOf(GENDERS, args.gender)) errors.push(issue('gender', 'gender'))
      const ocrState = String(args.ocrState ?? 'pending')
      if (!oneOf(OCR_STATES, ocrState)) errors.push(issue('ocrState', 'ocr_state'))
      for (const field of ['frontAttachmentId', 'backAttachmentId'] as const)
        if (args[field] && !(await record(ctx, 'storage.Attachment', args[field])))
          errors.push(issue(field, 'attachment_missing'))
      if (errors.length) return failure(...errors)
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
      numberLast4: 'text?',
      fullName: 'text',
      nationality: 'text?',
      ocrState: 'text',
      dateOfBirthPresent: 'bool',
    },
    effects: ['read:hospitality_core.GuestDocument'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const D = ctx.table('hospitality_core.GuestDocument')
      let query = from(D).orderBy(asc(D.fullName))
      if (args.stayId) query = query.where(eq(D.stayId, args.stayId))
      if (args.partnerId) query = query.where(eq(D.partnerId, args.partnerId))
      return (await ctx.db.all(query)).map((row) => ({
        ...row,
        numberLast4: text(row.number).slice(-4) || undefined,
        dateOfBirthPresent: date(row.dateOfBirth) !== null,
      }))
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
      ).filter(
        (stay) =>
          stay.state !== 'cancelled' &&
          stay.state !== 'no_show' &&
          overlaps(stay.checkIn, stay.checkOut, start, end),
      )
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
