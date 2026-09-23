import { defineFn, deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import type { FnSpec, Row } from '@ketvietlab/ketjs'
import {
  activeStage,
  addCaseMessage,
  addTimeline,
  assignCase,
  canEditCase,
  caseDetail,
  duplicateCases,
  firstStage,
  invalid,
  issue,
  groupCases,
  listCases,
  moveCase,
  n,
  now,
  refreshCaseScore,
  pipelineSummary,
  reassignCase,
  saveCase,
  serializeCaseList,
  visibleCases,
} from '../operations.ts'
import { CASE_KINDS } from '../types.ts'
import { caseReadEffects, command, ensureCase, moveToTerminal, caseWriteEffects } from './shared.ts'

export const caseFunctions: Record<string, FnSpec> = {
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
      'read:crm.AccessGrant',
      'read:crm.Team',
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
      'read:crm.AccessGrant',
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

  'case.reassign': defineFn({
    input: {
      id: 'id',
      teamId: 'id',
      assigneeUserId: 'id?',
      reasonCode: 'text',
      reasonNote: 'text?',
      expectedVersion: 'int',
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
      'read:crm.AccessGrant',
      'read:crm.Team',
      'read:crm.TeamMember',
      'read:user.User',
      'read:crm.TimelineEntry',
      'write:crm.TimelineEntry',
    ],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => reassignCase(ctx, args as never),
  }),

  'case.convertLead': defineFn({
    input: {
      id: 'id',
      expectedVersion: 'int',
      stageId: 'id?',
      expectedRevenue: 'decimal?',
      expectedClosing: 'date?',
      idempotencyKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [
      'read:crm.Case',
      'write:crm.Case',
      'read:crm.AccessGrant',
      'read:crm.Team',
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
        if (!held || !(await canEditCase(tx, held))) return invalid(issue('id', 'crm.error.notFound'))
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
        const salesValues = {
          sourceLeadId: args.id,
          ...(args.expectedRevenue === undefined ? {} : { expectedRevenue: String(args.expectedRevenue) }),
          ...(args.expectedClosing === undefined ? {} : { expectedClosing: args.expectedClosing }),
        }
        if (detail) await tx.db.update('crm.SalesDetail', { id: detail.id }, salesValues)
        else
          await tx.db.insert('crm.SalesDetail', {
            id: `sales:${String(args.id)}`,
            caseId: args.id,
            expectedRevenue: String(args.expectedRevenue ?? '0'),
            recurringRevenue: '0',
            probability: '0',
            expectedClosing: args.expectedClosing ?? null,
            forecastCategory: 'pipeline',
            lostReason: null,
            ...salesValues,
          })
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
      'read:crm.AccessGrant',
      'read:crm.Team',
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
        if (!(await canEditCase(tx, target))) return invalid(issue('targetId', 'crm.error.notFound'))
        if (!(await canEditCase(tx, source))) return invalid(issue('sourceId', 'crm.error.notFound'))
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
    input: { id: 'id', expectedVersion: 'int', closeReason: 'text?', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', version: 'int?', terminalState: 'text?', errors: 'json?' },
    effects: [
      'read:crm.Case',
      'write:crm.Case',
      'read:crm.AccessGrant',
      'read:crm.Team',
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
        closeReason: args.closeReason ? String(args.closeReason) : undefined,
      }),
  }),

  'case.markLost': defineFn({
    input: {
      id: 'id',
      expectedVersion: 'int',
      lostReason: 'text',
      closeReason: 'text?',
      idempotencyKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', version: 'int?', terminalState: 'text?', errors: 'json?' },
    effects: [
      'read:crm.Case',
      'write:crm.Case',
      'read:crm.AccessGrant',
      'read:crm.Team',
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
        closeReason: args.closeReason ? String(args.closeReason) : undefined,
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
      'read:crm.SalesDetail',
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
}
