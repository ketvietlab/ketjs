import { randomUUID } from 'node:crypto'
import type { Ctx } from '@ketvietlab/ketjs'

export type SubmissionAction = 'read' | 'export' | 'purge' | 'hold' | 'release'

export type AuditEntry = {
  formId: unknown
  action: SubmissionAction
  submissionId?: string | null
  fields?: string[] | null
  rowCount?: number | null
  reason?: string | null
  at?: Date
}

/**
 * A scheduled pass has no actor, and `system` says so plainly.
 *
 * The alternative — leaving the column null — makes "nobody was logged in" and
 * "we forgot to record who" the same row, and only one of those is acceptable
 * in a record whose whole job is to say who.
 */
export const actorKeyOf = (ctx: Ctx): string => (ctx.actor ? String(ctx.actor) : 'system')

/**
 * Write down that someone reached the answers.
 *
 * Called on the same adapter as the read it describes, so a read inside a
 * transaction cannot commit while its record rolls back.
 */
export const recordAccess = async (ctx: Ctx, entry: AuditEntry): Promise<void> => {
  const at = entry.at ?? new Date()
  await ctx.db.insert('website_form.FormSubmissionAudit', {
    id: randomUUID(),
    formId: entry.formId,
    submissionId: entry.submissionId ?? null,
    action: entry.action,
    actorKey: actorKeyOf(ctx),
    fields: entry.fields?.length ? entry.fields : null,
    rowCount: entry.rowCount ?? null,
    reason: entry.reason ? String(entry.reason).slice(0, 500) : null,
    occurredAt: at.toISOString(),
  })
}
