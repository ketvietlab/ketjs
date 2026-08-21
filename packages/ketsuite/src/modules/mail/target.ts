import { asc, defineFn, eq, from, inArray, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import {
  ensureThread,
  followThread,
  listFollowers,
  listTimeline,
  postMessage,
  unfollowThread,
} from './operations.ts'

export type CollaborationTarget = {
  id: string
  displayName: string
}

export type TargetBridge = {
  resModel: string
  targetEffect: string
  verify(ctx: Ctx, targetId: string): Promise<CollaborationTarget>
}

const actorPartner = async (ctx: Ctx): Promise<Row> => {
  if (!ctx.actor)
    throw new KetError({
      code: 'E_MAIL_ACTOR_REQUIRED',
      module: 'mail',
      message: 'record collaboration requires a signed-in user',
    })
  const U = ctx.table('user.User')
  const user = await ctx.db.one(from(U).where(eq(U.id, ctx.actor), eq(U.active, true)))
  if (!user?.partnerId)
    throw new KetError({
      code: 'E_MAIL_ACTOR_PARTNER',
      module: 'mail',
      message: 'the signed-in user has no active partner identity',
    })
  return user
}

const threadFor = async (ctx: Ctx, bridge: TargetBridge, targetId: string): Promise<Row | null> => {
  const T = ctx.table('mail.Thread')
  return ctx.db.one(from(T).where(eq(T.resModel, bridge.resModel), eq(T.resId, targetId), eq(T.active, true)))
}

const ensureTargetThread = async (
  ctx: Ctx,
  bridge: TargetBridge,
  target: CollaborationTarget,
): Promise<Row> =>
  ensureThread(ctx, {
    id: `thread:${bridge.resModel}:${target.id}`,
    resModel: bridge.resModel,
    resId: target.id,
    displayName: target.displayName,
  })

const readEffects = (target: string): string[] => [
  target,
  'read:mail.Thread',
  'read:mail.Message',
  'read:mail.Follower',
  'read:mail.MessageAttachment',
  'read:storage.Attachment',
  'read:user.User',
  'read:partner.Partner',
]

const writeThreadEffects = [
  'write:mail.Thread',
  'read:mail.Subtype',
  'write:mail.Follower',
  'write:mail.FollowerSubtype',
]

const postEffects = [
  'write:mail.Thread',
  'write:mail.Message',
  'read:mail.Subtype',
  'read:mail.FollowerSubtype',
  'write:mail.Mention',
  'write:mail.MessageAttachment',
  'write:mail.TrackingValue',
  'write:mail.Notification',
]

const pageOf = async (
  ctx: Ctx,
  bridge: TargetBridge,
  target: CollaborationTarget,
  limit: number,
  offset: number,
) => {
  const thread = await threadFor(ctx, bridge, target.id)
  const actor = await actorPartner(ctx)
  if (!thread)
    return {
      threadId: null,
      displayName: target.displayName,
      total: 0,
      messages: [],
      followers: [],
      following: false,
    }

  const messages = await listTimeline(ctx, String(thread.id), { limit, offset })
  const followers = await listFollowers(ctx, String(thread.id))
  const messageIds = messages.map((row) => String(row.id))
  const authorPartnerIds = messages.flatMap((row) =>
    row.authorPartnerId ? [String(row.authorPartnerId)] : [],
  )
  const authorUserIds = messages.flatMap((row) => (row.authorUserId ? [String(row.authorUserId)] : []))
  const U = ctx.table('user.User')
  const authors = authorUserIds.length ? await ctx.db.all(from(U).where(inArray(U.id, authorUserIds))) : []
  const authorById = new Map(authors.map((row) => [String(row.id), row]))
  const followerPartnerIds = followers.map((row) => String(row.partnerId))
  const partnerIds = [
    ...new Set([
      ...authorPartnerIds,
      ...followerPartnerIds,
      ...authors.flatMap((row) => (row.partnerId ? [String(row.partnerId)] : [])),
    ]),
  ]
  const P = ctx.table('partner.Partner')
  const partners = partnerIds.length
    ? await ctx.db.all(from(P).where(inArray(P.id, partnerIds)).orderBy(asc(P.name)))
    : []
  const partnerById = new Map(partners.map((row) => [String(row.id), row]))

  const MA = ctx.table('mail.MessageAttachment')
  const joins = messageIds.length ? await ctx.db.all(from(MA).where(inArray(MA.messageId, messageIds))) : []
  const attachmentIds = [...new Set(joins.map((row) => String(row.attachmentId)))]
  const A = ctx.table('storage.Attachment')
  const attachments = attachmentIds.length
    ? await ctx.db.all(from(A).where(inArray(A.id, attachmentIds)))
    : []
  const attachmentById = new Map(attachments.map((row) => [String(row.id), row]))
  const attachmentsByMessage = new Map<string, Row[]>()
  for (const join of joins) {
    const attachment = attachmentById.get(String(join.attachmentId))
    if (!attachment) continue
    const rows = attachmentsByMessage.get(String(join.messageId)) ?? []
    rows.push({
      id: attachment.id,
      name: attachment.name,
      mimetype: attachment.mimetype,
      size: attachment.size,
      href: `/files/${String(attachment.id)}`,
    })
    attachmentsByMessage.set(String(join.messageId), rows)
  }

  const M = ctx.table('mail.Message')
  return {
    threadId: thread.id,
    displayName: thread.displayName,
    total: await ctx.db.count(from(M).where(eq(M.threadId, thread.id))),
    messages: messages.map((message) => ({
      ...message,
      authorName: message.authorPartnerId
        ? (partnerById.get(String(message.authorPartnerId))?.name ?? message.authorPartnerId)
        : message.authorUserId
          ? (partnerById.get(String(authorById.get(String(message.authorUserId))?.partnerId))?.name ??
            authorById.get(String(message.authorUserId))?.name ??
            message.authorUserId)
          : (message.emailFrom ?? 'KetSuite'),
      attachments: attachmentsByMessage.get(String(message.id)) ?? [],
    })),
    followers: followers.map((follower) => ({
      id: follower.id,
      partnerId: follower.partnerId,
      name: partnerById.get(String(follower.partnerId))?.name ?? follower.partnerId,
    })),
    following: followers.some((follower) => follower.partnerId === actor.partnerId),
  }
}

/**
 * Build API functions under a concrete target module. The result is not registered
 * by `mail`: Product and Stock each publish their own exact-effect bridge.
 */
export function targetFunctions(bridge: TargetBridge): Record<string, FnSpec> {
  return {
    timeline: defineFn({
      input: { targetId: 'id', limit: 'int?', offset: 'int?' },
      output: {
        threadId: 'id?',
        displayName: 'text',
        total: 'int',
        messages: 'json',
        followers: 'json',
        following: 'bool',
      },
      effects: readEffects(bridge.targetEffect),
      handler: async (ctx: Ctx, args) => {
        const target = await bridge.verify(ctx, String(args.targetId))
        return pageOf(
          ctx,
          bridge,
          target,
          Math.max(1, Math.min(50, Number(args.limit ?? 20))),
          Math.max(0, Number(args.offset ?? 0)),
        )
      },
    }),

    post: defineFn({
      input: {
        id: 'id',
        targetId: 'id',
        kind: 'text',
        body: 'text',
        attachmentIds: 'json?',
        mentionPartnerIds: 'json?',
        confirmExternalMentions: 'bool?',
      },
      output: { id: 'id', threadId: 'id', kind: 'text', body: 'text', createdAt: 'datetime' },
      effects: [...readEffects(bridge.targetEffect), ...postEffects],
      idempotent: true,
      handler: (ctx: Ctx, args) =>
        ctx.tx(async (tx) => {
          const target = await bridge.verify(tx, String(args.targetId))
          const thread = await ensureTargetThread(tx, bridge, target)
          const M = tx.table('mail.Message')
          const existing = await tx.db.one(from(M).where(eq(M.id, args.id)))
          if (existing) {
            if (existing.threadId !== thread.id || existing.kind !== args.kind || existing.body !== args.body)
              throw new KetError({
                code: 'E_MAIL_IDEMPOTENCY_CONFLICT',
                module: 'mail',
                message: `message id "${String(args.id)}" was already used for different content`,
              })
            return existing
          }
          if (args.kind !== 'comment' && args.kind !== 'note')
            throw new KetError({
              code: 'E_MAIL_COMPOSER_KIND',
              module: 'mail',
              message: 'the record composer accepts only comment or note',
            })
          const posted = await postMessage(tx, {
            id: String(args.id),
            threadId: String(thread.id),
            kind: args.kind,
            body: String(args.body),
            authorUserId: String(tx.actor),
            attachmentIds: Array.isArray(args.attachmentIds) ? args.attachmentIds.map(String) : [],
            mentionPartnerIds: Array.isArray(args.mentionPartnerIds)
              ? args.mentionPartnerIds.map(String)
              : [],
            confirmExternalMentions: args.confirmExternalMentions === true,
          })
          return posted.message
        }),
    }),

    follow: defineFn({
      input: { targetId: 'id' },
      output: { following: 'bool', followerId: 'id' },
      effects: [...readEffects(bridge.targetEffect), ...writeThreadEffects],
      idempotent: true,
      handler: (ctx: Ctx, args) =>
        ctx.tx(async (tx) => {
          const target = await bridge.verify(tx, String(args.targetId))
          const user = await actorPartner(tx)
          const thread = await ensureTargetThread(tx, bridge, target)
          const follower = await followThread(tx, {
            id: `${String(thread.id)}:${String(user.partnerId)}`,
            threadId: String(thread.id),
            partnerId: String(user.partnerId),
          })
          return { following: true, followerId: follower.id }
        }),
    }),

    unfollow: defineFn({
      input: { targetId: 'id' },
      output: { following: 'bool', removed: 'int' },
      effects: [
        bridge.targetEffect,
        'read:mail.Thread',
        'read:user.User',
        'read:mail.Follower',
        'write:mail.Follower',
        'write:mail.FollowerSubtype',
      ],
      idempotent: true,
      handler: (ctx: Ctx, args) =>
        ctx.tx(async (tx) => {
          await bridge.verify(tx, String(args.targetId))
          const user = await actorPartner(tx)
          const thread = await threadFor(tx, bridge, String(args.targetId))
          const removed = thread ? await unfollowThread(tx, String(thread.id), String(user.partnerId)) : 0
          return { following: false, removed }
        }),
    }),
  }
}
