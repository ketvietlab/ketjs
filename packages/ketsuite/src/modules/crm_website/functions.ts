import { createHash } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { caseWriteEffects, commandKey, invalid, issue, now, saveCase } from '../crm/index.ts'

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

/** Submissions per key, per window, claimed without holding a lock. */
const claimSlot = async (
  ctx: Ctx,
  bucket: string,
  key: string,
  limit: number,
  windowMs: number,
  at: Date,
): Promise<boolean> => {
  const id = digest(`${bucket}\n${key}`)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const held = (await ctx.db.select('crm_website.SubmissionRateLimit', { id }))[0]
    if (!held) {
      const inserted = await ctx.db.insertIfAbsent('crm_website.SubmissionRateLimit', {
        id,
        bucket,
        key: key.slice(0, 256),
        windowStartedAt: at.toISOString(),
        count: 1,
      })
      if ('dryRun' in inserted || inserted.inserted) return true
      continue
    }
    const startedAt = new Date(String(held.windowStartedAt))
    const inWindow = at.getTime() - startedAt.getTime() < windowMs
    if (inWindow && Number(held.count) >= limit) return false
    const changed = await ctx.db.compareAndSet(
      'crm_website.SubmissionRateLimit',
      { id },
      { windowStartedAt: held.windowStartedAt, count: held.count },
      inWindow ? { count: Number(held.count) + 1 } : { windowStartedAt: at.toISOString(), count: 1 },
    )
    if ('dryRun' in changed || changed.matched) return true
  }
  return false
}

export const functions: Record<string, FnSpec> = {
  'website.submitLead': defineFn({
    /**
     * The visitor names the lead, never the record.
     *
     * `id` used to be an input, and the public route passed whatever the form
     * posted straight into `saveCase`, which upserts — so a stranger who knew a
     * case id could rewrite that lead and clear its owner. The id is now derived
     * here, inside a namespace no backend-created case can occupy, which keeps
     * the endpoint idempotent without letting it address an existing record.
     */
    input: {
      name: 'text',
      contactName: 'text?',
      email: 'text?',
      phone: 'text?',
      description: 'text?',
      locale: 'text?',
      utmSource: 'text?',
      utmMedium: 'text?',
      utmCampaign: 'text?',
      sourceFingerprint: 'text?',
      idempotencyKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', caseId: 'id?', replayed: 'bool?', errors: 'json?' },
    effects: [
      ...caseWriteEffects,
      'read:crm_website.Submission',
      'write:crm_website.Submission',
      'read:crm_website.SubmissionRateLimit',
      'write:crm_website.SubmissionRateLimit',
      'read:company.Company',
    ],
    idempotent: true,
    anonymous: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!commandKey(args.idempotencyKey))
        return invalid(issue('idempotencyKey', 'crm.error.idempotencyRequired'))
      /**
       * The company the site is served under has to be a real one.
       *
       * Writes are pinned to `scope.company`, and a scope naming a company that
       * was never created discards them without complaint — the submission then
       * failed on the next thing to notice, an empty stage table, and reported
       * "the stage does not accept this record kind" to a visitor. Establishing
       * it here turns a silent drop into a message an operator can act on.
       */
      const company = ctx.scope.company
        ? (await ctx.db.select('company.Company', { id: ctx.scope.company, active: true }))[0]
        : null
      if (!company) return invalid(issue('company', 'crm_website.error.inboxUnavailable'))

      const existing = (
        await ctx.db.select('crm_website.Submission', { idempotencyKey: args.idempotencyKey })
      )[0]
      if (existing?.caseId) return { ok: true, id: existing.id, caseId: existing.caseId, replayed: true }
      const name = String(args.name ?? '').trim()
      const email = String(args.email ?? '').trim()
      const phone = String(args.phone ?? '').trim()
      if (!name) return invalid(issue('name', 'crm.error.required'))
      if (!email && !phone) return invalid(issue('email', 'crm_website.error.contactRequired'))

      // Two buckets: one for the visitor, one for the address they claim. The
      // first slows a script down, the second stops a single mailbox being used
      // to fill the pipeline from many addresses.
      const at = new Date()
      const fingerprint = String(args.sourceFingerprint ?? '').trim() || 'anonymous'
      const allowed =
        (await claimSlot(ctx, 'lead:source', fingerprint, 10, 60 * 60 * 1000, at)) &&
        (!email || (await claimSlot(ctx, 'lead:email', email.toLowerCase(), 5, 60 * 60 * 1000, at)))
      if (!allowed) return invalid(issue('idempotencyKey', 'crm_website.error.rateLimit'))

      const caseId = `website-lead:${digest(`${String(ctx.scope.company)}\n${String(args.idempotencyKey)}`).slice(0, 32)}`
      // A derived id can still name a case that a replay already created, and
      // `saveCase` would happily update it. Nothing arriving from the website is
      // allowed to edit a record, so a collision is reported as a replay.
      const held = (await ctx.db.select('crm.Case', { id: caseId }))[0]
      if (held)
        return { ok: true, id: `website-submission:${String(args.idempotencyKey)}`, caseId, replayed: true }

      const saved = await saveCase(
        ctx,
        {
          id: caseId,
          kind: 'lead',
          name,
          contactName: args.contactName ? String(args.contactName) : null,
          email: email || null,
          phone: phone || null,
          description: args.description ? String(args.description) : null,
          utmSource: args.utmSource ? String(args.utmSource) : 'website',
          utmMedium: args.utmMedium ? String(args.utmMedium) : null,
          utmCampaign: args.utmCampaign ? String(args.utmCampaign) : null,
          priority: '1',
          idempotencyKey: String(args.idempotencyKey),
        },
        { actorRequired: false },
      )
      if (!saved.ok) return saved
      const id = `website-submission:${String(args.idempotencyKey)}`
      const inserted = await ctx.db.insertIfAbsent('crm_website.Submission', {
        id,
        idempotencyKey: args.idempotencyKey,
        caseId,
        locale: args.locale ?? 'vi',
        submittedAt: now(),
        sourceFingerprint: fingerprint === 'anonymous' ? null : digest(fingerprint).slice(0, 32),
      })
      if (!('dryRun' in inserted) && !inserted.inserted) {
        const winner = (
          await ctx.db.select('crm_website.Submission', { idempotencyKey: args.idempotencyKey })
        )[0]
        return { ok: true, id: winner?.id, caseId: winner?.caseId, replayed: true }
      }
      return { ok: true, id, caseId }
    },
  }),
}
