import { randomBytes } from 'node:crypto'
import { desc, defineFn, eq, from, inArray, KetError } from 'ketjs'
import type { Ctx, FnSpec } from 'ketjs'
import { receiveInbound, tokenDigest } from './operations.ts'

export const inboundMutationEffects = [
  'read:mail_inbound.InboundEvent',
  'write:mail_inbound.InboundEvent',
  'read:mail_inbound.ReplyToken',
  'read:mail_inbound.Alias',
  'read:mail_transport.Delivery',
  'write:mail_transport.Delivery',
  'read:mail_transport.DeliveryNotification',
  'read:mail.Thread',
  'read:mail.Message',
  'write:mail.Message',
  'read:mail.Subtype',
  'read:mail.Follower',
  'read:mail.FollowerSubtype',
  'read:user.User',
  'read:partner.Partner',
  'read:storage.Attachment',
  'write:storage.Attachment',
  'write:mail.Mention',
  'write:mail.MessageAttachment',
  'write:mail.TrackingValue',
  'write:mail.Notification',
]

export const inboundInput = {
  provider: 'text',
  providerEventId: 'text',
  kind: 'text',
  fromAddress: 'text?',
  recipients: 'json',
  subject: 'text?',
  text: 'text?',
  html: 'text?',
  references: 'json?',
  replyToken: 'text?',
  alias: 'text?',
  attachments: 'json?',
  receivedAt: 'datetime',
} as const

export const inboundOutput = {
  id: 'id',
  duplicate: 'bool',
  state: 'text',
  threadId: 'id?',
  messageId: 'id?',
  targetId: 'id?',
} as const

const actor = (ctx: Ctx): string => {
  if (!ctx.actor)
    throw new KetError({
      code: 'E_INBOUND_ACTOR_REQUIRED',
      module: 'mail_inbound',
      message: 'inbound administration requires a signed-in user',
    })
  return ctx.actor
}

export const functions: Record<string, FnSpec> = {
  receiveReply: defineFn({
    input: inboundInput,
    output: inboundOutput,
    effects: inboundMutationEffects,
    idempotent: true,
    handler: (ctx: Ctx, args) =>
      ctx.tx((tx) =>
        receiveInbound(tx, {
          provider: String(args.provider),
          providerEventId: String(args.providerEventId),
          kind: String(args.kind),
          fromAddress: args.fromAddress ? String(args.fromAddress) : undefined,
          recipients: args.recipients,
          subject: args.subject ? String(args.subject) : undefined,
          text: args.text ? String(args.text) : undefined,
          html: args.html ? String(args.html) : undefined,
          references: args.references,
          replyToken: args.replyToken ? String(args.replyToken) : undefined,
          alias: args.alias ? String(args.alias) : undefined,
          attachments: args.attachments,
          receivedAt: String(args.receivedAt),
        }),
      ),
  }),

  createReplyToken: defineFn({
    input: { id: 'id', threadId: 'id', parentMessageId: 'id?', expiresAt: 'datetime' },
    output: { id: 'id', token: 'text', expiresAt: 'datetime' },
    effects: ['read:mail.Thread', 'read:mail.Message', 'write:mail_inbound.ReplyToken'],
    handler: (ctx: Ctx, args) =>
      ctx.tx(async (tx) => {
        actor(tx)
        const T = tx.table('mail.Thread')
        if (!(await tx.db.one(from(T).where(eq(T.id, args.threadId), eq(T.active, true)))))
          throw new Error('reply token thread is missing')
        if (args.parentMessageId) {
          const M = tx.table('mail.Message')
          if (
            !(await tx.db.one(from(M).where(eq(M.id, args.parentMessageId), eq(M.threadId, args.threadId))))
          )
            throw new Error('reply token parent message is not on the thread')
        }
        if (String(args.expiresAt) <= new Date().toISOString())
          throw new Error('reply token expiry must be in the future')
        const token = randomBytes(32).toString('base64url')
        await tx.db.insert('mail_inbound.ReplyToken', {
          id: args.id,
          tokenDigest: tokenDigest(token),
          threadId: args.threadId,
          ...(args.parentMessageId ? { parentMessageId: args.parentMessageId } : {}),
          active: true,
          expiresAt: args.expiresAt,
          createdAt: new Date().toISOString(),
        })
        return { id: args.id, token, expiresAt: args.expiresAt }
      }),
  }),

  saveAlias: defineFn({
    input: { id: 'id', localPart: 'text', name: 'text', bridge: 'text', defaults: 'json', active: 'bool' },
    output: { id: 'id' },
    effects: ['read:mail_inbound.Alias', 'write:mail_inbound.Alias'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      actor(ctx)
      const localPart = String(args.localPart).trim().toLowerCase()
      if (!/^[a-z0-9][a-z0-9._+-]{0,63}$/.test(localPart)) throw new Error('alias local part is invalid')
      const bridge = String(args.bridge).trim()
      if (!bridge) throw new Error('alias bridge cannot be empty')
      const A = ctx.table('mail_inbound.Alias')
      const existing = await ctx.db.one(from(A).where(eq(A.id, args.id)))
      const now = new Date().toISOString()
      const row = {
        id: args.id,
        localPart,
        name: String(args.name).trim(),
        bridge,
        defaults: args.defaults,
        active: args.active,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      if (existing) await ctx.db.update('mail_inbound.Alias', { id: args.id }, row)
      else await ctx.db.insert('mail_inbound.Alias', row)
      return { id: args.id }
    },
  }),

  listEvents: defineFn({
    input: { state: 'text?', limit: 'int?' },
    output: { events: 'json' },
    effects: ['read:mail_inbound.InboundEvent', 'read:mail.Thread'],
    handler: async (ctx: Ctx, args) => {
      actor(ctx)
      const I = ctx.table('mail_inbound.InboundEvent')
      const rows = await ctx.db.all(from(I).orderBy(desc(I.receivedAt), desc(I.id)))
      const visible = rows
        .filter((row) => !args.state || row.state === args.state)
        .slice(0, Math.max(1, Math.min(200, Number(args.limit ?? 100))))
      const threadIds = [...new Set(visible.flatMap((row) => (row.threadId ? [row.threadId] : [])))]
      const T = ctx.table('mail.Thread')
      const threads = threadIds.length ? await ctx.db.all(from(T).where(inArray(T.id, threadIds))) : []
      const byId = new Map(threads.map((row) => [String(row.id), row]))
      return {
        events: visible.map((row) => ({
          ...row,
          targetName: byId.get(String(row.threadId ?? ''))?.displayName ?? null,
        })),
      }
    },
  }),

  requestRetention: defineFn({
    input: { cutoff: 'datetime' },
    output: { id: 'id', existing: 'bool' },
    effects: ['enqueue:mail_inbound.retain'],
    idempotent: true,
    handler: (ctx: Ctx, args) => {
      actor(ctx)
      return ctx.jobs.enqueue(
        'mail_inbound.retain',
        { cutoff: args.cutoff },
        { uniqueKey: `inbound-retention:${String(args.cutoff).slice(0, 10)}` },
      )
    },
  }),
}
