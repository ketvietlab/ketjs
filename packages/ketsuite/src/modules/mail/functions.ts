import { asc, defineFn, eq, from, inArray, isNull, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { NOTIFICATION_STATES } from './types.ts'
import { unreadNotifications } from './operations.ts'

const actor = (ctx: Ctx): string => {
  if (!ctx.actor)
    throw new KetError({
      code: 'E_MAIL_ACTOR_REQUIRED',
      module: 'mail',
      message: 'an inbox operation requires a signed-in user',
    })
  return ctx.actor
}

const subtypeOutput = {
  id: 'id',
  code: 'text',
  name: 'text',
  defaultFollower: 'bool',
  internalOnly: 'bool',
  active: 'bool',
}

export const functions: Record<string, FnSpec> = {
  listSubtypes: defineFn({
    output: subtypeOutput,
    effects: ['read:mail.Subtype'],
    handler: (ctx: Ctx) => {
      const S = ctx.table('mail.Subtype')
      return ctx.db.all(from(S).where(eq(S.active, true)).orderBy(asc(S.name)))
    },
  }),

  saveSubtype: defineFn({
    input: subtypeOutput,
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:mail.Subtype', 'write:mail.Subtype'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const S = ctx.table('mail.Subtype')
      const existing = await ctx.db.one(from(S).where(eq(S.id, args.id)))
      if (!existing && (await ctx.db.one(from(S).where(eq(S.code, args.code)))))
        return { ok: false, errors: [{ field: 'code', message: 'mã loại thông báo đã tồn tại' }] }
      const cs = ctx
        .change('mail.Subtype', args, existing)
        .cast(['id', 'code', 'name', 'defaultFollower', 'internalOnly', 'active'])
        .required(['code', 'name'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),

  countUnread: defineFn({
    output: { count: 'int' },
    effects: ['read:mail.Notification'],
    handler: async (ctx: Ctx) => {
      const N = ctx.table('mail.Notification')
      return { count: await ctx.db.count(from(N).where(eq(N.recipientUserId, actor(ctx)), isNull(N.readAt))) }
    },
  }),

  listInbox: defineFn({
    input: { limit: 'int?' },
    output: {
      id: 'id',
      messageId: 'id',
      threadId: 'id',
      kind: 'text',
      subject: 'text?',
      body: 'text',
      authorPartnerId: 'id?',
      authorUserId: 'id?',
      state: 'text',
      readAt: 'datetime?',
      createdAt: 'datetime',
    },
    effects: ['read:mail.Notification', 'read:mail.Message'],
    handler: async (ctx: Ctx, args) => {
      const notifications = await unreadNotifications(ctx, actor(ctx), Number(args.limit ?? 50))
      if (!notifications.length) return []
      const M = ctx.table('mail.Message')
      const messages = await ctx.db.all(
        from(M).where(
          inArray(
            M.id,
            notifications.map((row) => row.messageId),
          ),
        ),
      )
      const byId = new Map(messages.map((row) => [String(row.id), row]))
      return notifications.flatMap((notification) => {
        const message = byId.get(String(notification.messageId))
        return message
          ? [
              {
                id: notification.id,
                messageId: message.id,
                threadId: message.threadId,
                kind: message.kind,
                subject: message.subject,
                body: message.body,
                authorPartnerId: message.authorPartnerId,
                authorUserId: message.authorUserId,
                state: notification.state,
                readAt: notification.readAt,
                createdAt: notification.createdAt,
              },
            ]
          : []
      })
    },
  }),

  markInboxRead: defineFn({
    input: { id: 'id', readAt: 'datetime' },
    output: { ok: 'bool', id: 'id' },
    effects: ['read:mail.Notification', 'write:mail.Notification'],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const N = ctx.table('mail.Notification')
      const notification = await ctx.db.one(
        from(N).where(eq(N.id, args.id), eq(N.recipientUserId, actor(ctx))),
      )
      if (!notification)
        throw new KetError({
          code: 'E_MAIL_NOTIFICATION_NOT_FOUND',
          module: 'mail',
          message: 'notification does not belong to the signed-in user',
        })
      if (!NOTIFICATION_STATES.includes(notification.state as never))
        throw new KetError({
          code: 'E_MAIL_NOTIFICATION_STATE',
          module: 'mail',
          message: `notification has unknown state "${String(notification.state)}"`,
        })
      await ctx.db.update('mail.Notification', { id: args.id }, { readAt: args.readAt })
      return { ok: true, id: args.id }
    },
  }),
}
