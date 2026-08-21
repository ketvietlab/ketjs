import { asc, defineFn, defineJob, desc, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, JobContext, JobSpec, Row } from '@ketvietlab/ketjs'
import { addCalendarDays, dateKeyIn, zonedMidnight } from './calendar.ts'
import { occupancyDates } from './inventory.ts'
import { postCharge } from './services.ts'

type AuditContext = Ctx & { signal?: AbortSignal }
type AuditIssue = { field: string; code: string; messageKey: string }
type AuditResult = {
  inHouseCount: number
  servicePosted: number
  rentPosted: number
  existingCount: number
  totalAmount: string
}

const issue = (field: string, code: string): AuditIssue => ({
  field,
  code,
  messageKey: `hospitality_core.validation.${code}`,
})
const success = (id: unknown, extra: Record<string, unknown> = {}) => ({
  ok: true,
  id: String(id),
  errors: [],
  ...extra,
})
const failure = (...errors: AuditIssue[]) => ({ ok: false, errors })
const one = async (ctx: Ctx, model: string, id: unknown): Promise<Row | null> =>
  (await ctx.db.select(model, { id }))[0] ?? null
const validDate = (value: unknown): value is string => /^\d{4}-\d{2}-\d{2}$/u.test(String(value ?? ''))
const calendarDate = (value: unknown): string | null => {
  if (validDate(value)) return String(value)
  const parsed = value instanceof Date ? value : new Date(String(value ?? ''))
  return Number.isFinite(parsed.getTime()) ? dateKeyIn(parsed, 'UTC') : null
}
const isLongStay = (stay: Row): boolean =>
  stay.billingMode === 'recurring' && (stay.bookingType === 'weekly' || stay.bookingType === 'monthly')
const periodDays = (bookingType: unknown): number => (bookingType === 'weekly' ? 7 : 30)
const rentSourceKey = (stay: Row, periodStart: string): string => `rent:${String(stay.id)}:${periodStart}`
const rentDescription = (stay: Row, periodStart: string): string =>
  `room:${String(stay.roomTypeId)}:${String(stay.bookingType)}:${periodStart}`
const abortIfRequested = (ctx: AuditContext): void => {
  if (ctx.signal?.aborted) throw ctx.signal.reason ?? new Error('night audit aborted')
}

const beginRunAttempt = async (ctx: Ctx, runId: string): Promise<number> => {
  for (let retry = 0; retry < 20; retry++) {
    const run = await one(ctx, 'hospitality_core.NightAuditRun', runId)
    if (!run) throw new Error(`night audit run "${runId}" does not exist`)
    const previous = Number(run.attempt ?? 0)
    const attempt = previous + 1
    const changed = await ctx.db.compareAndSet(
      'hospitality_core.NightAuditRun',
      { id: runId },
      { attempt: previous },
      {
        state: 'running',
        attempt,
        startedAt: new Date().toISOString(),
        completedAt: null,
        error: null,
      },
    )
    if ('dryRun' in changed || changed.matched) return attempt
  }
  throw new Error(`night audit run "${runId}" could not acquire an attempt`)
}

const checkedInStays = async (ctx: Ctx, propertyId: string): Promise<Row[]> => {
  const S = ctx.table('hospitality_core.Stay')
  return ctx.db.all(
    from(S).where(eq(S.propertyId, propertyId), eq(S.state, 'checked_in')).orderBy(asc(S.checkIn), asc(S.id)),
  )
}

const serviceStay = (line: Row, byId: Map<string, Row>, byReservation: Map<string, Row>): Row | null => {
  if (line.stayId) return byId.get(String(line.stayId)) ?? null
  if (line.reservationId) return byReservation.get(String(line.reservationId)) ?? null
  return null
}

const dueRentPeriods = (stay: Row, auditDate: string, timezone: string): string[] => {
  if (!isLongStay(stay)) return []
  const checkout = dateKeyIn(new Date(String(stay.checkOut)), timezone)
  let period = calendarDate(stay.nextBillDate) ?? dateKeyIn(new Date(String(stay.checkIn)), timezone)
  const periods: string[] = []
  while (period <= auditDate && period < checkout) {
    periods.push(period)
    period = addCalendarDays(period, periodDays(stay.bookingType))
  }
  return periods
}

const auditSnapshot = async (
  ctx: Ctx,
  property: Row,
  auditDate: string,
): Promise<{
  stays: Row[]
  services: Array<{ line: Row; stay: Row; existing: boolean }>
  rentPeriods: Array<{ stay: Row; periodStart: string; existing: boolean }>
}> => {
  const stays = await checkedInStays(ctx, String(property.id))
  const stayById = new Map(stays.map((stay) => [String(stay.id), stay]))
  const stayByReservation = new Map(
    stays.filter((stay) => stay.reservationId).map((stay) => [String(stay.reservationId), stay]),
  )
  const E = ctx.table('hospitality_core.ExtraLine')
  const lines = await ctx.db.all(
    from(E)
      .where(eq(E.propertyId, property.id), eq(E.active, true), eq(E.recurrence, 'per_night'))
      .orderBy(asc(E.createdAt), asc(E.id)),
  )
  const timezone = String(property.timezone ?? 'UTC')
  const serviceCandidates = lines.flatMap((line) => {
    const stay = serviceStay(line, stayById, stayByReservation)
    if (!stay || !occupancyDates(stay.checkIn, stay.checkOut, timezone).includes(auditDate)) return []
    return [{ line, stay }]
  })
  const rentCandidates = stays.flatMap((stay) =>
    dueRentPeriods(stay, auditDate, timezone).map((periodStart) => ({ stay, periodStart })),
  )
  const sourceKeys = [
    ...serviceCandidates.map(({ line }) => `extra:${String(line.id)}:night:${auditDate}`),
    ...rentCandidates.map(({ stay, periodStart }) => rentSourceKey(stay, periodStart)),
  ]
  const C = ctx.table('hospitality_core.Charge')
  const charges = sourceKeys.length
    ? await ctx.db.all(
        from(C).select(C.sourceKey).where(eq(C.state, 'active'), inArray(C.sourceKey, sourceKeys)),
      )
    : []
  const sources = new Set(charges.map((charge) => String(charge.sourceKey)))
  const services = serviceCandidates.map(({ line, stay }) => ({
    line,
    stay,
    existing: sources.has(`extra:${String(line.id)}:night:${auditDate}`),
  }))
  const rentPeriods = rentCandidates.map(({ stay, periodStart }) => ({
    stay,
    periodStart,
    existing: sources.has(rentSourceKey(stay, periodStart)),
  }))
  return { stays, services, rentPeriods }
}

const postRentPeriod = async (
  ctx: AuditContext,
  stay: Row,
  periodStart: string,
  timezone: string,
  nightAuditRunId?: string,
): Promise<Record<string, unknown>> =>
  postCharge(ctx, {
    id: `${String(stay.id)}:rent:${periodStart}`,
    folioId: stay.folioId,
    stayId: stay.id,
    nightAuditRunId,
    description: rentDescription(stay, periodStart),
    type: 'room',
    quantity: '1',
    unitPrice: stay.rate,
    occurredAt: zonedMidnight(periodStart, timezone).toISOString(),
    serviceDate: periodStart,
    sourceKey: rentSourceKey(stay, periodStart),
  })

/**
 * Complete the first recurring billing period after check-in. The source key
 * makes this repairable when the HTTP request is retried after the stay state
 * has already transitioned.
 */
export const initializeRecurringRent = async (
  ctx: Ctx,
  stay: Row,
  property: Row,
): Promise<Record<string, unknown>> => {
  if (!isLongStay(stay)) return success(stay.id, { scheduled: false })
  if (stay.nextBillDate) return success(stay.id, { scheduled: true, existing: true })
  const timezone = String(property.timezone ?? 'UTC')
  const periodStart = dateKeyIn(new Date(String(stay.checkIn)), timezone)
  let nextBillDate = periodStart
  if (property.longStayBillOnCheckIn !== false) {
    const posted = await postRentPeriod(ctx, stay, periodStart, timezone)
    if (posted.ok !== true) return posted
    nextBillDate = addCalendarDays(periodStart, periodDays(stay.bookingType))
  }
  await ctx.db.update('hospitality_core.Stay', { id: stay.id }, { nextBillDate })
  return success(stay.id, { scheduled: true, nextBillDate })
}

export const executeNightAudit = async (
  ctx: AuditContext,
  args: { runId: string; propertyId: string; auditDate: string },
): Promise<AuditResult> => {
  const property = await one(ctx, 'hospitality_core.Property', args.propertyId)
  if (!property) throw new Error(`night audit property "${args.propertyId}" does not exist`)
  const attempt = await beginRunAttempt(ctx, args.runId)

  try {
    const snapshot = await auditSnapshot(ctx, property, args.auditDate)
    const result: AuditResult = {
      inHouseCount: snapshot.stays.length,
      servicePosted: 0,
      rentPosted: 0,
      existingCount: 0,
      totalAmount: '0',
    }
    const timezone = String(property.timezone ?? 'UTC')

    for (const item of snapshot.services) {
      abortIfRequested(ctx)
      const posted = await postCharge(ctx, {
        id: `${String(item.line.id)}:charge:night:${args.auditDate}`,
        folioId: item.line.folioId,
        stayId: item.stay.id,
        extraLineId: item.line.id,
        nightAuditRunId: args.runId,
        productId: item.line.productId,
        uomId: item.line.uomId,
        description: item.line.description,
        type: 'service',
        quantity: item.line.quantity,
        unitPrice: item.line.unitPrice,
        occurredAt: zonedMidnight(args.auditDate, timezone).toISOString(),
        serviceDate: args.auditDate,
        sourceKey: `extra:${String(item.line.id)}:night:${args.auditDate}`,
      })
      if (posted.ok !== true) throw new Error(`night service posting failed for ${String(item.line.id)}`)
      if (posted.existing === true) result.existingCount += 1
    }

    for (const initial of snapshot.stays.filter(isLongStay)) {
      let stay = initial
      let periodGuard = 0
      while (true) {
        if (periodGuard++ >= 400) throw new Error(`rent schedule did not converge for ${String(stay.id)}`)
        abortIfRequested(ctx)
        const periods = dueRentPeriods(stay, args.auditDate, timezone)
        const periodStart = periods[0]
        if (!periodStart) break
        const posted = await postRentPeriod(ctx, stay, periodStart, timezone, args.runId)
        if (posted.ok !== true) throw new Error(`rent posting failed for ${String(stay.id)}`)
        if (posted.existing === true) result.existingCount += 1
        const nextBillDate = addCalendarDays(periodStart, periodDays(stay.bookingType))
        const changed = await ctx.db.compareAndSet(
          'hospitality_core.Stay',
          { id: stay.id },
          { nextBillDate: stay.nextBillDate ?? null, state: 'checked_in' },
          { nextBillDate },
        )
        stay = (await one(ctx, 'hospitality_core.Stay', stay.id)) ?? stay
        if ('matched' in changed && !changed.matched && stay.state !== 'checked_in') break
      }
    }

    const runCharges = await ctx.db.select('hospitality_core.Charge', {
      nightAuditRunId: args.runId,
      state: 'active',
    })
    result.servicePosted = runCharges.filter((charge) => charge.extraLineId).length
    result.rentPosted = runCharges.filter((charge) => charge.type === 'room').length
    result.totalAmount = String(runCharges.reduce((sum, charge) => sum + Number(charge.amount ?? 0), 0))
    await ctx.db.compareAndSet(
      'hospitality_core.NightAuditRun',
      { id: args.runId },
      { state: 'running', attempt },
      {
        state: 'completed',
        ...result,
        completedAt: new Date().toISOString(),
        error: null,
      },
    )
    return result
  } catch (error) {
    await ctx.db.compareAndSet(
      'hospitality_core.NightAuditRun',
      { id: args.runId },
      { state: 'running', attempt },
      {
        state: 'failed',
        completedAt: new Date().toISOString(),
        error: String(error instanceof Error ? error.message : error).slice(0, 1_000),
      },
    )
    throw error
  }
}

const runOutput = {
  id: 'id',
  propertyId: 'id',
  auditDate: 'date',
  state: 'text',
  inHouseCount: 'int',
  servicePosted: 'int',
  rentPosted: 'int',
  existingCount: 'int',
  totalAmount: 'decimal',
  attempt: 'int',
  requestedAt: 'datetime',
  startedAt: 'datetime?',
  completedAt: 'datetime?',
  error: 'text?',
}

export const nightAuditFunctions: Record<string, FnSpec> = {
  previewNightAudit: defineFn({
    input: { propertyId: 'id', auditDate: 'date' },
    output: {
      propertyId: 'id',
      auditDate: 'date',
      inHouseCount: 'int',
      serviceDue: 'int',
      rentDue: 'int',
      existingCount: 'int',
      estimatedAmount: 'decimal',
    },
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.Stay',
      'read:hospitality_core.ExtraLine',
      'read:hospitality_core.Charge',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const property = await one(ctx, 'hospitality_core.Property', args.propertyId)
      if (!property)
        return {
          propertyId: args.propertyId,
          auditDate: args.auditDate,
          inHouseCount: 0,
          serviceDue: 0,
          rentDue: 0,
          existingCount: 0,
          estimatedAmount: '0',
        }
      const snapshot = await auditSnapshot(ctx, property, String(args.auditDate))
      const newServices = snapshot.services.filter((item) => !item.existing)
      const newRent = snapshot.rentPeriods.filter((item) => !item.existing)
      return {
        propertyId: args.propertyId,
        auditDate: args.auditDate,
        inHouseCount: snapshot.stays.length,
        serviceDue: newServices.length,
        rentDue: newRent.length,
        existingCount:
          snapshot.services.filter((item) => item.existing).length +
          snapshot.rentPeriods.filter((item) => item.existing).length,
        estimatedAmount: String(
          newServices.reduce(
            (sum, item) => sum + Number(item.line.quantity) * Number(item.line.unitPrice),
            0,
          ) + newRent.reduce((sum, item) => sum + Number(item.stay.rate), 0),
        ),
      }
    },
  }),

  listNightAudits: defineFn({
    input: { propertyId: 'id?', limit: 'int?' },
    output: runOutput,
    effects: ['read:hospitality_core.NightAuditRun'],
    agent: true,
    handler: async (ctx, args) => {
      const A = ctx.table('hospitality_core.NightAuditRun')
      let query = from(A).orderBy(desc(A.auditDate), desc(A.requestedAt), desc(A.id))
      if (args.propertyId) query = query.where(eq(A.propertyId, args.propertyId))
      return (await ctx.db.all(query)).slice(0, Math.min(Math.max(Number(args.limit ?? 30), 1), 100))
    },
  }),

  requestNightAudit: defineFn({
    input: { propertyId: 'id', auditDate: 'date' },
    output: { ok: 'bool', id: 'id?', jobId: 'id?', existing: 'bool?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.NightAuditRun',
      'write:hospitality_core.NightAuditRun',
      'enqueue:hospitality_core.nightAudit',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const property = await one(ctx, 'hospitality_core.Property', args.propertyId)
      const auditDate = String(args.auditDate)
      if (!property) return failure(issue('propertyId', 'property_missing'))
      if (!validDate(auditDate)) return failure(issue('auditDate', 'date'))
      if (auditDate > dateKeyIn(new Date(), String(property.timezone ?? 'UTC')))
        return failure(issue('auditDate', 'audit_future'))
      const id = `${String(args.propertyId)}:${auditDate}`
      const requestedAt = new Date().toISOString()
      return ctx.tx(async (tx) => {
        const existing = await one(tx, 'hospitality_core.NightAuditRun', id)
        if (!existing)
          await tx.db.insert('hospitality_core.NightAuditRun', {
            id,
            propertyId: args.propertyId,
            auditDate,
            state: 'queued',
            inHouseCount: 0,
            servicePosted: 0,
            rentPosted: 0,
            existingCount: 0,
            totalAmount: '0',
            attempt: 0,
            requestedAt,
          })
        else if (existing.state !== 'running')
          await tx.db.update(
            'hospitality_core.NightAuditRun',
            { id },
            { state: 'queued', requestedAt, completedAt: null, error: null },
          )
        const queued = await tx.jobs.enqueue(
          'hospitality_core.nightAudit',
          { runId: id, propertyId: args.propertyId, auditDate },
          { uniqueKey: `night-audit:${String(args.propertyId)}:${auditDate}` },
        )
        return success(id, { jobId: queued.id, existing: queued.existing })
      })
    },
  }),
}

export const nightAuditJobs: Record<string, JobSpec> = {
  nightAudit: defineJob({
    queue: 'maintenance',
    input: { runId: 'id', propertyId: 'id', auditDate: 'date' },
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.Stay',
      'write:hospitality_core.Stay',
      'read:hospitality_core.Folio',
      'write:hospitality_core.Folio',
      'read:hospitality_core.ExtraLine',
      'read:hospitality_core.Charge',
      'write:hospitality_core.Charge',
      'read:hospitality_core.NightAuditRun',
      'write:hospitality_core.NightAuditRun',
      'read:product.Product',
      'read:product.Template',
      'read:product.ProductUom',
      'read:uom.Unit',
    ],
    idempotent: true,
    handler: (ctx: JobContext, args) =>
      executeNightAudit(ctx, {
        runId: String(args.runId),
        propertyId: String(args.propertyId),
        auditDate: String(args.auditDate),
      }).then(() => undefined),
  }),
}
