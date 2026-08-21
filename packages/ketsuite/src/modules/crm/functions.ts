import { randomUUID } from 'node:crypto'
import { asc, defineFn, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import {
  activeStage,
  actorRequired,
  addCaseMessage,
  addTimeline,
  applyCasePlan,
  assignCase,
  cancelCaseActivity,
  caseDetail,
  commandKey,
  completeCaseActivity,
  ensureCrmDefaults,
  firstStage,
  invalid,
  issue,
  groupCases,
  listCases,
  moveCase,
  n,
  now,
  refreshCaseScore,
  saveCase,
  scheduleCaseActivity,
  serializeCaseList,
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
    if (!held) return invalid(issue('id', 'crm.error.notFound'))
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
        closedAt: held.closedAt,
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
    })
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
        if (!held) return invalid(issue('id', 'crm.error.notFound'))
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
      'write:crm.TimelineEntry',
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
        if (target.kind !== source.kind) return invalid(issue('sourceId', 'crm.error.invalidKind'))
        const changed = await tx.db.compareAndSet(
          'crm.Case',
          { id: args.targetId },
          { version: args.expectedTargetVersion },
          { version: n(target.version) + 1, updatedAt: now() },
        )
        if (!('dryRun' in changed) && !changed.matched)
          return invalid(issue('version', 'crm.error.stageConflict', { current: target.version }))
        for (const join of await tx.db.select('crm.CaseTag', { caseId: args.sourceId }))
          await tx.db.insertIfAbsent('crm.CaseTag', {
            id: `${String(args.targetId)}:${String(join.tagId)}`,
            caseId: args.targetId,
            tagId: join.tagId,
          })
        for (const message of await tx.db.select('crm.Message', { caseId: args.sourceId }))
          await tx.db.update('crm.Message', { id: message.id }, { caseId: args.targetId })
        for (const link of await tx.db.select('crm.ActivityLink', { caseId: args.sourceId }))
          await tx.db.update('crm.ActivityLink', { id: link.id }, { caseId: args.targetId })
        await tx.db.update(
          'crm.Case',
          { id: args.sourceId },
          {
            active: false,
            terminalState: source.terminalState,
            mergedIntoId: args.targetId,
            closedAt: now(),
            version: n(source.version) + 1,
            updatedAt: now(),
          },
        )
        await addTimeline(tx, {
          id: `timeline:${String(args.targetId)}:merge:${String(args.idempotencyKey)}`,
          caseId: String(args.targetId),
          eventType: 'merged',
          body: 'crm.timeline.merged',
          metadata: { sourceId: args.sourceId },
        })
        return { ok: true, id: args.targetId, version: n(target.version) + 1 }
      })
    },
  }),

  'case.markWon': defineFn({
    input: { id: 'id', expectedVersion: 'int', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', version: 'int?', terminalState: 'text?', errors: 'json?' },
    effects: ['read:crm.Case', 'write:crm.Case', 'read:crm.Stage', 'write:crm.TimelineEntry'],
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
    input: { id: 'id?', email: 'text?', phone: 'text?', name: 'text?' },
    output: { rows: 'json' },
    effects: [...caseReadEffects],
    handler: async (ctx, args) => {
      const all = await listCases(ctx, { includeArchived: false, limit: 10_000 })
      const email = String(args.email ?? '')
        .trim()
        .toLowerCase()
      const phone = String(args.phone ?? '').replace(/\D/g, '')
      const name = String(args.name ?? '')
        .trim()
        .toLowerCase()
      const rows = all.rows.filter(
        (row) =>
          row.id !== args.id &&
          ((email && String(row.email ?? '').toLowerCase() === email) ||
            (phone && String(row.phone ?? '').replace(/\D/g, '') === phone) ||
            (name && String(row.name ?? '').toLowerCase() === name)),
      )
      return { rows }
    },
  }),

  'case.addMessage': defineFn({
    input: { id: 'id', caseId: 'id', body: 'text', visibility: 'text', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:crm.Case', 'read:crm.Message', 'write:crm.Message', 'write:crm.TimelineEntry'],
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
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      return error ?? refreshCaseScore(ctx, String(args.id), String(args.idempotencyKey))
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
    input: { userId: 'id?', idempotencyKey: 'text' },
    output: { ok: 'bool', profiles: 'json?', errors: 'json?' },
    effects: [
      'read:user.User',
      'read:crm.Case',
      'read:crm.ActivityLink',
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
        : await ctx.db.select('user.User', { active: true })
      const [cases, links, activities] = await Promise.all([
        ctx.db.select('crm.Case'),
        ctx.db.select('crm.ActivityLink'),
        ctx.db.select('activity.Activity'),
      ])
      const caseBy = new Map(cases.map((held) => [String(held.id), held]))
      const linkByActivity = new Map(links.map((link) => [String(link.activityId), link]))
      const existingProfiles = new Map(
        (await ctx.db.select('crm.GamificationProfile')).map((profile) => [String(profile.id), profile]),
      )
      const completedByUser = new Map<string, number>()
      for (const activity of activities) {
        if (!activity.doneAt) continue
        const link = linkByActivity.get(String(activity.id))
        if (!link || !caseBy.has(String(link.caseId))) continue
        const userId = String(activity.assigneeUserId)
        completedByUser.set(userId, n(completedByUser.get(userId)) + 1)
      }
      const profiles: Row[] = []
      for (const user of users) {
        const owned = cases.filter((held) => held.assigneeUserId === user.id)
        const won = owned.filter((held) => held.terminalState === 'won').length
        const lost = owned.filter((held) => held.terminalState === 'lost').length
        const activitiesDone = completedByUser.get(String(user.id)) ?? 0
        const points = won * 100 + activitiesDone * 10 + Math.max(0, owned.length - lost) * 2
        const id = `gamification:${String(user.id)}`
        const row = {
          userId: user.id,
          points,
          assigned: owned.length,
          won,
          lost,
          activitiesDone,
          streak: won ? Math.min(won, 30) : 0,
          refreshedAt: now(),
        }
        if (existingProfiles.has(id)) await ctx.db.update('crm.GamificationProfile', { id }, row)
        else await ctx.db.insert('crm.GamificationProfile', { id, ...row })
        profiles.push({ id, ...row, userName: user.name })
      }
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
