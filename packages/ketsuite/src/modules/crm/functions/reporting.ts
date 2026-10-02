import { defineFn, from, inArray } from '@ketvietlab/ketjs'
import type { FnSpec, Row } from '@ketvietlab/ketjs'
import { addTimeline, canEditCase, invalid, issue, now, ownsKind, visibleCases } from '../operations.ts'
import { INTERACTION_CHANNELS, INTERACTION_OUTCOMES, salesReport } from '../reporting.ts'
import { caseReadEffects, caseWriteEffects, command, ensureCase } from './shared.ts'

export const reportingFunctions: Record<string, FnSpec> = {
  'report.sales': defineFn({
    input: { start: 'datetime', end: 'datetime', timezone: 'text?' },
    effects: [...caseReadEffects, 'read:company.Company'],
    agent: true,
    handler: async (ctx, args) => {
      const asOf = now()
      if (
        !Number.isFinite(Date.parse(String(args.start))) ||
        !Number.isFinite(Date.parse(String(args.end))) ||
        Date.parse(String(args.start)) >= Date.parse(String(args.end)) ||
        Date.parse(String(args.start)) >= Date.parse(asOf) ||
        Date.parse(String(args.end)) - Date.parse(String(args.start)) > 3660 * 86400000
      )
        return invalid(issue('start', 'crm.error.invalidReportPeriod'))
      const timezone = String(args.timezone ?? 'UTC')
      try {
        new Intl.DateTimeFormat('en', { timeZone: timezone }).format()
      } catch {
        return invalid(issue('timezone', 'crm.error.invalidTimezone'))
      }
      const cases = await visibleCases(
        ctx,
        (await ctx.db.select('crm.Case', {})).filter((row) => ownsKind(row.kind) && !row.mergedIntoId),
      )
      const ids = cases.map((row) => String(row.id))
      const related = async (model: string, field = 'caseId', values = ids): Promise<Row[]> => {
        if (!values.length) return []
        const table = ctx.table(model)
        return ctx.db.all(from(table).where(inArray(table[field]!, values)))
      }
      const sales = await related('crm.SalesDetail')
      const timeline = await related('crm.TimelineEntry')
      const links = await related('crm.ActivityLink')
      const activities = await related('activity.Activity', 'id', [
        ...new Set(links.map((row) => String(row.activityId))),
      ])
      const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
      const report = salesReport({
        cases,
        sales,
        timeline,
        links,
        activities,
        start: String(args.start),
        end: String(args.end),
        asOf,
        timezone,
      })
      // Compare equally long elapsed windows; historical pipeline is intentionally unavailable.
      const previousEnd = String(args.start)
      const elapsed = Date.parse(report.meta.effectiveEnd) - Date.parse(previousEnd)
      const previousStart = new Date(Date.parse(previousEnd) - elapsed).toISOString()
      const previous = salesReport({
        cases,
        sales,
        timeline,
        links,
        activities,
        start: previousStart,
        end: previousEnd,
        asOf,
        timezone,
      })
      return {
        ok: true,
        ...report,
        comparison: { start: previousStart, end: previousEnd, period: previous.period },
        meta: { ...report.meta, currency: company?.currency ?? null },
      }
    },
  }),
  'case.logInteraction': defineFn({
    input: {
      id: 'id',
      expectedVersion: 'int',
      channel: 'text',
      outcome: 'text',
      occurredAt: 'datetime?',
      note: 'text?',
      idempotencyKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [...caseWriteEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const refusal = command(ctx, args.idempotencyKey)
      if (refusal) return refusal
      if (!INTERACTION_CHANNELS.includes(args.channel as never))
        return invalid(issue('channel', 'crm.error.invalidInteraction'))
      if (!INTERACTION_OUTCOMES.includes(args.outcome as never))
        return invalid(issue('outcome', 'crm.error.invalidInteraction'))
      return ctx.tx(async (tx) => {
        const held = await ensureCase(tx, args.id)
        if (!held || !(await canEditCase(tx, held))) return invalid(issue('id', 'crm.error.notFound'))
        const eventId = `timeline:${args.id}:interaction:${args.idempotencyKey}`
        const request = JSON.stringify([
          tx.actor,
          args.expectedVersion,
          args.channel,
          args.outcome,
          args.occurredAt ?? null,
          String(args.note ?? '').trim(),
        ])
        const previous = (await tx.db.select('crm.TimelineEntry', { id: eventId }))[0]
        if (previous) {
          const data = previous.metadata as Row
          return data.request === request
            ? { ok: true, id: args.id, version: Number(data.version) }
            : invalid(issue('idempotencyKey', 'crm.error.interactionKeyConflict'))
        }
        const timestamp = now()
        const occurredAt = String(args.occurredAt ?? timestamp)
        if (
          !Number.isFinite(Date.parse(occurredAt)) ||
          Date.parse(occurredAt) < Date.parse(String(held.createdAt)) ||
          Date.parse(occurredAt) > Date.parse(timestamp)
        )
          return invalid(issue('occurredAt', 'crm.error.invalidInteractionTime'))
        const version = Number(held.version) + 1
        const changed = await tx.db.compareAndSet(
          'crm.Case',
          { id: args.id },
          { version: args.expectedVersion },
          { version, updatedAt: timestamp },
        )
        if (!('dryRun' in changed) && !changed.matched)
          return invalid(issue('version', 'crm.error.stageConflict'))
        await addTimeline(tx, {
          id: eventId,
          caseId: String(args.id),
          eventType: 'interaction',
          body: String(args.note ?? '').trim() || 'crm.timeline.interaction',
          customerVisible: false,
          occurredAt,
          metadata: { channel: args.channel, outcome: args.outcome, recordedAt: timestamp, request, version },
        })
        return { ok: true, id: args.id, version }
      })
    },
  }),
}
