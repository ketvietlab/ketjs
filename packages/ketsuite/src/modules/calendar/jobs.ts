import { eq, from } from '@ketvietlab/ketjs'
import type { JobContext, JobSpec } from '@ketvietlab/ketjs'
import { postMessage } from '../mail/index.ts'

export const jobs: Record<string, JobSpec> = {
  remind: {
    queue: 'default',
    input: { reminderId: 'id', version: 'int' },
    effects: [
      'read:calendar.Reminder',
      'write:calendar.Reminder',
      'read:calendar.Event',
      'read:calendar.Attendee',
      'read:mail.Thread',
      'read:mail.Message',
      'write:mail.Message',
      'read:mail.Subtype',
      'read:mail.Follower',
      'read:mail.FollowerSubtype',
      'read:user.User',
      'read:partner.Partner',
      'read:storage.Attachment',
      'write:mail.Mention',
      'write:mail.MessageAttachment',
      'write:mail.TrackingValue',
      'write:mail.Notification',
    ],
    idempotent: true,
    handler: async (ctx: JobContext, args) => {
      // Worker handlers already run on the transaction-bound adapter used for
      // the claim. Starting a nested transaction breaks SQLite and buys no
      // additional atomicity here.
      const R = ctx.table('calendar.Reminder')
      const reminder = await ctx.db.one(from(R).where(eq(R.id, args.reminderId)))
      if (!reminder?.active || reminder.version !== args.version || reminder.sentAt) return
      const E = ctx.table('calendar.Event')
      const event = await ctx.db.one(from(E).where(eq(E.id, reminder.eventId)))
      if (!event?.active || event.version !== args.version) return
      const A = ctx.table('calendar.Attendee')
      const attendees = await ctx.db.all(from(A).where(eq(A.eventId, event.id)))
      const partnerIds = attendees.flatMap((row) =>
        row.state !== 'declined' && row.partnerId ? [String(row.partnerId)] : [],
      )
      const messageId = `calendar:reminder:${String(reminder.id)}:v${String(args.version)}`
      const M = ctx.table('mail.Message')
      if (!(await ctx.db.one(from(M).where(eq(M.id, messageId)))))
        await postMessage(ctx, {
          id: messageId,
          threadId: String(event.threadId),
          authorUserId: String(event.organizerUserId),
          kind: 'system',
          body: `Nhắc lịch: ${String(event.name)}`,
          mentionPartnerIds: partnerIds,
        })
      await ctx.db.update('calendar.Reminder', { id: reminder.id }, { sentAt: new Date().toISOString() })
    },
  },
}
