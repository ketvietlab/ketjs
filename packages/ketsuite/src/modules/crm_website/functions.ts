import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'
import { caseWriteEffects, commandKey, invalid, issue, now, saveCase } from '../crm/index.ts'

export const functions: Record<string, FnSpec> = {
  'website.submitLead': defineFn({
    input: {
      id: 'id',
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
    effects: [...caseWriteEffects, 'read:crm_website.Submission', 'write:crm_website.Submission'],
    idempotent: true,
    anonymous: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!commandKey(args.idempotencyKey))
        return invalid(issue('idempotencyKey', 'crm.error.idempotencyRequired'))
      const existing = (
        await ctx.db.select('crm_website.Submission', { idempotencyKey: args.idempotencyKey })
      )[0]
      if (existing?.caseId) return { ok: true, id: existing.id, caseId: existing.caseId, replayed: true }
      if (!String(args.name).trim() || (!String(args.email ?? '').trim() && !String(args.phone ?? '').trim()))
        return invalid(issue('name', 'crm.error.required'))
      const saved = await saveCase(
        ctx,
        {
          id: String(args.id),
          kind: 'lead',
          name: String(args.name),
          contactName: args.contactName ? String(args.contactName) : null,
          email: args.email ? String(args.email) : null,
          phone: args.phone ? String(args.phone) : null,
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
        caseId: args.id,
        locale: args.locale ?? 'vi',
        submittedAt: now(),
        sourceFingerprint: args.sourceFingerprint ?? null,
      })
      if (!('dryRun' in inserted) && !inserted.inserted) {
        const winner = (
          await ctx.db.select('crm_website.Submission', { idempotencyKey: args.idempotencyKey })
        )[0]
        return { ok: true, id: winner?.id, caseId: winner?.caseId, replayed: true }
      }
      return { ok: true, id, caseId: args.id }
    },
  }),
}
