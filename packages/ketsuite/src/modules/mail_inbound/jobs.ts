import { deleteFrom, eq, from } from 'ketjs'
import type { JobContext, JobSpec } from 'ketjs'

export const jobs: Record<string, JobSpec> = {
  retain: {
    queue: 'maintenance',
    input: { cutoff: 'datetime' },
    effects: [
      'read:mail_inbound.InboundEvent',
      'write:mail_inbound.InboundEvent',
      'read:mail_inbound.ReplyToken',
      'write:mail_inbound.ReplyToken',
    ],
    idempotent: true,
    handler: async (ctx: JobContext, args) => {
      const I = ctx.table('mail_inbound.InboundEvent')
      const events = await ctx.db.all(from(I))
      for (const event of events
        .filter((row) => row.state !== 'processed' && String(row.receivedAt) < String(args.cutoff))
        .slice(0, 1_000))
        await ctx.db.del(deleteFrom(I).where(eq(I.id, event.id)))
      const R = ctx.table('mail_inbound.ReplyToken')
      const tokens = await ctx.db.all(from(R))
      for (const token of tokens
        .filter((row) => !row.active || String(row.expiresAt) < String(args.cutoff))
        .slice(0, 1_000))
        await ctx.db.del(deleteFrom(R).where(eq(R.id, token.id)))
    },
  },
}
