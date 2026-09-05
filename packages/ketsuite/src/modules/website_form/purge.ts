import { asc, eq, from, isNotNull, isNull, lte } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { recordAccess } from './audit.ts'
import { PURGE_BATCH, purgePatch, retentionCutoff } from './retention.ts'

export type PurgeOutcome = { erased: number; more: boolean }

/**
 * Erase one form's answers that are past their retention window.
 *
 * Bounded on purpose. A form switched to a ninety-day window after two years
 * of collecting has a very large first pass, and a retention sweep that runs
 * for an hour is a retention sweep that gets killed halfway and retried from
 * the start for ever. `more` says whether another pass has work, so the caller
 * decides how much to do now.
 *
 * Held rows are excluded in the query rather than skipped in the loop: a hold
 * that is filtered afterwards still fills the batch, so a form with five
 * hundred held rows would make every pass do nothing and report nothing left.
 */
export const purgeFormOnce = async (ctx: Ctx, form: Row, now: Date): Promise<PurgeOutcome> => {
  const cutoff = retentionCutoff(form.retentionDays, now)
  if (!cutoff) return { erased: 0, more: false }
  const Submission = ctx.table('website_form.FormSubmission')
  const due = await ctx.db.all(
    from(Submission)
      .where(
        eq(Submission.formId, form.id),
        isNull(Submission.purgedAt),
        isNull(Submission.holdReason),
        lte(Submission.createdAt, cutoff.toISOString()),
      )
      .select(Submission.id)
      .orderBy(asc(Submission.createdAt))
      .limit(PURGE_BATCH + 1),
  )
  const batch = due.slice(0, PURGE_BATCH)
  if (!batch.length) return { erased: 0, more: false }
  const patch = purgePatch(now)
  let erased = 0
  for (const row of batch) {
    // Raced on `purgedAt` so that two passes over the same form — a scheduled
    // one and an administrator pressing the button — cannot both count the
    // same row, and so the audited total is the number of rows that actually
    // changed rather than the number we looked at.
    const changed = await ctx.db.compareAndSet(
      'website_form.FormSubmission',
      { id: row.id },
      { purgedAt: null },
      patch,
    )
    if ('dryRun' in changed || changed.matched) erased += 1
  }
  if (erased)
    await recordAccess(ctx, {
      formId: form.id,
      action: 'purge',
      rowCount: erased,
      reason: `retention:${Number(form.retentionDays)}d`,
      at: now,
    })
  // One record for the pass, not one per row: which rows were erased is written
  // on the rows themselves, in `purgedAt`. An automated erasure that files one
  // audit row per submission grows the audit faster than the data it audits.
  return { erased, more: due.length > batch.length }
}

/** Every form in reach that has a retention window to enforce. */
export const formsWithRetention = async (ctx: Ctx): Promise<Row[]> => {
  const Form = ctx.table('website_form.Form')
  return ctx.db.all(from(Form).where(isNotNull(Form.retentionDays)).orderBy(asc(Form.id)))
}
