import { randomUUID } from 'node:crypto'
import {
  asc,
  bucketEq,
  compileListFilter,
  deleteFrom,
  desc,
  eq,
  from,
  inArray,
  isNull,
  like,
  ne,
  not,
  or,
} from '@ketvietlab/ketjs'
import type { Ctx, ListState, Row } from '@ketvietlab/ketjs'
import { addDays, cancelActivity, completeActivity, scheduleActivity } from '../activity/index.ts'
import { ensureThread } from '../mail/index.ts'
import { CASE_KINDS, CASE_PRIORITIES, MESSAGE_VISIBILITIES } from './types.ts'
import { caseListSearch, emptyCaseListState } from './search.ts'

export type CrmIssue = { field: string; code: string; params?: Record<string, unknown> }
export type CrmResult = { ok: boolean; id?: string; errors?: CrmIssue[]; [key: string]: unknown }

export const issue = (field: string, code: string, params?: Record<string, unknown>): CrmIssue => ({
  field,
  code,
  ...(params ? { params } : {}),
})
export const invalid = (...errors: CrmIssue[]): CrmResult => ({ ok: false, errors })
export const now = (): string => new Date().toISOString()
export const n = (value: unknown): number => Number(value ?? 0)

/**
 * When a case stops being open, it acquires a closing date.
 *
 * Reporting reads `closedAt` for cycle time, so it has to be written the moment
 * a stage carries a terminal state and cleared again when the case is pulled
 * back into the pipeline. A case that closes twice keeps the first date.
 */
export const closedAtFor = (held: Row, terminalState: unknown, timestamp: string): string | null =>
  terminalState === 'won' || terminalState === 'lost' ? ((held.closedAt as string | null) ?? timestamp) : null
export const normalized = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()

/** Digits only, so `+84 90 123 4567` and `090-123-4567` compare equal. */
export const dialled = (value: unknown): string => String(value ?? '').replace(/\D/g, '')

const jsonStrings = (value: unknown): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .map(String)
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
    : []

export const actorRequired = (ctx: Ctx): string | null => ctx.actor || null

export const commandKey = (value: unknown): string | null => {
  const key = String(value ?? '').trim()
  return key.length >= 8 && key.length <= 200 ? key : null
}

const defaultStages = [
  {
    id: 'crm-stage-new',
    code: 'new',
    name: 'New',
    sequence: 10,
    allowedKinds: ['lead', 'opportunity'],
    terminalState: 'open',
    fold: false,
  },
  {
    id: 'crm-stage-qualified',
    code: 'qualified',
    name: 'Qualified',
    sequence: 20,
    allowedKinds: ['lead', 'opportunity'],
    terminalState: 'open',
    fold: false,
  },
  {
    id: 'crm-stage-proposition',
    code: 'proposition',
    name: 'Proposition',
    sequence: 30,
    allowedKinds: ['opportunity'],
    terminalState: 'open',
    fold: false,
  },
  {
    id: 'crm-stage-won',
    code: 'won',
    name: 'Won',
    sequence: 90,
    allowedKinds: ['opportunity'],
    terminalState: 'won',
    fold: true,
  },
  {
    id: 'crm-stage-lost',
    code: 'lost',
    name: 'Lost',
    sequence: 100,
    allowedKinds: ['opportunity'],
    terminalState: 'lost',
    fold: true,
  },
] as const

/**
 * A seed row this company owns, whatever id it ended up carrying.
 *
 * `id` is the primary key across the whole tenant while the rows themselves are
 * company scoped, so the second company to be seeded cannot reuse `crm-stage-new`
 * — its insert hits `ON CONFLICT DO NOTHING` and vanishes. It gets the same row
 * under a company-qualified id instead, and this is how a caller finds whichever
 * of the two shapes is actually theirs.
 */
export const seededId = async (ctx: Ctx, model: string, id: string): Promise<string | null> => {
  if ((await ctx.db.select(model, { id }))[0]) return id
  const scoped = `${String(ctx.scope.company ?? '')}:${id}`
  return (await ctx.db.select(model, { id: scoped }))[0] ? scoped : null
}

/** The activity type CRM schedules against when the caller names none. */
export const crmActivityType = (ctx: Ctx): Promise<string | null> =>
  seededId(ctx, 'activity.Type', 'crm-next-action')

/** Idempotent seed used by named E2E fixtures and by the first write on a fresh company. */
export async function ensureCrmDefaults(ctx: Ctx): Promise<void> {
  const company = String(ctx.scope.company ?? '')
  const seed = async (model: string, row: Row): Promise<void> => {
    // Already seeded here, under either id.
    if (await seededId(ctx, model, String(row.id))) return
    const inserted = await ctx.db.insertIfAbsent(model, row)
    if ('dryRun' in inserted || inserted.inserted) return
    // The plain id belongs to another company. Take the qualified one, which is
    // the difference between a working pipeline and a company whose every case
    // is refused for having no stage to sit in.
    if (company) await ctx.db.insertIfAbsent(model, { ...row, id: `${company}:${String(row.id)}` })
  }
  await seed('crm.Team', {
    id: 'crm-team-sales',
    code: 'sales',
    name: 'Sales',
    active: true,
    assignmentMode: 'round_robin',
    assignmentCursor: 0,
    version: 1,
  })
  for (const stage of defaultStages) await seed('crm.Stage', { ...stage, active: true })
  await seed('activity.Type', {
    id: 'crm-next-action',
    name: 'CRM next action',
    category: 'call',
    icon: 'phone',
    defaultDelayDays: 0,
    chainingPolicy: 'none',
    sequence: 20,
    active: true,
  })
}

export const stageKinds = (stage: Row): string[] => jsonStrings(stage.allowedKinds)

export async function activeStage(ctx: Ctx, stageId: unknown, kind: string): Promise<Row | null> {
  const stage = (await ctx.db.select('crm.Stage', { id: stageId, active: true }))[0] ?? null
  return stage && stageKinds(stage).includes(kind) ? stage : null
}

export async function firstStage(ctx: Ctx, kind: string): Promise<Row | null> {
  const S = ctx.table('crm.Stage')
  const stages = await ctx.db.all(from(S).where(eq(S.active, true)).orderBy(asc(S.sequence), asc(S.id)))
  return stages.find((stage) => stageKinds(stage).includes(kind) && stage.terminalState === 'open') ?? null
}

export async function addTimeline(
  ctx: Ctx,
  input: {
    id?: string
    caseId: string
    eventType: string
    body: string
    customerVisible?: boolean
    metadata?: Record<string, unknown>
    occurredAt?: string
  },
): Promise<Row> {
  const row = {
    id: input.id ?? randomUUID(),
    caseId: input.caseId,
    eventType: input.eventType,
    actorUserId: ctx.actor ?? null,
    customerVisible: input.customerVisible ?? false,
    body: input.body,
    metadata: input.metadata ?? null,
    occurredAt: input.occurredAt ?? now(),
  }
  await ctx.db.insert('crm.TimelineEntry', row)
  return row
}

const partnerExists = async (ctx: Ctx, id: unknown): Promise<boolean> =>
  !id || Boolean((await ctx.db.select('partner.Partner', { id, active: true }))[0])

const userExists = async (ctx: Ctx, id: unknown): Promise<boolean> =>
  !id || Boolean((await ctx.db.select('user.User', { id, active: true }))[0])

const teamExists = async (ctx: Ctx, id: unknown): Promise<boolean> =>
  !id || Boolean((await ctx.db.select('crm.Team', { id, active: true }))[0])

/**
 * Who the actor may see, resolved once per call.
 *
 * `null` means "everything": either the call carries no actor at all — a job or
 * a fixture running as the system — or the actor is a superuser. Every other
 * actor sees the cases they own, the ones they created, and the ones their
 * active teams hold. The same three clauses are pushed into SQL by `caseQuery`,
 * so a case that appears in a list is a case `caseDetail` will open; keeping the
 * two in one place is what stops them drifting apart again.
 */
export async function caseAudience(ctx: Ctx): Promise<{ actor: string; teams: string[] } | null> {
  if (!ctx.actor) return null
  const user = (await ctx.db.select('user.User', { id: ctx.actor, active: true }))[0]
  if (user?.superuser === true) return null
  const memberships = await ctx.db.select('crm.TeamMember', { userId: ctx.actor, active: true })
  return { actor: ctx.actor, teams: [...new Set(memberships.map((row) => String(row.teamId)))] }
}

const audienceHolds = (audience: { actor: string; teams: string[] } | null, row: Row): boolean =>
  !audience ||
  row.assigneeUserId === audience.actor ||
  row.createdByUserId === audience.actor ||
  (Boolean(row.teamId) && audience.teams.includes(String(row.teamId)))

export async function canReadCase(ctx: Ctx, row: Row): Promise<boolean> {
  return audienceHolds(await caseAudience(ctx), row)
}

export async function visibleCases(ctx: Ctx, rows: Row[]): Promise<Row[]> {
  const audience = await caseAudience(ctx)
  return audience ? rows.filter((row) => audienceHolds(audience, row)) : rows
}

export type SaveCaseInput = {
  id: string
  kind: string
  name: string
  partnerId?: string | null
  contactName?: string | null
  email?: string | null
  phone?: string | null
  teamId?: string | null
  assigneeUserId?: string | null
  stageId?: string | null
  priority?: string
  description?: string | null
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
  expectedRevenue?: unknown
  recurringRevenue?: unknown
  probability?: unknown
  expectedClosing?: string | null
  forecastCategory?: string | null
  tagIds?: string[]
  expectedVersion?: number
  idempotencyKey: string
}

export async function saveCase(
  ctx: Ctx,
  input: SaveCaseInput,
  options: { actorRequired?: boolean; inTransaction?: boolean } = {},
): Promise<CrmResult> {
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'crm.error.idempotencyRequired'))
  if (options.actorRequired !== false && !actorRequired(ctx))
    return invalid(issue('actor', 'crm.error.actorRequired'))
  if (!ctx.scope.company) return invalid(issue('company', 'crm.error.companyRequired'))
  if (!CASE_KINDS.includes(input.kind as never)) return invalid(issue('kind', 'crm.error.invalidKind'))
  if (!String(input.name ?? '').trim()) return invalid(issue('name', 'crm.error.required'))
  if (!CASE_PRIORITIES.includes(String(input.priority ?? '1') as never))
    return invalid(issue('priority', 'crm.error.required'))
  if (!(await partnerExists(ctx, input.partnerId))) return invalid(issue('partnerId', 'crm.error.notFound'))
  if (!(await userExists(ctx, input.assigneeUserId)))
    return invalid(issue('assigneeUserId', 'crm.error.notFound'))
  if (!(await teamExists(ctx, input.teamId))) return invalid(issue('teamId', 'crm.error.notFound'))
  const run = async (tx: Ctx): Promise<CrmResult> => {
    await ensureCrmDefaults(tx)
    const existing = (await tx.db.select('crm.Case', { id: input.id }))[0]
    if (existing && !(await canReadCase(tx, existing))) return invalid(issue('id', 'crm.error.notFound'))
    if (existing && existing.kind !== input.kind) return invalid(issue('kind', 'crm.error.leadConversion'))
    const stage = input.stageId
      ? await activeStage(tx, input.stageId, input.kind)
      : await firstStage(tx, input.kind)
    if (!stage) return invalid(issue('stageId', 'crm.error.invalidStage'))
    const teamId = input.teamId ?? stage.teamId ?? (await seededId(tx, 'crm.Team', 'crm-team-sales'))
    if (!teamId || !(await teamExists(tx, teamId))) return invalid(issue('teamId', 'crm.error.notFound'))
    const timestamp = now()
    const nextVersion = n(existing?.version) + 1
    const values: Row = {
      kind: input.kind,
      name: input.name.trim(),
      partnerId: input.partnerId || null,
      contactName: input.contactName?.trim() || null,
      email: normalized(input.email) || null,
      phone: String(input.phone ?? '').trim() || null,
      phoneDigits: dialled(input.phone) || null,
      teamId,
      assigneeUserId: input.assigneeUserId || null,
      stageId: stage.id,
      priority: input.priority ?? existing?.priority ?? '1',
      description: input.description?.trim() || null,
      utmSource: input.utmSource?.trim() || null,
      utmMedium: input.utmMedium?.trim() || null,
      utmCampaign: input.utmCampaign?.trim() || null,
      terminalState: stage.terminalState,
      active: true,
      version: nextVersion,
      score: existing?.score ?? '0',
      closedAt: closedAtFor(existing ?? {}, stage.terminalState, timestamp),
      updatedAt: timestamp,
    }
    if (existing) {
      const expected = input.expectedVersion ?? n(existing.version)
      const changed = await tx.db.compareAndSet('crm.Case', { id: input.id }, { version: expected }, values)
      if (!('dryRun' in changed) && !changed.matched)
        return invalid(issue('version', 'crm.error.stageConflict', { current: existing.version }))
    } else {
      const thread = await ensureThread(tx, {
        id: `thread:crm.Case:${input.id}`,
        resModel: 'crm.Case',
        resId: input.id,
        displayName: input.name.trim(),
        createdAt: timestamp,
      })
      await tx.db.insert('crm.Case', {
        id: input.id,
        ...values,
        threadId: thread.id,
        createdByUserId: tx.actor ?? null,
        createdAt: timestamp,
      })
    }
    if (existing)
      await ensureThread(tx, {
        id: String(existing.threadId),
        resModel: 'crm.Case',
        resId: input.id,
        displayName: input.name.trim(),
      })

    const detail = (await tx.db.select('crm.SalesDetail', { caseId: input.id }))[0]
    const salesValues = {
      caseId: input.id,
      expectedRevenue: String(input.expectedRevenue ?? detail?.expectedRevenue ?? '0'),
      recurringRevenue: String(input.recurringRevenue ?? detail?.recurringRevenue ?? '0'),
      probability: String(input.probability ?? detail?.probability ?? '0'),
      expectedClosing: input.expectedClosing ?? detail?.expectedClosing ?? null,
      forecastCategory: input.forecastCategory ?? detail?.forecastCategory ?? 'pipeline',
      lostReason: detail?.lostReason ?? null,
      sourceLeadId: detail?.sourceLeadId ?? null,
    }
    if (detail) await tx.db.update('crm.SalesDetail', { id: detail.id }, salesValues)
    else await tx.db.insert('crm.SalesDetail', { id: `sales:${input.id}`, ...salesValues })

    if (input.tagIds) {
      const ids = [...new Set(input.tagIds)]
      const tags = ids.length
        ? await tx.db.all(
            from(tx.table('crm.Tag')).where(
              inArray(tx.table('crm.Tag').id, ids),
              eq(tx.table('crm.Tag').active, true),
            ),
          )
        : []
      if (tags.length !== ids.length) return invalid(issue('tagIds', 'crm.error.notFound'))
      const CT = tx.table('crm.CaseTag')
      await tx.db.del(deleteFrom(CT).where(eq(CT.caseId, input.id)))
      for (const tagId of ids)
        await tx.db.insert('crm.CaseTag', { id: `${input.id}:${tagId}`, caseId: input.id, tagId })
    }
    if (!existing)
      await addTimeline(tx, {
        id: `timeline:${input.id}:created`,
        caseId: input.id,
        eventType: 'created',
        body: 'crm.timeline.created',
        customerVisible: false,
        occurredAt: timestamp,
      })
    // Scoring rules read the fields this write just changed, so the score is
    // stale the moment the case is saved. One job per case, keyed on the case,
    // so a run of edits collapses into a single rescore.
    await tx.jobs.enqueue(
      'crm.score',
      { caseId: input.id, reason: `save:v${nextVersion}` },
      { uniqueKey: `crm.score:${input.id}` },
    )
    return { ok: true, id: input.id, version: nextVersion }
  }
  return options.inTransaction ? run(ctx) : ctx.tx(run)
}

export async function serializeCaseList(ctx: Ctx, rows: Row[]): Promise<Row[]> {
  const ids = (values: unknown[]): string[] => [...new Set(values.filter(Boolean).map(String))]
  const stageIds = ids(rows.map((row) => row.stageId))
  const teamIds = ids(rows.map((row) => row.teamId))
  const userIds = ids(rows.map((row) => row.assigneeUserId))
  const partnerIds = ids(rows.map((row) => row.partnerId))
  const stages = stageIds.length
    ? await ctx.db.all(from(ctx.table('crm.Stage')).where(inArray(ctx.table('crm.Stage').id, stageIds)))
    : []
  const teams = teamIds.length
    ? await ctx.db.all(from(ctx.table('crm.Team')).where(inArray(ctx.table('crm.Team').id, teamIds)))
    : []
  const users = userIds.length
    ? await ctx.db.all(from(ctx.table('user.User')).where(inArray(ctx.table('user.User').id, userIds)))
    : []
  const partners = partnerIds.length
    ? await ctx.db.all(
        from(ctx.table('partner.Partner')).where(inArray(ctx.table('partner.Partner').id, partnerIds)),
      )
    : []
  // The money a case is worth lives one table over, and every screen that lists
  // cases wants it: a pipeline column without amounts is a list of names.
  const caseIds = ids(rows.map((row) => row.id))
  const details = caseIds.length
    ? await ctx.db.all(
        from(ctx.table('crm.SalesDetail')).where(inArray(ctx.table('crm.SalesDetail').caseId, caseIds)),
      )
    : []
  const by = (values: Row[]) => new Map(values.map((row) => [String(row.id), row]))
  const stageBy = by(stages)
  const teamBy = by(teams)
  const userBy = by(users)
  const partnerBy = by(partners)
  const detailBy = new Map(details.map((row) => [String(row.caseId), row]))
  return rows.map((row) => {
    const detail = detailBy.get(String(row.id))
    return {
      ...row,
      stageCode: stageBy.get(String(row.stageId))?.code ?? null,
      stageName: stageBy.get(String(row.stageId))?.name ?? row.stageId,
      teamName: row.teamId ? (teamBy.get(String(row.teamId))?.name ?? row.teamId) : null,
      assigneeName: row.assigneeUserId
        ? (userBy.get(String(row.assigneeUserId))?.name ?? row.assigneeUserId)
        : null,
      partnerName: row.partnerId ? (partnerBy.get(String(row.partnerId))?.name ?? row.partnerId) : null,
      expectedRevenue: detail?.expectedRevenue ?? '0',
      probability: detail?.probability ?? '0',
      expectedClosing: detail?.expectedClosing ?? null,
    }
  })
}

export async function caseDetail(ctx: Ctx, id: string): Promise<Row | null> {
  const row = (await ctx.db.select('crm.Case', { id }))[0]
  if (!row || !(await canReadCase(ctx, row))) return null
  const [serialized] = await serializeCaseList(ctx, [row])
  const [salesDetail, tags, timeline, messages, activityLinks, calendarLinks, attachments] =
    await Promise.all([
      ctx.db.select('crm.SalesDetail', { caseId: id }),
      ctx.db.select('crm.CaseTag', { caseId: id }),
      ctx.db.all(
        from(ctx.table('crm.TimelineEntry'))
          .where(eq(ctx.table('crm.TimelineEntry').caseId, id))
          .orderBy(desc(ctx.table('crm.TimelineEntry').occurredAt)),
      ),
      ctx.db.all(
        from(ctx.table('crm.Message'))
          .where(eq(ctx.table('crm.Message').caseId, id))
          .orderBy(asc(ctx.table('crm.Message').createdAt)),
      ),
      ctx.db.select('crm.ActivityLink', { caseId: id }),
      ctx.db.select('crm.CalendarLink', { caseId: id }),
      ctx.db.select('storage.Attachment', { resModel: 'crm.Case', resId: id }),
    ])
  const tagIds = tags.map((tag) => tag.tagId)
  const tagRows = tagIds.length
    ? await ctx.db.all(from(ctx.table('crm.Tag')).where(inArray(ctx.table('crm.Tag').id, tagIds)))
    : []
  const activityIds = activityLinks.map((link) => link.activityId)
  const activities = activityIds.length
    ? await ctx.db.all(
        from(ctx.table('activity.Activity')).where(inArray(ctx.table('activity.Activity').id, activityIds)),
      )
    : []
  const eventIds = calendarLinks.map((link) => link.eventId)
  const meetings = eventIds.length
    ? await ctx.db.all(
        from(ctx.table('calendar.Event')).where(inArray(ctx.table('calendar.Event').id, eventIds)),
      )
    : []
  return {
    ...serialized!,
    salesDetail: salesDetail[0] ?? null,
    tags: tagRows,
    timeline,
    messages,
    attachments,
    activities,
    meetings,
  }
}

const listStateOf = (value: unknown): ListState | null =>
  value && typeof value === 'object' ? (value as ListState) : null

const caseQuery = async (ctx: Ctx, args: Record<string, unknown>) => {
  const C = ctx.table('crm.Case')
  const state = listStateOf(args.listState) ?? emptyCaseListState()
  const timezone = String(args.timezone ?? 'UTC')
  let query = from(C)
  const compiled = compileListFilter(caseListSearch(C), state, { timezone })
  if (compiled) query = query.where(compiled)
  const path = Array.isArray(args.path) ? args.path : []
  const spec = caseListSearch(C)
  for (let index = 0; index < path.length; index++) {
    const selected = state.groupBy[index]
    const field = spec.groupable?.find((candidate) => candidate.key === selected?.key)
    if (!field) continue
    const value = path[index]
    query = query.where(
      value == null
        ? isNull(field.col)
        : selected?.interval
          ? bucketEq(field.col, selected.interval, timezone, String(value))
          : eq(field.col, value),
    )
  }
  if (args.kind) query = query.where(eq(C.kind, args.kind))
  if (args.stageId) query = query.where(eq(C.stageId, args.stageId))
  if (args.teamId) query = query.where(eq(C.teamId, args.teamId))
  if (args.assigneeUserId) query = query.where(eq(C.assigneeUserId, args.assigneeUserId))
  if (args.terminalState) query = query.where(eq(C.terminalState, args.terminalState))
  if (!state.includeArchived && args.includeArchived !== true) query = query.where(eq(C.active, true))
  if (args.search) query = query.where(like(C.name, `%${String(args.search).trim()}%`))
  const audience = await caseAudience(ctx)
  if (audience)
    query = query.where(
      or(
        eq(C.assigneeUserId, audience.actor),
        eq(C.createdByUserId, audience.actor),
        ...(audience.teams.length ? [inArray(C.teamId, audience.teams)] : []),
      ),
    )
  const sorts = state.sort.length ? state.sort : emptyCaseListState().sort
  const sortable = new Map((spec.sortable ?? []).map((field) => [field.key, field.col]))
  for (const sort of sorts) {
    const col = sortable.get(sort.key)
    if (col) query = query.orderBy(sort.dir === 'desc' ? desc(col) : asc(col))
  }
  return { query, state, spec, timezone }
}

export async function listCases(
  ctx: Ctx,
  args: Record<string, unknown>,
): Promise<{ rows: Row[]; total: number; nextCursor: string | null }> {
  const { query } = await caseQuery(ctx, args)
  const offset = Math.max(0, Number.parseInt(String(args.cursor ?? '0'), 10) || 0)
  const limit = Math.max(1, Math.min(200, n(args.limit ?? 50)))
  const [total, page] = await Promise.all([
    ctx.db.count(query),
    ctx.db.all(query.limit(limit).offset(offset)),
  ])
  return {
    rows: await serializeCaseList(ctx, page),
    total,
    nextCursor: offset + limit < total ? String(offset + limit) : null,
  }
}

/**
 * Cases that look like the one being edited.
 *
 * This used to page through `listCases`, which caps a page at 200 rows however
 * large a limit it is handed — so on any pipeline past 200 cases the duplicate
 * panel quietly stopped finding anything. The match now runs as one indexed
 * query over the three fields a duplicate actually shares, under the same
 * audience filter as every other read, and returns at most `limit` rows.
 */
export async function duplicateCases(
  ctx: Ctx,
  input: { id?: unknown; email?: unknown; phone?: unknown; name?: unknown },
  limit = 20,
): Promise<Row[]> {
  const email = normalized(input.email)
  const phone = String(input.phone ?? '').trim()
  const name = String(input.name ?? '').trim()
  const clauses = []
  const C = ctx.table('crm.Case')
  const digits = dialled(phone)
  if (email) clauses.push(eq(C.email, email))
  if (phone) clauses.push(eq(C.phone, phone))
  if (digits) clauses.push(eq(C.phoneDigits, digits))
  if (name) clauses.push(like(C.name, `%${name}%`))
  if (!clauses.length) return []
  let query = from(C)
    .where(eq(C.active, true), clauses.length === 1 ? clauses[0]! : or(...clauses))
    .orderBy(desc(C.updatedAt), asc(C.id))
  if (input.id) query = query.where(ne(C.id, input.id))
  const audience = await caseAudience(ctx)
  if (audience)
    query = query.where(
      or(
        eq(C.assigneeUserId, audience.actor),
        eq(C.createdByUserId, audience.actor),
        ...(audience.teams.length ? [inArray(C.teamId, audience.teams)] : []),
      ),
    )
  // The clauses above are a union, so a row can arrive because its name looked
  // similar; this keeps only the ones that actually match on something.
  const rows = await ctx.db.all(query.limit(Math.max(1, Math.min(100, limit)) + 20))
  const matched = rows.filter(
    (row) =>
      (email && normalized(row.email) === email) ||
      (digits && (dialled(row.phone) === digits || row.phoneDigits === digits)) ||
      (name && normalized(row.name) === normalized(name)),
  )
  return serializeCaseList(ctx, matched.slice(0, Math.max(1, Math.min(100, limit))))
}

export async function groupCases(ctx: Ctx, args: Record<string, unknown>) {
  const { query, state, spec, timezone } = await caseQuery(ctx, args)
  const path = Array.isArray(args.path) ? args.path : []
  const selected = state.groupBy[path.length]
  const field = spec.groupable?.find((candidate) => candidate.key === selected?.key)
  if (!field) return []
  let grouped = query
    .groupBy({ col: field.col, interval: selected?.interval, timezone })
    .orderGroupsBy({ by: 'key', dir: 'asc' })
  if (args.limit != null) grouped = grouped.limit(Number(args.limit))
  if (args.offset != null) grouped = grouped.offset(Number(args.offset))
  return ctx.db.group(grouped)
}

export async function addCaseMessage(
  ctx: Ctx,
  input: {
    id: string
    caseId: string
    body: string
    visibility: string
    authorPartnerId?: string | null
  },
): Promise<CrmResult> {
  if (!MESSAGE_VISIBILITIES.includes(input.visibility as never))
    return invalid(issue('visibility', 'crm.error.invalidVisibility'))
  const held = (await ctx.db.select('crm.Case', { id: input.caseId }))[0]
  if (!held || !(await canReadCase(ctx, held))) return invalid(issue('caseId', 'crm.error.notFound'))
  if (!input.body.trim()) return invalid(issue('body', 'crm.error.required'))
  const existing = (await ctx.db.select('crm.Message', { id: input.id }))[0]
  if (existing) return { ok: true, id: input.id }
  const timestamp = now()
  await ctx.db.insert('crm.Message', {
    id: input.id,
    caseId: input.caseId,
    actorUserId: ctx.actor ?? null,
    authorPartnerId: input.authorPartnerId ?? null,
    visibility: input.visibility,
    body: input.body.trim(),
    createdAt: timestamp,
  })
  await addTimeline(ctx, {
    id: `timeline:message:${input.id}`,
    caseId: input.caseId,
    eventType: 'message',
    body: input.body.trim(),
    customerVisible: false,
    occurredAt: timestamp,
  })
  return { ok: true, id: input.id }
}

export async function moveCase(
  ctx: Ctx,
  input: { id: string; stageId: string; expectedVersion: number; idempotencyKey: string },
): Promise<CrmResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'crm.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'crm.error.idempotencyRequired'))
  return ctx.tx(async (tx) => {
    const held = (await tx.db.select('crm.Case', { id: input.id }))[0]
    if (!held || !(await canReadCase(tx, held))) return invalid(issue('id', 'crm.error.notFound'))
    const stage = await activeStage(tx, input.stageId, String(held.kind))
    if (!stage) return invalid(issue('stageId', 'crm.error.invalidStage'))
    const timestamp = now()
    const patch = {
      stageId: stage.id,
      terminalState: stage.terminalState,
      active: true,
      version: n(held.version) + 1,
      updatedAt: timestamp,
      closedAt: closedAtFor(held, stage.terminalState, timestamp),
    }
    const changed = await tx.db.compareAndSet(
      'crm.Case',
      { id: input.id },
      { version: input.expectedVersion },
      patch,
    )
    if (!('dryRun' in changed) && !changed.matched)
      return invalid(issue('version', 'crm.error.stageConflict', { current: held.version }))
    await addTimeline(tx, {
      id: `timeline:${input.id}:move:${input.idempotencyKey}`,
      caseId: input.id,
      eventType: 'stage',
      body: 'crm.timeline.stage',
      metadata: { from: held.stageId, to: stage.id },
    })
    if (held.assigneeUserId && held.terminalState !== stage.terminalState)
      await tx.jobs.enqueue(
        'crm.gamification',
        { userId: held.assigneeUserId },
        { uniqueKey: `crm.gamification:${String(held.assigneeUserId)}` },
      )
    return { ok: true, id: input.id, version: patch.version, terminalState: stage.terminalState }
  })
}

async function routedAssignee(ctx: Ctx, team: Row): Promise<Row | null> {
  const M = ctx.table('crm.TeamMember')
  const members = await ctx.db.all(
    from(M).where(eq(M.teamId, team.id), eq(M.active, true)).orderBy(asc(M.sequence), asc(M.id)),
  )
  if (!members.length) return null
  if (team.assignmentMode === 'capacity')
    return [...members].sort(
      (a, b) =>
        n(a.assignedCount) / Math.max(1, n(a.capacity)) - n(b.assignedCount) / Math.max(1, n(b.capacity)) ||
        String(a.lastAssignedAt ?? '').localeCompare(String(b.lastAssignedAt ?? '')) ||
        String(a.id).localeCompare(String(b.id)),
    )[0]!
  return members[n(team.assignmentCursor) % members.length]!
}

export async function assignCase(
  ctx: Ctx,
  input: {
    id: string
    teamId?: string | null
    assigneeUserId?: string | null
    expectedVersion?: number
    force?: boolean
    idempotencyKey: string
  },
): Promise<CrmResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'crm.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'crm.error.idempotencyRequired'))
  return ctx.tx(async (tx) => {
    const held = (await tx.db.select('crm.Case', { id: input.id }))[0]
    if (!held || !(await canReadCase(tx, held))) return invalid(issue('id', 'crm.error.notFound'))
    if (held.assigneeUserId && !input.force && !input.assigneeUserId)
      return { ok: true, id: input.id, assigneeUserId: held.assigneeUserId, version: held.version }
    let teamId = input.teamId ?? (held.teamId ? String(held.teamId) : null)
    let assigneeUserId = input.assigneeUserId ?? null
    if (!teamId || !assigneeUserId) {
      const rules = (await tx.db.select('crm.AssignmentRule', { active: true })).sort(
        (a, b) => n(a.priority) - n(b.priority) || String(a.id).localeCompare(String(b.id)),
      )
      const matched = rules.find(
        (rule) =>
          jsonStrings(rule.allowedKinds).includes(String(held.kind)) &&
          (!rule.utmSource || normalized(rule.utmSource) === normalized(held.utmSource)) &&
          (rule.minimumScore == null || n(held.score) >= n(rule.minimumScore)),
      )
      teamId ??= matched?.teamId ? String(matched.teamId) : null
      assigneeUserId ??= matched?.assigneeUserId ? String(matched.assigneeUserId) : null
    }
    if (!teamId) return invalid(issue('teamId', 'crm.error.notFound'))
    const team = (await tx.db.select('crm.Team', { id: teamId, active: true }))[0]
    if (!team) return invalid(issue('teamId', 'crm.error.notFound'))
    let member: Row | null = null
    if (!assigneeUserId) {
      member = await routedAssignee(tx, team)
      assigneeUserId = member?.userId
        ? String(member.userId)
        : team.leaderUserId
          ? String(team.leaderUserId)
          : null
    }
    if (!assigneeUserId || !(await userExists(tx, assigneeUserId)))
      return invalid(issue('assigneeUserId', 'crm.error.notFound'))
    // A case is assigned inside its team; saying so is the difference between a
    // form the user can correct and one that reports "not found" for a person
    // they just picked from a list.
    if (
      !(await tx.db.select('crm.TeamMember', { teamId, userId: assigneeUserId, active: true }))[0] &&
      team.leaderUserId !== assigneeUserId
    )
      return invalid(issue('assigneeUserId', 'crm.error.notTeamMember'))
    const expected = input.expectedVersion ?? n(held.version)
    const timestamp = now()
    const changed = await tx.db.compareAndSet(
      'crm.Case',
      { id: input.id },
      { version: expected },
      {
        teamId,
        assigneeUserId,
        version: n(held.version) + 1,
        updatedAt: timestamp,
      },
    )
    if (!('dryRun' in changed) && !changed.matched)
      return invalid(issue('version', 'crm.error.stageConflict', { current: held.version }))
    if (member) {
      await tx.db.update(
        'crm.TeamMember',
        { id: member.id },
        {
          assignedCount: n(member.assignedCount) + 1,
          lastAssignedAt: timestamp,
        },
      )
      await tx.db.update(
        'crm.Team',
        { id: team.id },
        {
          assignmentCursor: n(team.assignmentCursor) + 1,
          version: n(team.version) + 1,
        },
      )
    }
    await addTimeline(tx, {
      id: `timeline:${input.id}:assign:${input.idempotencyKey}`,
      caseId: input.id,
      eventType: 'assigned',
      body: 'crm.timeline.assigned',
      metadata: { teamId, assigneeUserId },
    })
    return { ok: true, id: input.id, teamId, assigneeUserId, version: n(held.version) + 1 }
  })
}

export async function scheduleCaseActivity(
  ctx: Ctx,
  input: {
    id: string
    caseId: string
    typeId?: string
    assigneeUserId?: string
    summary: string
    note?: string
    dueDate: string
    idempotencyKey: string
  },
): Promise<CrmResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'crm.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'crm.error.idempotencyRequired'))
  return ctx.tx(async (tx) => {
    const held = (await tx.db.select('crm.Case', { id: input.caseId }))[0]
    if (!held || !(await canReadCase(tx, held))) return invalid(issue('caseId', 'crm.error.notFound'))
    const activity = await scheduleActivity(tx, {
      id: input.id,
      threadId: String(held.threadId),
      typeId: input.typeId ?? (await crmActivityType(tx)) ?? 'crm-next-action',
      assigneeUserId: input.assigneeUserId ?? String(held.assigneeUserId ?? tx.actor),
      summary: input.summary,
      note: input.note,
      dueDate: input.dueDate,
    })
    await tx.db.insertIfAbsent('crm.ActivityLink', {
      id: `crm-activity:${activity.id}`,
      caseId: input.caseId,
      activityId: activity.id,
    })
    await addTimeline(tx, {
      id: `timeline:${input.caseId}:activity:${activity.id}`,
      caseId: input.caseId,
      eventType: 'activity_scheduled',
      body: input.summary,
      metadata: { activityId: activity.id, dueDate: input.dueDate },
    })
    return { ok: true, id: String(activity.id), activity }
  })
}

export async function completeCaseActivity(
  ctx: Ctx,
  input: { id: string; feedback?: string; completedDate: string; idempotencyKey: string },
): Promise<CrmResult> {
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'crm.error.idempotencyRequired'))
  if (!actorRequired(ctx)) return invalid(issue('actor', 'crm.error.actorRequired'))
  return ctx.tx(async (tx) => {
    const link = (await tx.db.select('crm.ActivityLink', { activityId: input.id }))[0]
    if (!link) return invalid(issue('id', 'crm.error.notFound'))
    const held = (await tx.db.select('crm.Case', { id: link.caseId }))[0]
    if (!held || !(await canReadCase(tx, held))) return invalid(issue('id', 'crm.error.notFound'))
    const result = await completeActivity(tx, input.id, input.feedback ?? '', input.completedDate)
    await addTimeline(tx, {
      id: `timeline:${String(link.caseId)}:activity-done:${input.id}`,
      caseId: String(link.caseId),
      eventType: 'activity_completed',
      body: input.feedback?.trim() || String(result.activity.summary),
      metadata: { activityId: input.id },
    })
    return { ok: true, id: input.id, activity: result.activity, nextActivity: result.nextActivity }
  })
}

export async function cancelCaseActivity(
  ctx: Ctx,
  input: { id: string; feedback?: string; idempotencyKey: string },
): Promise<CrmResult> {
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'crm.error.idempotencyRequired'))
  if (!actorRequired(ctx)) return invalid(issue('actor', 'crm.error.actorRequired'))
  return ctx.tx(async (tx) => {
    const link = (await tx.db.select('crm.ActivityLink', { activityId: input.id }))[0]
    if (!link) return invalid(issue('id', 'crm.error.notFound'))
    const held = (await tx.db.select('crm.Case', { id: link.caseId }))[0]
    if (!held || !(await canReadCase(tx, held))) return invalid(issue('id', 'crm.error.notFound'))
    const activity = await cancelActivity(tx, input.id, input.feedback)
    await addTimeline(tx, {
      id: `timeline:${String(link.caseId)}:activity-cancel:${input.id}`,
      caseId: String(link.caseId),
      eventType: 'activity_cancelled',
      body: input.feedback?.trim() || String(activity.summary),
      metadata: { activityId: input.id },
    })
    return { ok: true, id: input.id, activity }
  })
}

export async function applyCasePlan(
  ctx: Ctx,
  input: { caseId: string; planId: string; anchorDate: string; idempotencyKey: string },
): Promise<CrmResult> {
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'crm.error.idempotencyRequired'))
  if (!actorRequired(ctx)) return invalid(issue('actor', 'crm.error.actorRequired'))
  return ctx.tx(async (tx) => {
    const held = (await tx.db.select('crm.Case', { id: input.caseId }))[0]
    if (!held || !(await canReadCase(tx, held))) return invalid(issue('caseId', 'crm.error.notFound'))
    const plan = (await tx.db.select('activity.Plan', { id: input.planId, active: true }))[0]
    if (!plan) return invalid(issue('planId', 'crm.error.notFound'))
    const steps = (await tx.db.select('activity.PlanStep', { planId: input.planId })).sort(
      (a, b) => n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id)),
    )
    const activities: Row[] = []
    for (const step of steps) {
      const id = `crm-plan:${input.caseId}:${input.planId}:${String(step.id)}`
      const activity = await scheduleActivity(tx, {
        id,
        threadId: String(held.threadId),
        typeId: String(step.typeId),
        assigneeUserId:
          step.assigneeStrategy === 'specific'
            ? String(step.assigneeUserId)
            : step.assigneeStrategy === 'actor'
              ? String(tx.actor)
              : String(held.assigneeUserId ?? tx.actor),
        summary: String(step.summary ?? plan.name),
        note: step.note ? String(step.note) : undefined,
        dueDate: addDays(input.anchorDate, n(step.offsetDays)),
      })
      await tx.db.insertIfAbsent('crm.ActivityLink', {
        id: `crm-activity:${id}`,
        caseId: input.caseId,
        activityId: id,
      })
      activities.push(activity)
    }
    await addTimeline(tx, {
      id: `timeline:${input.caseId}:plan:${input.idempotencyKey}`,
      caseId: input.caseId,
      eventType: 'plan_applied',
      body: String(plan.name),
      metadata: { planId: input.planId, activityIds: activities.map((row) => row.id) },
    })
    return { ok: true, id: input.caseId, activities }
  })
}

export async function refreshCaseScore(ctx: Ctx, caseId: string, sourceKey: string): Promise<CrmResult> {
  return ctx.tx((tx) => applyCaseScore(tx, caseId, sourceKey))
}

/**
 * The scoring pass itself, without a transaction of its own.
 *
 * A worker handler already runs transaction-bound, and nesting one inside it
 * breaks SQLite — so the job calls this directly while `refreshCaseScore` wraps
 * it for callers that arrive over HTTP.
 */
export async function applyCaseScore(ctx: Ctx, caseId: string, sourceKey: string): Promise<CrmResult> {
  {
    const tx = ctx
    const held = (await tx.db.select('crm.Case', { id: caseId }))[0]
    if (!held || !(await canReadCase(tx, held))) return invalid(issue('caseId', 'crm.error.notFound'))
    const rules = (await tx.db.select('crm.ScoreRule', { active: true })).sort(
      (a, b) => n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id)),
    )
    let score = 0
    const reasons: Array<{ ruleId: string; points: number }> = []
    for (const rule of rules) {
      const actual = held[String(rule.field)]
      const wanted = String(rule.value)
      const matches =
        (rule.operator === 'eq' && normalized(actual) === normalized(wanted)) ||
        (rule.operator === 'contains' && normalized(actual).includes(normalized(wanted))) ||
        (rule.operator === 'present' && Boolean(String(actual ?? '').trim())) ||
        (rule.operator === 'gte' && n(actual) >= n(wanted))
      if (!matches) continue
      score += n(rule.points)
      reasons.push({ ruleId: String(rule.id), points: n(rule.points) })
    }
    const timestamp = now()
    /**
     * Scoring rewrites one derived field, so it neither bumps `version` nor may
     * clobber a concurrent edit: the compare pins the row to the state this
     * transaction read, and leaving the version alone keeps every form the user
     * already has open valid.
     */
    const changed = await tx.db.compareAndSet(
      'crm.Case',
      { id: caseId },
      { version: n(held.version) },
      { score: String(score), updatedAt: timestamp },
    )
    if (!('dryRun' in changed) && !changed.matched)
      return invalid(issue('version', 'crm.error.stageConflict', { current: n(held.version) }))
    await tx.db.insertIfAbsent('crm.ScoreHistory', {
      id: `score:${caseId}:${sourceKey}`,
      caseId,
      score: String(score),
      reasons,
      calculatedAt: timestamp,
    })
    return { ok: true, id: caseId, score, reasons }
  }
}

/**
 * One salesperson's standing, recomputed from counting queries.
 *
 * Called per user so the leaderboard can be refreshed incrementally — a case
 * reaching a terminal state only changes the assignee's row.
 */
export async function gamificationProfile(ctx: Ctx, user: Row): Promise<Row> {
  const C = ctx.table('crm.Case')
  const A = ctx.table('activity.Activity')
  const owned = from(C).where(eq(C.assigneeUserId, user.id), eq(C.active, true))
  const [assigned, won, lost, activitiesDone] = await Promise.all([
    ctx.db.count(owned),
    ctx.db.count(owned.where(eq(C.terminalState, 'won'))),
    ctx.db.count(owned.where(eq(C.terminalState, 'lost'))),
    ctx.db.count(
      from(A).where(
        eq(A.assigneeUserId, user.id),
        not(isNull(A.doneAt)),
        // Every CRM thread is named after the case it belongs to, which keeps
        // this count inside the CRM without a join through the link table.
        like(A.threadId, 'thread:crm.Case:%'),
      ),
    ),
  ])
  const id = `gamification:${String(user.id)}`
  const row = {
    userId: user.id,
    points: won * 100 + activitiesDone * 10 + Math.max(0, assigned - lost) * 2,
    assigned,
    won,
    lost,
    activitiesDone,
    streak: won ? Math.min(won, 30) : 0,
    refreshedAt: now(),
  }
  const held = (await ctx.db.select('crm.GamificationProfile', { id }))[0]
  if (held) await ctx.db.update('crm.GamificationProfile', { id }, row)
  else await ctx.db.insert('crm.GamificationProfile', { id, ...row })
  return { id, ...row, userName: user.name }
}
