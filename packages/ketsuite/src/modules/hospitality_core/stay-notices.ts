import { createHash } from 'node:crypto'
import { asc, defineFn, defineJob, desc, eq, from } from 'ketjs'
import type { Ctx, FnSpec, JobContext, JobSpec, Row } from 'ketjs'
import { addCalendarDays, dateKeyIn, zonedDateTime } from './calendar.ts'
import { STAY_NOTICE_CHANNELS, STAY_NOTICE_REASONS } from './types.ts'

type NoticeContext = Ctx & { signal?: AbortSignal }
type NoticeIssue = { field: string; code: string; messageKey: string }

const issue = (field: string, code: string): NoticeIssue => ({
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
const failure = (...errors: NoticeIssue[]) => ({ ok: false, errors })
const text = (value: unknown): string => String(value ?? '').trim()
const dateOnly = (value: unknown): string => {
  const date = value instanceof Date ? value : new Date(String(value ?? ''))
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : ''
}
const one = async (ctx: Ctx, model: string, id: unknown): Promise<Row | null> =>
  (await ctx.db.select(model, { id }))[0] ?? null
const abortIfRequested = (ctx: NoticeContext): void => {
  if (ctx.signal?.aborted) throw ctx.signal.reason ?? new Error('stay notice preparation aborted')
}
const isOneOf = (values: readonly string[], value: unknown): boolean => values.includes(String(value))

const propertyAddress = (property: Row): string =>
  [
    property.street1,
    property.street2,
    property.divisionText,
    property.locality,
    property.postalCode,
    property.countryCode,
  ]
    .map(text)
    .filter(Boolean)
    .join(', ')

export const stayNoticeDueAt = (checkInValue: unknown, timezone: string): string => {
  const checkIn = new Date(String(checkInValue ?? ''))
  if (!Number.isFinite(checkIn.getTime())) throw new Error('stay notice check-in is invalid')
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(checkIn)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  const key = dateKeyIn(checkIn, timezone)
  const afterEleven = Number(parts.hour) >= 23
  return zonedDateTime(
    afterEleven ? addCalendarDays(key, 1) : key,
    afterEleven ? 8 : 23,
    0,
    timezone,
  ).toISOString()
}

const documentFor = async (ctx: Ctx, stayId: unknown, partnerId: unknown): Promise<Row | null> => {
  if (!partnerId) return null
  const byStay = await ctx.db.select('hospitality_core.GuestDocument', { stayId, partnerId })
  const byPartner = await ctx.db.select('hospitality_core.GuestDocument', { partnerId })
  const documents = [
    ...byStay,
    ...byPartner.filter((candidate) => !byStay.some((row) => row.id === candidate.id)),
  ]
  return (
    documents.sort((left, right) => {
      const score = (row: Row): number =>
        (row.stayId === stayId ? 4 : 0) + (text(row.number) ? 2 : 0) + (row.ocrState === 'done' ? 1 : 0)
      return score(right) - score(left) || String(left.id).localeCompare(String(right.id))
    })[0] ?? null
  )
}

export const stayNoticeDurationValid = (checkInValue: unknown, checkOutValue: unknown): boolean => {
  const checkIn = new Date(String(checkInValue ?? ''))
  const checkOut = new Date(String(checkOutValue ?? ''))
  return (
    Number.isFinite(checkIn.getTime()) &&
    Number.isFinite(checkOut.getTime()) &&
    checkOut.getTime() > checkIn.getTime() &&
    checkOut.getTime() - checkIn.getTime() <= 30 * 86_400_000
  )
}

const preparationIssues = (property: Row, stay: Row, guest: Row, document: Row | null): string[] => {
  const issues: string[] = []
  if (!guest.partnerId) issues.push('guest_partner_missing')
  if (!document) issues.push('document_missing')
  else {
    if (!text(document.number)) issues.push('document_number_missing')
    if (!dateOnly(document.dateOfBirth)) issues.push('document_birth_date_missing')
  }
  if (!text(property.street1) || !propertyAddress(property)) issues.push('property_address_missing')
  if (!stayNoticeDurationValid(stay.checkedInAt ?? stay.checkIn, stay.checkOut))
    issues.push('stay_duration_over_30_days')
  return issues
}

const noticeId = (stayId: unknown, stayGuestId: unknown): string =>
  `${String(stayId)}:notice:${String(stayGuestId)}`

export const prepareStayNotices = async (ctx: NoticeContext, stayId: string): Promise<number> => {
  const stay = await one(ctx, 'hospitality_core.Stay', stayId)
  if (!stay) throw new Error(`stay notice stay "${stayId}" does not exist`)
  if (stay.state !== 'checked_in' && stay.state !== 'checked_out') return 0
  const property = await one(ctx, 'hospitality_core.Property', stay.propertyId)
  if (!property) throw new Error(`stay notice property "${String(stay.propertyId)}" does not exist`)
  const G = ctx.table('hospitality_core.StayGuest')
  const guests = await ctx.db.all(from(G).where(eq(G.stayId, stay.id)).orderBy(asc(G.id)))
  const timezone = String(property.timezone ?? 'UTC')
  const now = new Date().toISOString()
  let prepared = 0

  for (const guest of guests) {
    abortIfRequested(ctx)
    const id = noticeId(stay.id, guest.id)
    const existing = await one(ctx, 'hospitality_core.StayNotice', id)
    if (existing?.state === 'submitted' || existing?.state === 'confirmed') continue
    const document = await documentFor(ctx, stay.id, guest.partnerId)
    const issueCodes = preparationIssues(property, stay, guest, document)
    const values = {
      propertyId: stay.propertyId,
      stayId: stay.id,
      stayGuestId: guest.id,
      partnerId: guest.partnerId,
      documentId: document?.id,
      state: issueCodes.length ? 'attention' : 'ready',
      reason: existing?.reason && isOneOf(STAY_NOTICE_REASONS, existing.reason) ? existing.reason : undefined,
      dueAt: stayNoticeDueAt(stay.checkedInAt ?? stay.checkIn, timezone),
      guestName: text(document?.fullName) || text(guest.displayName),
      documentType: document?.type,
      documentLast4: text(document?.number).slice(-4) || undefined,
      issueCodes,
      attempt: Number(existing?.attempt ?? 0) + 1,
      preparedAt: now,
      updatedAt: now,
    }
    if (existing)
      await ctx.db.compareAndSet(
        'hospitality_core.StayNotice',
        { id },
        { state: existing.state, attempt: existing.attempt },
        values,
      )
    else
      await ctx.db.insertIfAbsent('hospitality_core.StayNotice', {
        id,
        ...values,
        createdAt: now,
      })
    prepared += 1
  }
  return prepared
}

const submissionPackage = async (ctx: Ctx, notice: Row): Promise<{ issues: string[]; hash: string }> => {
  const stay = await one(ctx, 'hospitality_core.Stay', notice.stayId)
  const guest = await one(ctx, 'hospitality_core.StayGuest', notice.stayGuestId)
  const property = await one(ctx, 'hospitality_core.Property', notice.propertyId)
  const document = notice.documentId
    ? await one(ctx, 'hospitality_core.GuestDocument', notice.documentId)
    : guest
      ? await documentFor(ctx, notice.stayId, guest.partnerId)
      : null
  if (!stay || !guest || !property) return { issues: ['notice_source_missing'], hash: '' }
  const issues = preparationIssues(property, stay, guest, document)
  const payload = {
    version: 1,
    guestName: text(document?.fullName) || text(guest.displayName),
    dateOfBirth: dateOnly(document?.dateOfBirth),
    identityType: text(document?.type),
    identityNumber: text(document?.number),
    reason: text(notice.reason),
    stayFrom: new Date(String(stay.checkedInAt ?? stay.checkIn)).toISOString(),
    stayTo: new Date(String(stay.checkOut)).toISOString(),
    address: propertyAddress(property),
    roomId: text(stay.currentRoomId),
  }
  return {
    issues,
    hash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
  }
}

const noticeOutput = {
  id: 'id',
  propertyId: 'id',
  stayId: 'id',
  stayGuestId: 'id',
  state: 'text',
  reason: 'text?',
  dueAt: 'datetime',
  guestName: 'text',
  documentType: 'text?',
  documentLast4: 'text?',
  issueCodes: 'json',
  attempt: 'int',
  preparedAt: 'datetime?',
  submissionChannel: 'text?',
  submittedAt: 'datetime?',
  submittedBy: 'text?',
  receiptRef: 'text?',
  confirmedAt: 'datetime?',
  confirmedBy: 'text?',
}

export const stayNoticeFunctions: Record<string, FnSpec> = {
  listStayNotices: defineFn({
    input: { propertyId: 'id?', state: 'text?', limit: 'int?' },
    output: noticeOutput,
    effects: ['read:hospitality_core.StayNotice'],
    agent: true,
    handler: async (ctx, args) => {
      const N = ctx.table('hospitality_core.StayNotice')
      let query = from(N).orderBy(asc(N.dueAt), desc(N.updatedAt), asc(N.id))
      if (args.propertyId) query = query.where(eq(N.propertyId, args.propertyId))
      if (args.state) query = query.where(eq(N.state, args.state))
      return (await ctx.db.all(query)).slice(0, Math.min(Math.max(Number(args.limit ?? 100), 1), 500))
    },
  }),

  requestStayNoticeRefresh: defineFn({
    input: { stayId: 'id' },
    output: { ok: 'bool', id: 'id?', jobId: 'id?', existing: 'bool?', errors: 'json?' },
    effects: ['read:hospitality_core.Stay', 'enqueue:hospitality_core.prepareStayNotices'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const stay = await one(ctx, 'hospitality_core.Stay', args.stayId)
      if (!stay) return failure(issue('stayId', 'stay_missing'))
      if (stay.state !== 'checked_in' && stay.state !== 'checked_out')
        return failure(issue('state', 'stay_notice_stay_state'))
      const queued = await ctx.jobs.enqueue(
        'hospitality_core.prepareStayNotices',
        { stayId: args.stayId },
        { uniqueKey: `stay-notices:${String(args.stayId)}` },
      )
      return success(args.stayId, { jobId: queued.id, existing: queued.existing })
    },
  }),

  recordStayNoticeSubmission: defineFn({
    input: { id: 'id', reason: 'text', channel: 'text', evidenceRef: 'text' },
    output: { ok: 'bool', id: 'id?', state: 'text?', errors: 'json?' },
    effects: [
      'read:hospitality_core.StayNotice',
      'write:hospitality_core.StayNotice',
      'read:hospitality_core.Stay',
      'read:hospitality_core.StayGuest',
      'read:hospitality_core.Property',
      'read:hospitality_core.GuestDocument',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const notice = await one(ctx, 'hospitality_core.StayNotice', args.id)
      if (!notice) return failure(issue('id', 'stay_notice_missing'))
      if (notice.state === 'confirmed') return success(notice.id, { state: notice.state })
      if (notice.state === 'submitted') return success(notice.id, { state: notice.state })
      if (!ctx.actor) return failure(issue('actor', 'authentication_required'))
      if (!isOneOf(STAY_NOTICE_REASONS, args.reason)) return failure(issue('reason', 'stay_notice_reason'))
      if (!isOneOf(STAY_NOTICE_CHANNELS, args.channel))
        return failure(issue('channel', 'stay_notice_channel'))
      const evidenceRef = text(args.evidenceRef)
      if (!evidenceRef) return failure(issue('evidenceRef', 'required'))
      const source = await submissionPackage(ctx, { ...notice, reason: args.reason })
      if (source.issues.length) return failure(issue('state', 'stay_notice_not_ready'))
      const now = new Date().toISOString()
      const changed = await ctx.db.compareAndSet(
        'hospitality_core.StayNotice',
        { id: notice.id },
        { state: notice.state },
        {
          state: 'submitted',
          reason: args.reason,
          submissionChannel: args.channel,
          packageHash: source.hash,
          submittedAt: now,
          submittedBy: ctx.actor,
          receiptRef: evidenceRef,
          updatedAt: now,
        },
      )
      if (!('dryRun' in changed) && !changed.matched) {
        const latest = await one(ctx, 'hospitality_core.StayNotice', notice.id)
        if (latest?.state === 'submitted' || latest?.state === 'confirmed')
          return success(notice.id, { state: latest.state })
        return failure(issue('state', 'transition_conflict'))
      }
      return success(notice.id, { state: 'submitted' })
    },
  }),

  confirmStayNotice: defineFn({
    input: { id: 'id', receiptRef: 'text' },
    output: { ok: 'bool', id: 'id?', state: 'text?', errors: 'json?' },
    effects: ['read:hospitality_core.StayNotice', 'write:hospitality_core.StayNotice'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const notice = await one(ctx, 'hospitality_core.StayNotice', args.id)
      if (!notice) return failure(issue('id', 'stay_notice_missing'))
      if (notice.state === 'confirmed') return success(notice.id, { state: notice.state })
      if (notice.state !== 'submitted') return failure(issue('state', 'stay_notice_not_submitted'))
      if (!ctx.actor) return failure(issue('actor', 'authentication_required'))
      const receiptRef = text(args.receiptRef) || text(notice.receiptRef)
      if (!receiptRef) return failure(issue('receiptRef', 'required'))
      const now = new Date().toISOString()
      const changed = await ctx.db.compareAndSet(
        'hospitality_core.StayNotice',
        { id: notice.id },
        { state: 'submitted' },
        {
          state: 'confirmed',
          receiptRef,
          confirmedAt: now,
          confirmedBy: ctx.actor,
          updatedAt: now,
        },
      )
      if (!('dryRun' in changed) && !changed.matched) {
        const latest = await one(ctx, 'hospitality_core.StayNotice', notice.id)
        if (latest?.state === 'confirmed') return success(notice.id, { state: latest.state })
        return failure(issue('state', 'transition_conflict'))
      }
      return success(notice.id, { state: 'confirmed' })
    },
  }),
}

export const stayNoticeJobs: Record<string, JobSpec> = {
  prepareStayNotices: defineJob({
    queue: 'maintenance',
    input: { stayId: 'id' },
    effects: [
      'read:hospitality_core.Stay',
      'read:hospitality_core.Property',
      'read:hospitality_core.StayGuest',
      'read:hospitality_core.GuestDocument',
      'read:hospitality_core.StayNotice',
      'write:hospitality_core.StayNotice',
    ],
    idempotent: true,
    handler: (ctx: JobContext, args) => prepareStayNotices(ctx, String(args.stayId)).then(() => undefined),
  }),
}
