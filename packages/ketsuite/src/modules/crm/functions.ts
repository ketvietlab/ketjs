import { randomUUID } from 'node:crypto'
import { asc, defineFn, deleteFrom, eq, from, inArray, isNull } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import {
  activeStage,
  actorRequired,
  addCaseMessage,
  addTimeline,
  applyCasePlan,
  assignCase,
  cancelCaseActivity,
  canReadCase,
  caseDetail,
  closedAtFor,
  duplicateCases,
  commandKey,
  completeCaseActivity,
  ensureCrmDefaults,
  firstStage,
  gamificationProfile,
  invalid,
  issue,
  groupCases,
  listCases,
  moveCase,
  n,
  normalized,
  now,
  refreshCaseScore,
  pipelineSummary,
  saveCase,
  scheduleCaseActivity,
  serializeCaseList,
  stageKinds,
  visibleCases,
} from './operations.ts'
import { ASSIGNMENT_MODES, CASE_KINDS, TERMINAL_STATES } from './types.ts'

const caseReadEffects = [
  'read:crm.Case',
  'read:crm.Stage',
  'read:crm.Team',
  'read:crm.TeamMember',
  'read:crm.SalesDetail',
  'read:crm.CaseTag',
  'read:crm.Tag',
  'read:crm.TimelineEntry',
  'read:crm.Message',
  'read:crm.ActivityLink',
  'read:crm.CalendarLink',
  'read:user.User',
  'read:partner.Partner',
  'read:activity.Activity',
  'read:calendar.Event',
  'read:storage.Attachment',
] as const

const defaultEffects = [
  'read:crm.Team',
  'write:crm.Team',
  'read:crm.Stage',
  'write:crm.Stage',
  'read:activity.Type',
  'write:activity.Type',
] as const

export const caseWriteEffects = [
  ...caseReadEffects,
  ...defaultEffects,
  'write:crm.Case',
  'write:crm.SalesDetail',
  'write:crm.CaseTag',
  'write:crm.TimelineEntry',
  'read:mail.Thread',
  'write:mail.Thread',
  'enqueue:crm.score',
] as const

const activityEffects = [
  ...caseReadEffects,
  'read:activity.Type',
  'read:activity.Plan',
  'read:activity.PlanStep',
  'read:activity.Attachment',
  'write:activity.Activity',
  'write:activity.Attachment',
  'write:crm.ActivityLink',
  'write:crm.TimelineEntry',
  'read:mail.Thread',
  'read:mail.Message',
  'read:mail.Follower',
  'read:mail.FollowerSubtype',
  'read:mail.Subtype',
  'write:mail.Message',
  'write:mail.MessageAttachment',
  'write:mail.Mention',
  'write:mail.TrackingValue',
  'write:mail.Notification',
  'read:storage.Attachment',
] as const

const command = (ctx: Ctx, key: unknown) => {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'crm.error.actorRequired'))
  if (!commandKey(key)) return invalid(issue('idempotencyKey', 'crm.error.idempotencyRequired'))
  return null
}

const ensureCase = async (ctx: Ctx, id: unknown): Promise<Row | null> =>
  (await ctx.db.select('crm.Case', { id }))[0] ?? null

/**
 * One shape for the small configuration lists the pickers read: active first,
 * filtered by name, capped so a keystroke never pulls a whole table.
 */
const optionRows = async (
  ctx: Ctx,
  model: string,
  args: Record<string, unknown>,
  order?: (a: Row, b: Row) => number,
): Promise<Row[]> => {
  const rows = await ctx.db.select(model, args.includeArchived === true ? {} : { active: true })
  const needle = normalized(args.search)
  return rows
    .filter(
      (row) => !needle || normalized(row.name).includes(needle) || normalized(row.code).includes(needle),
    )
    .sort(
      (a, b) =>
        (order ? order(a, b) : 0) ||
        String(a.name ?? '').localeCompare(String(b.name ?? '')) ||
        String(a.id).localeCompare(String(b.id)),
    )
    .slice(0, Math.max(1, Math.min(200, n(args.limit ?? 80))))
}

async function moveToTerminal(
  ctx: Ctx,
  input: {
    id: string
    expectedVersion: number
    terminal: string
    lostReason?: string
    idempotencyKey: string
  },
) {
  const error = command(ctx, input.idempotencyKey)
  if (error) return error
  return ctx.tx(async (tx) => {
    const held = await ensureCase(tx, input.id)
    if (!held || !(await canReadCase(tx, held))) return invalid(issue('id', 'crm.error.notFound'))
    if (held.kind !== 'opportunity') return invalid(issue('kind', 'crm.error.leadConversion'))
    const stages = (await tx.db.select('crm.Stage', { active: true })).filter(
      (stage) =>
        stage.terminalState === input.terminal &&
        Array.isArray(stage.allowedKinds) &&
        stage.allowedKinds.map(String).includes(String(held.kind)),
    )
    const stage = stages.sort(
      (a, b) => n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id)),
    )[0]
    if (!stage) return invalid(issue('stageId', 'crm.error.invalidStage'))
    if (held.kind === 'opportunity' && input.terminal === 'lost') {
      const detail = (await tx.db.select('crm.SalesDetail', { caseId: input.id }))[0]
      if (detail)
        await tx.db.update('crm.SalesDetail', { id: detail.id }, { lostReason: input.lostReason ?? null })
    }
    const timestamp = now()
    const changed = await tx.db.compareAndSet(
      'crm.Case',
      { id: input.id },
      { version: input.expectedVersion },
      {
        stageId: stage.id,
        terminalState: input.terminal,
        active: true,
        version: n(held.version) + 1,
        updatedAt: timestamp,
        closedAt: closedAtFor(held, input.terminal, timestamp),
      },
    )
    if (!('dryRun' in changed) && !changed.matched)
      return invalid(issue('version', 'crm.error.stageConflict', { current: held.version }))
    const event = input.terminal === 'won' ? 'won' : 'lost'
    await addTimeline(tx, {
      id: `timeline:${input.id}:${event}:${input.idempotencyKey}`,
      caseId: input.id,
      eventType: event,
      body: `crm.timeline.${event}`,
      customerVisible: false,
      occurredAt: timestamp,
    })
    if (held.assigneeUserId)
      await tx.jobs.enqueue(
        'crm.gamification',
        { userId: held.assigneeUserId },
        { uniqueKey: `crm.gamification:${String(held.assigneeUserId)}` },
      )
    return { ok: true, id: input.id, version: n(held.version) + 1, terminalState: input.terminal }
  })
}

const saveConfiguration = (
  model: string,
  prepare: (args: Record<string, unknown>, existing: Row | undefined) => Row,
) =>
  defineFn({
    input: { values: 'json', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [`read:${model}`, `write:${model}`],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      if (!args.values || typeof args.values !== 'object')
        return invalid(issue('values', 'crm.error.required'))
      const values = args.values as Record<string, unknown>
      const id = String(values.id ?? '')
      if (!id) return invalid(issue('id', 'crm.error.required'))
      const existing = (await ctx.db.select(model, { id }))[0]
      const expectedVersion = values.expectedVersion == null ? undefined : n(values.expectedVersion)
      if (existing && expectedVersion != null && n(existing.version) !== expectedVersion)
        return invalid(issue('version', 'crm.error.stageConflict', { current: n(existing.version) }))
      const version = n(existing?.version) + 1
      const row = { ...prepare(values, existing), version }
      if (existing?.version != null) {
        const changed = await ctx.db.compareAndSet(model, { id }, { version: n(existing.version) }, row)
        if (!('dryRun' in changed) && !changed.matched)
          return invalid(issue('version', 'crm.error.stageConflict', { current: n(existing.version) }))
      } else if (existing) await ctx.db.update(model, { id }, row)
      else await ctx.db.insert(model, { id, ...row })
      return { ok: true, id, version }
    },
  })

export const functions: Record<string, FnSpec> = {
  'bootstrap.defaults': defineFn({
    input: { idempotencyKey: 'text' },
    output: { ok: 'bool' },
    effects: [...defaultEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      await ensureCrmDefaults(ctx)
      return { ok: true }
    },
  }),

  'case.list': defineFn({
    input: {
      kind: 'text?',
      stageId: 'id?',
      teamId: 'id?',
      assigneeUserId: 'id?',
      /** Only the cases assigned to the caller. Resolved from the session, not the URL. */
      mine: 'bool?',
      terminalState: 'text?',
      search: 'text?',
      includeArchived: 'bool?',
      cursor: 'text?',
      limit: 'int?',
      listState: 'json?',
      path: 'json?',
      timezone: 'text?',
    },
    output: { rows: 'json', total: 'int', nextCursor: 'text?' },
    effects: [...caseReadEffects],
    agent: true,
    handler: (ctx, args) => listCases(ctx, args),
  }),

  'pipeline.summary': defineFn({
    input: {
      kind: 'text?',
      teamId: 'id?',
      mine: 'bool?',
      search: 'text?',
      timezone: 'text?',
    },
    output: {
      stages: 'json',
      openCount: 'int',
      expectedRevenue: 'decimal',
      weightedRevenue: 'decimal',
      overdueActivityCount: 'int',
      partial: 'bool',
    },
    effects: [...caseReadEffects],
    agent: true,
    handler: (ctx, args) => pipelineSummary(ctx, args),
  }),

  overview: defineFn({
    input: { today: 'date' },
    output: {
      leadCount: 'int',
      opportunityCount: 'int',
      openOpportunityCount: 'int',
      overdueActivityCount: 'int',
      expectedRevenue: 'decimal',
    },
    effects: [...caseReadEffects],
    agent: true,
    handler: async (ctx, args) => {
      const C = ctx.table('crm.Case')
      const owned = await ctx.db.all(from(C).where(eq(C.active, true), inArray(C.kind, [...CASE_KINDS])))
      const visible = await visibleCases(ctx, owned)
      const rows = await serializeCaseList(ctx, visible)
      const openOpportunities = rows.filter(
        (row) => row.kind === 'opportunity' && row.terminalState === 'open',
      )
      const visibleIds = [...new Set(rows.map((row) => String(row.id)))]
      // Reading every link in the tenant to keep the handful that belong to
      // these cases is work the query can do instead.
      const L = ctx.table('crm.ActivityLink')
      const links = visibleIds.length ? await ctx.db.all(from(L).where(inArray(L.caseId, visibleIds))) : []
      const activityIds = [...new Set(links.map((link) => String(link.activityId)))]
      const activities = activityIds.length
        ? await ctx.db.all(
            from(ctx.table('activity.Activity')).where(
              inArray(ctx.table('activity.Activity').id, activityIds),
            ),
          )
        : []
      return {
        leadCount: rows.filter((row) => row.kind === 'lead').length,
        opportunityCount: rows.filter((row) => row.kind === 'opportunity').length,
        openOpportunityCount: openOpportunities.length,
        overdueActivityCount: activities.filter(
          (activity) =>
            activity.active !== false &&
            activity.doneAt == null &&
            activity.canceledAt == null &&
            String(activity.dueDate) < String(args.today),
        ).length,
        expectedRevenue: String(openOpportunities.reduce((total, row) => total + n(row.expectedRevenue), 0)),
      }
    },
  }),

  'case.count': defineFn({
    input: {
      kind: 'text?',
      stageId: 'id?',
      teamId: 'id?',
      assigneeUserId: 'id?',
      terminalState: 'text?',
      search: 'text?',
      includeArchived: 'bool?',
      listState: 'json?',
      timezone: 'text?',
    },
    output: { count: 'int' },
    effects: [...caseReadEffects],
    agent: true,
    handler: async (ctx, args) => ({ count: (await listCases(ctx, { ...args, limit: 1 })).total }),
  }),

  'case.group': defineFn({
    input: {
      kind: 'text?',
      listState: 'json',
      path: 'json?',
      timezone: 'text?',
      limit: 'int?',
      offset: 'int?',
    },
    effects: [...caseReadEffects],
    agent: true,
    handler: (ctx, args) => groupCases(ctx, args),
  }),

  'case.get': defineFn({
    input: { id: 'id' },
    effects: [...caseReadEffects],
    agent: true,
    handler: (ctx, args) => caseDetail(ctx, String(args.id)),
  }),

  'case.save': defineFn({
    input: {
      id: 'id',
      kind: 'text',
      name: 'text',
      partnerId: 'id?',
      contactName: 'text?',
      email: 'text?',
      phone: 'text?',
      teamId: 'id?',
      assigneeUserId: 'id?',
      stageId: 'id?',
      priority: 'text?',
      description: 'text?',
      utmSource: 'text?',
      utmMedium: 'text?',
      utmCampaign: 'text?',
      expectedRevenue: 'decimal?',
      recurringRevenue: 'decimal?',
      probability: 'decimal?',
      expectedClosing: 'date?',
      forecastCategory: 'text?',
      tagIds: 'json?',
      expectedVersion: 'int?',
      idempotencyKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [...caseWriteEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      saveCase(ctx, {
        ...(args as Record<string, unknown>),
        id: String(args.id),
        kind: String(args.kind),
        name: String(args.name),
        idempotencyKey: String(args.idempotencyKey),
        tagIds: Array.isArray(args.tagIds) ? args.tagIds.map(String) : undefined,
      }),
  }),

  'case.move': defineFn({
    input: { id: 'id', stageId: 'id', expectedVersion: 'int', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', version: 'int?', terminalState: 'text?', errors: 'json?' },
    effects: [
      'read:crm.Case',
      'write:crm.Case',
      'read:crm.Stage',
      'read:crm.TeamMember',
      'read:user.User',
      'write:crm.TimelineEntry',
      'enqueue:crm.gamification',
    ],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      moveCase(ctx, {
        id: String(args.id),
        stageId: String(args.stageId),
        expectedVersion: Number(args.expectedVersion),
        idempotencyKey: String(args.idempotencyKey),
      }),
  }),

  'case.assign': defineFn({
    input: {
      id: 'id',
      teamId: 'id?',
      assigneeUserId: 'id?',
      expectedVersion: 'int?',
      force: 'bool?',
      idempotencyKey: 'text',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      teamId: 'id?',
      assigneeUserId: 'id?',
      version: 'int?',
      errors: 'json?',
    },
    effects: [
      'read:crm.Case',
      'write:crm.Case',
      'read:crm.Team',
      'write:crm.Team',
      'read:crm.TeamMember',
      'write:crm.TeamMember',
      'read:crm.AssignmentRule',
      'read:user.User',
      'write:crm.TimelineEntry',
    ],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => assignCase(ctx, args as never),
  }),

  'case.convertLead': defineFn({
    input: { id: 'id', expectedVersion: 'int', stageId: 'id?', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [
      'read:crm.Case',
      'write:crm.Case',
      'read:crm.Stage',
      'read:crm.SalesDetail',
      'write:crm.SalesDetail',
      'write:crm.TimelineEntry',
      'read:user.User',
      'read:crm.TeamMember',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      return ctx.tx(async (tx) => {
        const held = await ensureCase(tx, args.id)
        if (!held || !(await canReadCase(tx, held))) return invalid(issue('id', 'crm.error.notFound'))
        if (held.kind !== 'lead') {
          if (held.kind === 'opportunity') return { ok: true, id: held.id, version: held.version }
          return invalid(issue('kind', 'crm.error.leadConversion'))
        }
        const stage = args.stageId
          ? await activeStage(tx, args.stageId, 'opportunity')
          : await firstStage(tx, 'opportunity')
        if (!stage) return invalid(issue('stageId', 'crm.error.invalidStage'))
        const timestamp = now()
        const changed = await tx.db.compareAndSet(
          'crm.Case',
          { id: args.id },
          { version: args.expectedVersion },
          {
            kind: 'opportunity',
            stageId: stage.id,
            terminalState: stage.terminalState,
            convertedAt: timestamp,
            version: n(held.version) + 1,
            updatedAt: timestamp,
          },
        )
        if (!('dryRun' in changed) && !changed.matched)
          return invalid(issue('version', 'crm.error.stageConflict', { current: held.version }))
        const detail = (await tx.db.select('crm.SalesDetail', { caseId: args.id }))[0]
        if (detail) await tx.db.update('crm.SalesDetail', { id: detail.id }, { sourceLeadId: args.id })
        await addTimeline(tx, {
          id: `timeline:${String(args.id)}:convert:${String(args.idempotencyKey)}`,
          caseId: String(args.id),
          eventType: 'converted',
          body: 'crm.timeline.converted',
        })
        return { ok: true, id: args.id, version: n(held.version) + 1 }
      })
    },
  }),

  'case.merge': defineFn({
    input: { targetId: 'id', sourceId: 'id', expectedTargetVersion: 'int', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [
      'read:crm.Case',
      'write:crm.Case',
      'read:crm.CaseTag',
      'write:crm.CaseTag',
      'read:crm.Message',
      'write:crm.Message',
      'read:crm.ActivityLink',
      'write:crm.ActivityLink',
      'read:crm.CalendarLink',
      'write:crm.CalendarLink',
      'read:crm.SalesDetail',
      'write:crm.SalesDetail',
      'read:crm.TimelineEntry',
      'write:crm.TimelineEntry',
      'read:crm.TeamMember',
      'read:user.User',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      if (args.targetId === args.sourceId) return invalid(issue('sourceId', 'crm.error.required'))
      return ctx.tx(async (tx) => {
        const [target, source] = await Promise.all([
          ensureCase(tx, args.targetId),
          ensureCase(tx, args.sourceId),
        ])
        if (!target || !source) return invalid(issue('id', 'crm.error.notFound'))
        if (!(await canReadCase(tx, target))) return invalid(issue('targetId', 'crm.error.notFound'))
        if (!(await canReadCase(tx, source))) return invalid(issue('sourceId', 'crm.error.notFound'))
        if (target.kind !== source.kind) return invalid(issue('sourceId', 'crm.error.invalidKind'))
        // Merging a record that is already folded into a third one would strand
        // the history it carries, and merging into an archived target hides the
        // result the moment it is written.
        if (source.mergedIntoId || source.active === false)
          return invalid(issue('sourceId', 'crm.error.alreadyMerged'))
        if (target.mergedIntoId || target.active === false)
          return invalid(issue('targetId', 'crm.error.alreadyMerged'))
        const timestamp = now()
        const changed = await tx.db.compareAndSet(
          'crm.Case',
          { id: args.targetId },
          { version: args.expectedTargetVersion },
          { version: n(target.version) + 1, updatedAt: timestamp },
        )
        if (!('dryRun' in changed) && !changed.matched)
          return invalid(issue('version', 'crm.error.stageConflict', { current: target.version }))
        for (const join of await tx.db.select('crm.CaseTag', { caseId: args.sourceId }))
          await tx.db.insertIfAbsent('crm.CaseTag', {
            id: `${String(args.targetId)}:${String(join.tagId)}`,
            caseId: args.targetId,
            tagId: join.tagId,
          })
        // Everything the source carries moves with it. A merge that left the
        // timeline and the meetings behind buried them on an archived record
        // nobody opens again.
        for (const model of ['crm.Message', 'crm.ActivityLink', 'crm.TimelineEntry'] as const)
          for (const row of await tx.db.select(model, { caseId: args.sourceId }))
            await tx.db.update(model, { id: row.id }, { caseId: args.targetId })
        for (const link of await tx.db.select('crm.CalendarLink', { caseId: args.sourceId })) {
          const held = (
            await tx.db.select('crm.CalendarLink', { caseId: args.targetId, eventId: link.eventId })
          )[0]
          if (held)
            await tx.db.del(
              deleteFrom(tx.table('crm.CalendarLink')).where(eq(tx.table('crm.CalendarLink').id, link.id)),
            )
          else await tx.db.update('crm.CalendarLink', { id: link.id }, { caseId: args.targetId })
        }
        const [targetDetail, sourceDetail] = await Promise.all([
          tx.db.select('crm.SalesDetail', { caseId: args.targetId }),
          tx.db.select('crm.SalesDetail', { caseId: args.sourceId }),
        ])
        const kept = targetDetail[0]
        const dropped = sourceDetail[0]
        // The target's own figures win; the source only fills a blank, which is
        // what makes merging a bare duplicate into a qualified record safe.
        if (kept && dropped) {
          const carried: Row = {}
          if (!Number(kept.expectedRevenue) && Number(dropped.expectedRevenue))
            carried.expectedRevenue = dropped.expectedRevenue
          if (!Number(kept.recurringRevenue) && Number(dropped.recurringRevenue))
            carried.recurringRevenue = dropped.recurringRevenue
          if (!Number(kept.probability) && Number(dropped.probability))
            carried.probability = dropped.probability
          if (!kept.expectedClosing && dropped.expectedClosing)
            carried.expectedClosing = dropped.expectedClosing
          if (Object.keys(carried).length) await tx.db.update('crm.SalesDetail', { id: kept.id }, carried)
        }
        await tx.db.update(
          'crm.Case',
          { id: args.sourceId },
          {
            active: false,
            terminalState: source.terminalState,
            mergedIntoId: args.targetId,
            closedAt: (source.closedAt as string | null) ?? timestamp,
            version: n(source.version) + 1,
            updatedAt: timestamp,
          },
        )
        await addTimeline(tx, {
          id: `timeline:${String(args.targetId)}:merge:${String(args.idempotencyKey)}`,
          caseId: String(args.targetId),
          eventType: 'merged',
          body: 'crm.timeline.merged',
          metadata: { sourceId: args.sourceId, sourceName: source.name },
          occurredAt: timestamp,
        })
        return { ok: true, id: args.targetId, version: n(target.version) + 1 }
      })
    },
  }),

  'case.markWon': defineFn({
    input: { id: 'id', expectedVersion: 'int', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', version: 'int?', terminalState: 'text?', errors: 'json?' },
    effects: [
      'read:crm.Case',
      'write:crm.Case',
      'read:crm.Stage',
      'write:crm.TimelineEntry',
      'read:crm.TeamMember',
      'read:user.User',
      'enqueue:crm.gamification',
    ],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      moveToTerminal(ctx, {
        id: String(args.id),
        expectedVersion: Number(args.expectedVersion),
        idempotencyKey: String(args.idempotencyKey),
        terminal: 'won',
      }),
  }),

  'case.markLost': defineFn({
    input: { id: 'id', expectedVersion: 'int', lostReason: 'text', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', version: 'int?', terminalState: 'text?', errors: 'json?' },
    effects: [
      'read:crm.Case',
      'write:crm.Case',
      'read:crm.Stage',
      'read:crm.SalesDetail',
      'write:crm.SalesDetail',
      'write:crm.TimelineEntry',
      'read:crm.TeamMember',
      'read:user.User',
      'enqueue:crm.gamification',
    ],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      moveToTerminal(ctx, {
        id: String(args.id),
        expectedVersion: Number(args.expectedVersion),
        lostReason: String(args.lostReason),
        idempotencyKey: String(args.idempotencyKey),
        terminal: 'lost',
      }),
  }),

  'case.detectDuplicates': defineFn({
    input: { id: 'id?', email: 'text?', phone: 'text?', name: 'text?', limit: 'int?' },
    output: { rows: 'json' },
    effects: [...caseReadEffects],
    agent: true,
    handler: async (ctx, args) => ({
      rows: await duplicateCases(ctx, args, n(args.limit ?? 20) || 20),
    }),
  }),

  'case.addMessage': defineFn({
    input: { id: 'id', caseId: 'id', body: 'text', visibility: 'text', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:crm.Case',
      'read:crm.Message',
      'write:crm.Message',
      'write:crm.TimelineEntry',
      'read:crm.TeamMember',
      'read:user.User',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      return addCaseMessage(ctx, {
        id: String(args.id),
        caseId: String(args.caseId),
        body: String(args.body),
        visibility: String(args.visibility),
      })
    },
  }),

  'case.refreshScore': defineFn({
    input: { id: 'id', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', score: 'decimal?', reasons: 'json?', errors: 'json?' },
    effects: [
      'read:crm.Case',
      'write:crm.Case',
      'read:crm.ScoreRule',
      'read:crm.ScoreHistory',
      'write:crm.ScoreHistory',
      'read:crm.TeamMember',
      'read:user.User',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      return error ?? refreshCaseScore(ctx, String(args.id), String(args.idempotencyKey))
    },
  }),

  /**
   * The CRM's own activity list.
   *
   * The planner used to read `activity.listMy`, which answers with every
   * activity the user owns anywhere in the suite — a stock transfer, a purchase
   * order, an invoice — and carries no way back to the record it belongs to. So
   * the CRM planner showed work from other apps and, for its own rows, showed a
   * summary the user could not navigate from. This one is scoped to cases the
   * actor may see and names the case on every row.
   */
  'activity.listMine': defineFn({
    input: { today: 'date?', includeDone: 'bool?', mine: 'bool?', limit: 'int?' },
    output: {
      id: 'id',
      summary: 'text',
      dueDate: 'date',
      doneAt: 'datetime?',
      canceledAt: 'datetime?',
      assigneeUserId: 'id?',
      caseId: 'id',
      caseName: 'text',
      state: 'text',
    },
    effects: [
      'read:crm.ActivityLink',
      'read:crm.Case',
      'read:crm.TeamMember',
      'read:activity.Activity',
      'read:user.User',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const links = await ctx.db.select('crm.ActivityLink')
      if (!links.length) return []
      const A = ctx.table('activity.Activity')
      let query = from(A).where(
        inArray(
          A.id,
          links.map((link) => link.activityId),
        ),
      )
      if (args.mine !== false && ctx.actor) query = query.where(eq(A.assigneeUserId, ctx.actor))
      if (args.includeDone !== true) query = query.where(eq(A.active, true), isNull(A.doneAt))
      const activities = await ctx.db.all(query.orderBy(asc(A.dueDate), asc(A.id)))
      if (!activities.length) return []
      const caseIds = [...new Set(links.map((link) => String(link.caseId)))]
      const C = ctx.table('crm.Case')
      const cases = await ctx.db.all(from(C).where(inArray(C.id, caseIds)))
      // The same audience filter every other CRM read uses, so the planner
      // cannot become a way to see cases the list screen hides.
      const visible = new Map((await visibleCases(ctx, cases)).map((row) => [String(row.id), row]))
      const caseByActivity = new Map(links.map((link) => [String(link.activityId), String(link.caseId)]))
      // `today` dates the row rather than filtering it, which is how
      // `activity.listMy` reads it too: a planner that hid tomorrow's calls
      // would not be a planner.
      const today = String(args.today ?? '')
      const stateOf = (activity: Row): string =>
        activity.doneAt
          ? 'done'
          : activity.canceledAt
            ? 'cancelled'
            : !today
              ? 'planned'
              : String(activity.dueDate) < today
                ? 'overdue'
                : String(activity.dueDate) === today
                  ? 'today'
                  : 'planned'
      return activities
        .flatMap((activity) => {
          const caseId = caseByActivity.get(String(activity.id))
          const held = caseId ? visible.get(caseId) : undefined
          return held ? [{ ...activity, caseId, caseName: held.name, state: stateOf(activity) }] : []
        })
        .slice(0, Math.max(1, Math.min(200, n(args.limit ?? 100))))
    },
  }),

  'activity.schedule': defineFn({
    input: {
      id: 'id',
      caseId: 'id',
      typeId: 'id?',
      assigneeUserId: 'id?',
      summary: 'text',
      note: 'text?',
      dueDate: 'date',
      idempotencyKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', activity: 'json?', errors: 'json?' },
    effects: [...activityEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => scheduleCaseActivity(ctx, args as never),
  }),

  'activity.complete': defineFn({
    input: { id: 'id', feedback: 'text?', completedDate: 'date', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', activity: 'json?', nextActivity: 'json?', errors: 'json?' },
    effects: [...activityEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => completeCaseActivity(ctx, args as never),
  }),

  'activity.cancel': defineFn({
    input: { id: 'id', feedback: 'text?', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', activity: 'json?', errors: 'json?' },
    effects: [...activityEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => cancelCaseActivity(ctx, args as never),
  }),

  'plan.apply': defineFn({
    input: { caseId: 'id', planId: 'id', anchorDate: 'date', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', activities: 'json?', errors: 'json?' },
    effects: [...activityEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => applyCasePlan(ctx, args as never),
  }),

  'calendar.list': defineFn({
    input: { caseId: 'id?', from: 'datetime?', to: 'datetime?', cursor: 'text?', limit: 'int?' },
    output: { events: 'json', total: 'int', nextCursor: 'text?' },
    effects: [
      'read:crm.CalendarLink',
      'read:crm.Case',
      'read:calendar.Event',
      'read:user.User',
      'read:crm.TeamMember',
    ],
    handler: async (ctx, args) => {
      const links = args.caseId
        ? await ctx.db.select('crm.CalendarLink', { caseId: args.caseId })
        : await ctx.db.select('crm.CalendarLink')
      const caseIds = [...new Set(links.map((link) => String(link.caseId)))]
      const cases = caseIds.length
        ? await ctx.db.all(from(ctx.table('crm.Case')).where(inArray(ctx.table('crm.Case').id, caseIds)))
        : []
      const visible = new Set((await serializeCaseList(ctx, cases)).map((row) => String(row.id)))
      const eventIds = links.filter((link) => visible.has(String(link.caseId))).map((link) => link.eventId)
      let events = eventIds.length
        ? await ctx.db.all(
            from(ctx.table('calendar.Event'))
              .where(
                inArray(ctx.table('calendar.Event').id, eventIds),
                eq(ctx.table('calendar.Event').active, true),
              )
              .orderBy(asc(ctx.table('calendar.Event').startAt)),
          )
        : []
      if (args.from)
        events = events.filter(
          (event) =>
            new Date(String(event.startAt ?? event.startDate)).getTime() >=
            new Date(String(args.from)).getTime(),
        )
      if (args.to)
        events = events.filter(
          (event) =>
            new Date(String(event.startAt ?? event.startDate)).getTime() <=
            new Date(String(args.to)).getTime(),
        )
      const caseBy = new Map(cases.map((row) => [String(row.id), row]))
      const caseIdByEvent = new Map(
        links
          .filter((link) => visible.has(String(link.caseId)))
          .map((link) => [String(link.eventId), String(link.caseId)]),
      )
      const enriched = events.map((event) => {
        const linkedCaseId = caseIdByEvent.get(String(event.id))
        return {
          ...event,
          caseId: linkedCaseId ?? null,
          caseName: linkedCaseId ? (caseBy.get(linkedCaseId)?.name ?? linkedCaseId) : null,
        }
      })
      const offset = Math.max(0, Number.parseInt(String(args.cursor ?? '0'), 10) || 0)
      const limit = Math.max(1, Math.min(500, n(args.limit ?? 100)))
      return {
        events: enriched.slice(offset, offset + limit),
        total: enriched.length,
        nextCursor: offset + limit < enriched.length ? String(offset + limit) : null,
      }
    },
  }),

  'gamification.refresh': defineFn({
    input: { userId: 'id?', limit: 'int?', idempotencyKey: 'text' },
    output: { ok: 'bool', profiles: 'json?', errors: 'json?' },
    effects: [
      'read:user.User',
      'read:crm.Case',
      'read:activity.Activity',
      'read:crm.GamificationProfile',
      'write:crm.GamificationProfile',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      const users = args.userId
        ? await ctx.db.select('user.User', { id: args.userId, active: true })
        : (await ctx.db.select('user.User', { active: true })).slice(
            0,
            Math.max(1, Math.min(500, n(args.limit ?? 200))),
          )
      /**
       * Counted per user rather than by loading the pipeline into memory.
       *
       * The previous shape read every case, every activity and every link on
       * every refresh, so the leaderboard grew a full-table scan per company as
       * the pipeline grew. Each figure is now a counting query the
       * `(companyId, assigneeUserId, …)` indexes already serve.
       */
      const profiles: Row[] = []
      for (const user of users) profiles.push(await gamificationProfile(ctx, user))
      return {
        ok: true,
        profiles: profiles.sort(
          (a, b) => n(b.points) - n(a.points) || String(a.id).localeCompare(String(b.id)),
        ),
      }
    },
  }),

  'gamification.list': defineFn({
    input: { limit: 'int?' },
    output: { profiles: 'json' },
    effects: ['read:crm.GamificationProfile', 'read:user.User'],
    handler: async (ctx, args) => {
      const users = new Map((await ctx.db.select('user.User')).map((user) => [String(user.id), user]))
      const profiles = (await ctx.db.select('crm.GamificationProfile'))
        .sort((a, b) => n(b.points) - n(a.points) || String(a.id).localeCompare(String(b.id)))
        .slice(0, Math.max(1, Math.min(200, n(args.limit ?? 50))))
        .map((profile) => ({
          ...profile,
          userName: users.get(String(profile.userId))?.name ?? profile.userId,
        }))
      return { profiles }
    },
  }),

  /**
   * The lists the relational pickers page through.
   *
   * Each one takes the `search` and `limit` the picker sends on every keystroke
   * and returns a plain array, which is the shape `backend:relation.select`
   * reads. They exist so a user filling in a case never has to leave the form to
   * find a team, a stage or a tag.
   */
  'team.list': defineFn({
    input: { search: 'text?', limit: 'int?', includeArchived: 'bool?' },
    output: { id: 'id', code: 'text', name: 'text', assignmentMode: 'text', active: 'bool' },
    effects: ['read:crm.Team'],
    agent: true,
    handler: (ctx, args) => optionRows(ctx, 'crm.Team', args),
  }),

  'stage.list': defineFn({
    input: { search: 'text?', limit: 'int?', kind: 'text?', includeArchived: 'bool?' },
    output: {
      id: 'id',
      code: 'text',
      name: 'text',
      sequence: 'int',
      terminalState: 'text',
      allowedKinds: 'json',
      active: 'bool',
    },
    effects: ['read:crm.Stage'],
    agent: true,
    handler: async (ctx, args) => {
      const rows = await optionRows(ctx, 'crm.Stage', args, (a, b) => n(a.sequence) - n(b.sequence))
      return args.kind ? rows.filter((row) => stageKinds(row).includes(String(args.kind))) : rows
    },
  }),

  'tag.list': defineFn({
    input: { search: 'text?', limit: 'int?', includeArchived: 'bool?' },
    output: { id: 'id', name: 'text', color: 'text?', active: 'bool' },
    effects: ['read:crm.Tag'],
    agent: true,
    handler: (ctx, args) => optionRows(ctx, 'crm.Tag', args),
  }),

  /**
   * Tags were reachable from the data model and from `case.save`, but nothing
   * could create one — so the field could never hold a value. This is the
   * missing half, shaped for the picker's inline editor: an id and a name, no
   * idempotency key, because the picker mints the id itself.
   */
  'tag.save': defineFn({
    input: { id: 'id', name: 'text', color: 'text?', active: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:crm.Tag', 'write:crm.Tag'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const name = String(args.name ?? '').trim()
      if (!name) return invalid(issue('name', 'crm.error.required'))
      const existing = (await ctx.db.select('crm.Tag', { id: args.id }))[0]
      const clash = (await ctx.db.select('crm.Tag', { name })).find((row) => row.id !== args.id)
      if (clash) return invalid(issue('name', 'crm.error.duplicateName'))
      const values = {
        name,
        color: args.color ? String(args.color) : (existing?.color ?? null),
        active: args.active ?? existing?.active ?? true,
      }
      if (existing) await ctx.db.update('crm.Tag', { id: args.id }, values)
      else await ctx.db.insert('crm.Tag', { id: args.id, ...values })
      return { ok: true, id: args.id }
    },
  }),

  'tag.archive': defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:crm.Tag', 'write:crm.Tag', 'read:crm.CaseTag', 'write:crm.CaseTag'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('crm.Tag', { id: args.id }))[0]
      if (!existing) return invalid(issue('id', 'crm.error.notFound'))
      await ctx.db.update('crm.Tag', { id: args.id }, { active: false })
      const CT = ctx.table('crm.CaseTag')
      await ctx.db.del(deleteFrom(CT).where(eq(CT.tagId, args.id)))
      return { ok: true, id: args.id }
    },
  }),

  /**
   * Cases as picker rows, for the fields that point at another case — today the
   * merge source. `case.list` answers a paged envelope, which the picker cannot
   * read, so this returns the array it expects under the same audience filter.
   */
  'case.options': defineFn({
    input: { search: 'text?', limit: 'int?', kind: 'text?', excludeId: 'id?' },
    output: { id: 'id', name: 'text', ref: 'text?', kind: 'text' },
    effects: [...caseReadEffects],
    agent: true,
    handler: async (ctx, args) => {
      const found = await listCases(ctx, {
        ...(args.search ? { search: args.search } : {}),
        ...(args.kind ? { kind: args.kind } : {}),
        limit: Math.max(1, Math.min(100, n(args.limit ?? 40))),
      })
      return found.rows
        .filter((row) => !args.excludeId || row.id !== args.excludeId)
        .map((row) => ({
          id: row.id,
          name: row.name,
          kind: row.kind,
          ref: [row.stageName, row.partnerName ?? row.email ?? row.phone].filter(Boolean).join(' · '),
        }))
    },
  }),

  'team.member.list': defineFn({
    input: { teamId: 'id?', search: 'text?', limit: 'int?' },
    output: {
      id: 'id',
      teamId: 'id',
      userId: 'id',
      userName: 'text?',
      capacity: 'int',
      sequence: 'int',
      assignedCount: 'int',
      active: 'bool',
    },
    effects: ['read:crm.TeamMember', 'read:user.User'],
    agent: true,
    handler: async (ctx, args) => {
      const rows = args.teamId
        ? await ctx.db.select('crm.TeamMember', { teamId: args.teamId })
        : await ctx.db.select('crm.TeamMember')
      const users = new Map((await ctx.db.select('user.User')).map((user) => [String(user.id), user]))
      const needle = normalized(args.search)
      const named: Row[] = rows.map((row) => ({
        ...row,
        userName: users.get(String(row.userId))?.name ?? String(row.userId),
      }))
      return named
        .filter((row) => !needle || normalized(row.userName).includes(needle))
        .sort((a, b) => n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id)))
        .slice(0, Math.max(1, Math.min(200, n(args.limit ?? 100))))
    },
  }),

  'team.member.remove': defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:crm.TeamMember', 'write:crm.TeamMember'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('crm.TeamMember', { id: args.id }))[0]
      if (!existing) return invalid(issue('id', 'crm.error.notFound'))
      await ctx.db.update('crm.TeamMember', { id: args.id }, { active: false })
      return { ok: true, id: args.id }
    },
  }),

  'configuration.get': defineFn({
    input: {},
    output: {
      teams: 'json',
      stages: 'json',
      assignmentRules: 'json',
      scoreRules: 'json',
    },
    effects: [
      'read:crm.Team',
      'read:crm.TeamMember',
      'read:crm.Stage',
      'read:crm.AssignmentRule',
      'read:crm.ScoreRule',
    ],
    handler: async (ctx) => {
      const [teams, members, stages, assignmentRules, scoreRules] = await Promise.all([
        ctx.db.select('crm.Team'),
        ctx.db.select('crm.TeamMember'),
        ctx.db.select('crm.Stage'),
        ctx.db.select('crm.AssignmentRule'),
        ctx.db.select('crm.ScoreRule'),
      ])
      const membersByTeam = new Map<string, Row[]>()
      for (const member of members) {
        const key = String(member.teamId)
        const rows = membersByTeam.get(key) ?? []
        rows.push(member)
        membersByTeam.set(key, rows)
      }
      return {
        teams: teams.map((team) => ({ ...team, members: membersByTeam.get(String(team.id)) ?? [] })),
        stages,
        assignmentRules,
        scoreRules,
      }
    },
  }),

  'team.save': saveConfiguration('crm.Team', (args, existing) => ({
    code: String(args.code ?? existing?.code ?? args.id).trim(),
    name: String(args.name ?? '').trim(),
    active: args.active ?? existing?.active ?? true,
    leaderUserId: args.leaderUserId ?? existing?.leaderUserId ?? null,
    assignmentMode: ASSIGNMENT_MODES.includes(args.assignmentMode as never)
      ? args.assignmentMode
      : (existing?.assignmentMode ?? 'manual'),
    assignmentCursor: existing?.assignmentCursor ?? 0,
    version: n(existing?.version) + 1,
  })),
  'team.member.save': defineFn({
    input: {
      id: 'id',
      teamId: 'id',
      userId: 'id',
      capacity: 'int?',
      sequence: 'int?',
      active: 'bool?',
      idempotencyKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:crm.Team', 'read:crm.TeamMember', 'write:crm.TeamMember', 'read:user.User'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      const [team, user] = await Promise.all([
        ctx.db.select('crm.Team', { id: args.teamId, active: true }),
        ctx.db.select('user.User', { id: args.userId, active: true }),
      ])
      if (!team[0]) return invalid(issue('teamId', 'crm.error.notFound'))
      if (!user[0]) return invalid(issue('userId', 'crm.error.notFound'))
      const existing = (await ctx.db.select('crm.TeamMember', { id: args.id }))[0]
      const values = {
        teamId: args.teamId,
        userId: args.userId,
        capacity: Math.max(1, n(args.capacity ?? existing?.capacity ?? 1)),
        sequence: n(args.sequence ?? existing?.sequence ?? 10),
        active: args.active ?? existing?.active ?? true,
        assignedCount: n(existing?.assignedCount),
        lastAssignedAt: existing?.lastAssignedAt ?? null,
      }
      if (existing) await ctx.db.update('crm.TeamMember', { id: args.id }, values)
      else await ctx.db.insert('crm.TeamMember', { id: args.id, ...values })
      return { ok: true, id: args.id }
    },
  }),
  'stage.save': saveConfiguration('crm.Stage', (args, existing) => ({
    code: String(args.code ?? existing?.code ?? args.id).trim(),
    name: String(args.name ?? '').trim(),
    sequence: n(args.sequence ?? existing?.sequence ?? 10),
    allowedKinds: Array.isArray(args.allowedKinds)
      ? args.allowedKinds.map(String).filter((kind) => CASE_KINDS.includes(kind as never))
      : (existing?.allowedKinds ?? ['lead', 'opportunity']),
    terminalState: TERMINAL_STATES.includes(args.terminalState as never)
      ? args.terminalState
      : (existing?.terminalState ?? 'open'),
    teamId: args.teamId ?? existing?.teamId ?? null,
    fold: args.fold ?? existing?.fold ?? false,
    active: args.active ?? existing?.active ?? true,
  })),
  'assignmentRule.save': saveConfiguration('crm.AssignmentRule', (args, existing) => ({
    name: String(args.name ?? '').trim(),
    priority: n(args.priority ?? existing?.priority ?? 10),
    allowedKinds: Array.isArray(args.allowedKinds)
      ? args.allowedKinds.map(String)
      : (existing?.allowedKinds ?? []),
    teamId: args.teamId ?? existing?.teamId,
    assigneeUserId: args.assigneeUserId ?? existing?.assigneeUserId ?? null,
    utmSource: args.utmSource ?? existing?.utmSource ?? null,
    minimumScore: args.minimumScore ?? existing?.minimumScore ?? null,
    active: args.active ?? existing?.active ?? true,
  })),
  'scoreRule.save': saveConfiguration('crm.ScoreRule', (args, existing) => ({
    name: String(args.name ?? '').trim(),
    field: String(args.field ?? '').trim(),
    operator: String(args.operator ?? 'eq'),
    value: String(args.value ?? ''),
    points: String(args.points ?? '0'),
    active: args.active ?? existing?.active ?? true,
    sequence: n(args.sequence ?? existing?.sequence ?? 10),
  })),
  'enrichment.preview': defineFn({
    input: { caseId: 'id' },
    output: { ok: 'bool', code: 'text', errors: 'json?' },
    effects: ['read:crm.Case'],
    handler: async (ctx, args) => ({
      ok: false,
      code: (await ensureCase(ctx, args.caseId)) ? 'provider_not_configured' : 'case_not_found',
    }),
  }),
  'mining.preview': defineFn({
    input: { country: 'text?', industry: 'text?' },
    output: { ok: 'bool', code: 'text' },
    effects: [],
    handler: () => ({ ok: false, code: 'provider_not_configured' }),
  }),
}

export const createCaseId = (): string => randomUUID()
