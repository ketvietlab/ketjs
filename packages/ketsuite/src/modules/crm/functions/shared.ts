// Helpers and effect lists shared by the CRM function groups.
import { randomUUID } from 'node:crypto'
import { defineFn, defineFormSchema } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import {
  actorRequired,
  addTimeline,
  canEditCase,
  closingValues,
  commandKey,
  invalid,
  issue,
  n,
  normalized,
  now,
} from '../operations.ts'
import { LOST_REASON_CODES } from '../reporting.ts'
import type { CrmResult } from '../operations.ts'

export const caseReadEffects = [
  'read:crm.Case',
  'read:crm.AccessGrant',
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

export const defaultEffects = [
  'read:crm.Team',
  'write:crm.Team',
  'read:crm.Stage',
  'write:crm.Stage',
  'read:activity.Type',
  'write:activity.Type',
] as const

/** Shape rules shared by the long CRM create form and its backend route. */
export const caseFormSchema = (requirements: { partner?: boolean; need?: boolean } = {}) =>
  defineFormSchema({
    fields: {
      name: { type: 'text', required: true, trim: true },
      kind: { type: 'text', required: true, oneOf: ['lead', 'opportunity'] },
      partnerId: { type: 'text', required: requirements.partner === true, trim: true },
      description: { type: 'text', required: requirements.need === true, trim: true },
      utmSource: { type: 'text', trim: true },
      priority: { type: 'text', oneOf: ['0', '1', '2', '3'] },
      expectedRevenue: { type: 'decimal', min: 0 },
      probability: { type: 'decimal', min: 0, max: 100 },
      expectedClosing: { type: 'date' },
    },
    unknown: 'drop',
  })

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

export const activityEffects = [
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

export const command = (ctx: Ctx, key: unknown) => {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'crm.error.actorRequired'))
  if (!commandKey(key)) return invalid(issue('idempotencyKey', 'crm.error.idempotencyRequired'))
  return null
}

export const isSuperuser = async (ctx: Ctx): Promise<boolean> => {
  if (!ctx.actor) return false
  const actor = (await ctx.db.select('user.User', { id: ctx.actor, active: true }))[0]
  return actor?.superuser === true
}

export const accessScopes = new Set(['none', 'self', 'team', 'company'])

export const ensureCase = async (ctx: Ctx, id: unknown): Promise<Row | null> =>
  (await ctx.db.select('crm.Case', { id }))[0] ?? null

/**
 * One shape for the small configuration lists the pickers read: active first,
 * filtered by name, capped so a keystroke never pulls a whole table.
 */
export const optionRows = async (
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
    .slice(
      Math.max(0, Math.trunc(n(args.cursor ?? 0))),
      Math.max(0, Math.trunc(n(args.cursor ?? 0))) +
        Math.max(1, Math.min(200, Math.trunc(n(args.limit ?? 80)))),
    )
}

export async function moveToTerminal(
  ctx: Ctx,
  input: {
    id: string
    expectedVersion: number
    terminal: string
    lostReasonCode?: string
    lostReason?: string
    closeReason?: string
    idempotencyKey: string
  },
) {
  const error = command(ctx, input.idempotencyKey)
  if (error) return error
  return ctx.tx(async (tx) => {
    const held = await ensureCase(tx, input.id)
    if (!held || !(await canEditCase(tx, held))) return invalid(issue('id', 'crm.error.notFound'))
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
    if (input.lostReasonCode && !LOST_REASON_CODES.includes(input.lostReasonCode as never))
      return invalid(issue('lostReasonCode', 'crm.error.invalidLostReason'))
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
        ...closingValues(held, input.terminal, timestamp),
      },
    )
    if (!('dryRun' in changed) && !changed.matched)
      return invalid(issue('version', 'crm.error.stageConflict', { current: held.version }))
    if (input.terminal === 'lost') {
      const detail = (await tx.db.select('crm.SalesDetail', { caseId: input.id }))[0]
      if (detail)
        await tx.db.update(
          'crm.SalesDetail',
          { id: detail.id },
          { lostReason: input.lostReason ?? null, lostReasonCode: input.lostReasonCode || null },
        )
    }
    const event = input.terminal === 'won' ? 'won' : 'lost'
    await addTimeline(tx, {
      id: `timeline:${input.id}:${event}:${input.idempotencyKey}`,
      caseId: input.id,
      eventType: event,
      body: `crm.timeline.${event}`,
      metadata: {
        reason: input.closeReason ?? null,
        lostReasonCode: input.lostReasonCode ?? null,
        ...closingValues(held, input.terminal, timestamp),
      },
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

export const saveConfiguration = (
  model: string,
  prepare: (args: Record<string, unknown>, existing: Row | undefined) => Row,
  validate?: (
    ctx: Ctx,
    args: Record<string, unknown>,
    existing: Row | undefined,
  ) => CrmResult | null | Promise<CrmResult | null>,
  additionalEffects: string[] = [],
) =>
  defineFn({
    input: { values: 'json', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [`read:${model}`, `write:${model}`, ...additionalEffects],
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
      const validation = await validate?.(ctx, values, existing)
      if (validation) return validation
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

export const createCaseId = (): string => randomUUID()
