import { asc, defineFn, eq, from, inArray, isNull } from '@ketvietlab/ketjs'
import type { FnSpec, Row } from '@ketvietlab/ketjs'
import {
  applyCasePlan,
  cancelCaseActivity,
  completeCaseActivity,
  n,
  scheduleCaseActivity,
  serializeCaseList,
  visibleCases,
} from '../operations.ts'
import { activityEffects } from './shared.ts'

export const activityFunctions: Record<string, FnSpec> = {
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
}
