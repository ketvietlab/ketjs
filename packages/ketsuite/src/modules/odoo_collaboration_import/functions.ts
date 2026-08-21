import { asc, defineFn, desc, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { importOdooBatch, odooRollbackManifest, previewOdooBatch } from './operations.ts'

const actor = (ctx: Ctx): string => {
  if (!ctx.actor)
    throw new KetError({
      code: 'E_ODOO_IMPORT_ACTOR_REQUIRED',
      module: 'odoo_collaboration_import',
      message: 'Odoo migration administration requires a signed-in user',
    })
  return ctx.actor
}

const importReads = [
  'read:odoo_collaboration_import.Source',
  'read:odoo_collaboration_import.Run',
  'read:odoo_collaboration_import.Map',
  'read:mail.Thread',
  'read:partner.Partner',
  'read:user.User',
  'read:mail.Subtype',
  'read:activity.Type',
  'read:mail.Message',
  'read:mail.TrackingValue',
  'read:mail.Follower',
  'read:mail.Notification',
  'read:activity.Activity',
  'read:activity.Plan',
  'read:activity.PlanStep',
  'read:calendar.Recurrence',
  'read:calendar.Event',
  'read:calendar.Attendee',
  'read:calendar.Reminder',
  'read:calendar.Tag',
  'read:calendar.EventTag',
  'read:storage.Attachment',
  'read:mail_inbound.AliasDomain',
  'read:mail_inbound.Alias',
  'read:mail_transport.Template',
  'read:mail_transport.Delivery',
] as const

const importWrites = [
  'write:odoo_collaboration_import.Source',
  'write:odoo_collaboration_import.Run',
  'write:odoo_collaboration_import.Map',
  'write:odoo_collaboration_import.Issue',
  'write:mail.Subtype',
  'write:activity.Type',
  'write:mail.Message',
  'write:mail.TrackingValue',
  'write:mail.Follower',
  'write:mail.FollowerSubtype',
  'write:mail.Notification',
  'write:mail.MessageAttachment',
  'write:activity.Activity',
  'write:activity.Attachment',
  'write:activity.Plan',
  'write:activity.PlanStep',
  'write:calendar.Recurrence',
  'write:calendar.Event',
  'write:calendar.Attendee',
  'write:calendar.Reminder',
  'write:calendar.Tag',
  'write:calendar.EventTag',
  'write:storage.Attachment',
  'write:mail_transport.Template',
  'write:mail_transport.Delivery',
  'write:mail_inbound.AliasDomain',
  'write:mail_inbound.Alias',
  'enqueue:mail_transport.deliver',
] as const

export const functions: Record<string, FnSpec> = {
  previewBatch: defineFn({
    input: { batch: 'json' },
    output: { report: 'json' },
    effects: [...importReads],
    agent: true,
    handler: (ctx: Ctx, args) => {
      actor(ctx)
      return ctx.tx(async (tx) => ({ report: await previewOdooBatch(tx, args.batch) }))
    },
  }),

  importBatch: defineFn({
    input: { batch: 'json' },
    output: { report: 'json' },
    effects: [...importReads, ...importWrites],
    idempotent: true,
    agent: true,
    handler: (ctx: Ctx, args) => {
      actor(ctx)
      return ctx.tx(async (tx) => ({ report: await importOdooBatch(tx, args.batch) }))
    },
  }),

  getRun: defineFn({
    input: { id: 'id' },
    output: { run: 'json', issues: 'json' },
    effects: ['read:odoo_collaboration_import.Run', 'read:odoo_collaboration_import.Issue'],
    handler: async (ctx: Ctx, args) => {
      actor(ctx)
      const R = ctx.table('odoo_collaboration_import.Run')
      const run = await ctx.db.one(from(R).where(eq(R.id, args.id)))
      if (!run) throw new Error(`import run ${args.id} does not exist`)
      const I = ctx.table('odoo_collaboration_import.Issue')
      const issues = await ctx.db.all(from(I).where(eq(I.runId, args.id)).orderBy(asc(I.id)))
      return { run, issues }
    },
  }),

  listRuns: defineFn({
    input: { limit: 'int?' },
    output: { runs: 'json' },
    effects: ['read:odoo_collaboration_import.Run'],
    handler: async (ctx: Ctx, args) => {
      actor(ctx)
      const R = ctx.table('odoo_collaboration_import.Run')
      const rows = await ctx.db.all(from(R).orderBy(desc(R.startedAt), desc(R.id)))
      return { runs: rows.slice(0, Math.max(1, Math.min(200, Number(args.limit ?? 100)))) }
    },
  }),

  rollbackManifest: defineFn({
    input: { runId: 'id' },
    output: { manifest: 'json' },
    effects: ['read:odoo_collaboration_import.Run'],
    handler: async (ctx: Ctx, args) => {
      actor(ctx)
      return { manifest: await odooRollbackManifest(ctx, String(args.runId)) }
    },
  }),
}
