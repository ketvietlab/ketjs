import { asc, defineFn, desc, eq, from, inArray, isNull, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { NOTIFICATION_STATES } from './types.ts'

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

  countInbox: defineFn({
    input: { unreadOnly: 'bool?' },
    output: { count: 'int' },
    effects: ['read:mail.Notification'],
    handler: async (ctx: Ctx, args) => {
      const N = ctx.table('mail.Notification')
      return {
        count: await ctx.db.count(
          from(N).where(
            eq(N.recipientUserId, actor(ctx)),
            ...(args.unreadOnly === true ? [isNull(N.readAt)] : []),
          ),
        ),
      }
    },
  }),

  listInbox: defineFn({
    input: { unreadOnly: 'bool?', limit: 'int?', offset: 'int?' },
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
      targetModel: 'text?',
      targetId: 'text?',
      targetName: 'text?',
    },
    effects: ['read:mail.Notification', 'read:mail.Message', 'read:mail.Thread'],
    handler: async (ctx: Ctx, args) => {
      const limit = Math.max(1, Math.min(100, Number(args.limit ?? 50)))
      const offset = Math.max(0, Number(args.offset ?? 0))
      const N = ctx.table('mail.Notification')
      const notifications = await ctx.db.all(
        from(N)
          .where(eq(N.recipientUserId, actor(ctx)), ...(args.unreadOnly === false ? [] : [isNull(N.readAt)]))
          .orderBy(desc(N.createdAt), desc(N.id))
          .limit(limit)
          .offset(offset),
      )
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
      const threadIds = [...new Set(messages.map((row) => String(row.threadId)))]
      const T = ctx.table('mail.Thread')
      const threads = threadIds.length ? await ctx.db.all(from(T).where(inArray(T.id, threadIds))) : []
      const threadById = new Map(threads.map((row) => [String(row.id), row]))
      return notifications.flatMap((notification) => {
        const message = byId.get(String(notification.messageId))
        const thread = message ? threadById.get(String(message.threadId)) : null
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
                targetModel: thread?.resModel ?? null,
                targetId: thread?.resId ?? null,
                targetName: thread?.displayName ?? null,
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
      if (notification.readAt == null)
        await ctx.db.update('mail.Notification', { id: args.id }, { readAt: args.readAt })
      return { ok: true, id: args.id }
    },
  }),

  markAllInboxRead: defineFn({
    input: { readAt: 'datetime' },
    output: { ok: 'bool', count: 'int', readAt: 'datetime' },
    effects: ['read:mail.Notification', 'write:mail.Notification'],
    idempotent: true,
    handler: (ctx: Ctx, args) =>
      ctx.tx(async (tx) => {
        const N = tx.table('mail.Notification')
        const rows = await tx.db.all(from(N).where(eq(N.recipientUserId, actor(tx)), isNull(N.readAt)))
        for (const row of rows)
          await tx.db.update('mail.Notification', { id: row.id }, { readAt: args.readAt })
        return { ok: true, count: rows.length, readAt: args.readAt }
      }),
  }),
}
