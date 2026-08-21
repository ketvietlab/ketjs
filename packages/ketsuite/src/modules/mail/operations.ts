import { asc, deleteFrom, desc, eq, from, inArray, isNull, KetError } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { MESSAGE_KINDS } from './types.ts'
import type { MessageKind } from './types.ts'

const unique = (values: readonly string[]): string[] => [...new Set(values.filter(Boolean))]

function mailError(code: string, message: string, hint?: string): never {
  throw new KetError({ code, module: 'mail', message, ...(hint ? { hint } : {}) })
}

export type EnsureThreadInput = {
  id: string
  resModel: string
  resId: string
  displayName: string
  createdAt?: string
}

/** Caller must verify the target record before crossing this polymorphic boundary. */
export async function ensureThread(ctx: Ctx, input: EnsureThreadInput): Promise<Row> {
  if (!input.resModel.trim() || !input.resId.trim())
    mailError('E_MAIL_TARGET', 'thread target model and id cannot be empty')
  const T = ctx.table('mail.Thread')
  const target = from(T).where(eq(T.resModel, input.resModel), eq(T.resId, input.resId))
  const existing = await ctx.db.one(target)
  if (existing) {
    if (existing.displayName !== input.displayName)
      await ctx.db.update('mail.Thread', { id: existing.id }, { displayName: input.displayName })
    return { ...existing, displayName: input.displayName }
  }
  await ctx.db.insertIfAbsent('mail.Thread', {
    id: input.id,
    resModel: input.resModel,
    resId: input.resId,
    displayName: input.displayName,
    active: true,
    createdAt: input.createdAt ?? new Date().toISOString(),
  })
  const created = await ctx.db.one(target)
  if (!created) mailError('E_MAIL_THREAD_RACE', 'thread could not be read after creation')
  return created
}

export type FollowInput = {
  id: string
  threadId: string
  partnerId: string
  subtypeIds?: string[]
  createdAt?: string
}

export async function followThread(ctx: Ctx, input: FollowInput): Promise<Row> {
  const T = ctx.table('mail.Thread')
  const P = ctx.table('partner.Partner')
  if (!(await ctx.db.one(from(T).where(eq(T.id, input.threadId), eq(T.active, true)))))
    mailError('E_MAIL_THREAD_NOT_FOUND', `no active thread "${input.threadId}"`)
  if (!(await ctx.db.one(from(P).where(eq(P.id, input.partnerId), eq(P.active, true)))))
    mailError('E_MAIL_PARTNER_NOT_FOUND', `no active partner "${input.partnerId}"`)

  const F = ctx.table('mail.Follower')
  let follower = await ctx.db.one(
    from(F).where(eq(F.threadId, input.threadId), eq(F.partnerId, input.partnerId)),
  )
  if (!follower) {
    await ctx.db.insertIfAbsent('mail.Follower', {
      id: input.id,
      threadId: input.threadId,
      partnerId: input.partnerId,
      createdAt: input.createdAt ?? new Date().toISOString(),
    })
    follower = await ctx.db.one(
      from(F).where(eq(F.threadId, input.threadId), eq(F.partnerId, input.partnerId)),
    )
  }
  if (!follower) mailError('E_MAIL_FOLLOWER_RACE', 'follower could not be read after creation')

  const subtypeIds = unique(input.subtypeIds ?? [])
  if (subtypeIds.length) {
    const S = ctx.table('mail.Subtype')
    const found = await ctx.db.all(from(S).select(S.id).where(inArray(S.id, subtypeIds), eq(S.active, true)))
    if (found.length !== subtypeIds.length)
      mailError('E_MAIL_SUBTYPE_NOT_FOUND', 'one or more follower subtypes do not exist in this company')
  }
  for (const subtypeId of subtypeIds)
    await ctx.db.insertIfAbsent('mail.FollowerSubtype', {
      id: `${String(follower.id)}:${subtypeId}`,
      followerId: follower.id,
      subtypeId,
    })
  return follower
}

export async function unfollowThread(ctx: Ctx, threadId: string, partnerId: string): Promise<number> {
  const F = ctx.table('mail.Follower')
  const follower = await ctx.db.one(from(F).where(eq(F.threadId, threadId), eq(F.partnerId, partnerId)))
  if (!follower) return 0
  const FS = ctx.table('mail.FollowerSubtype')
  await ctx.db.del(deleteFrom(FS).where(eq(FS.followerId, follower.id)))
  return (await ctx.db.del(deleteFrom(F).where(eq(F.id, follower.id)))).changes
}

export type TrackingInput = { field: string; oldValue?: unknown; newValue?: unknown }
export type PostMessageInput = {
  id: string
  threadId: string
  parentId?: string
  subtypeId?: string
  authorPartnerId?: string
  authorUserId?: string
  emailFrom?: string
  kind: MessageKind
  direction?: 'internal' | 'incoming' | 'outgoing'
  subject?: string
  body: string
  mentionPartnerIds?: string[]
  attachmentIds?: string[]
  tracking?: TrackingInput[]
  confirmExternalMentions?: boolean
  createdAt?: string
}

export type PostMessageResult = {
  message: Row
  notifications: Row[]
  recipientPartnerIds: string[]
}

/**
 * Write one timeline event and its fan-out. The bridge wraps this in the same tx
 * as target verification so a missing target cannot leave collaboration rows.
 */
export async function postMessage(ctx: Ctx, input: PostMessageInput): Promise<PostMessageResult> {
  if (!MESSAGE_KINDS.includes(input.kind))
    mailError('E_MAIL_KIND', `message kind must be one of: ${MESSAGE_KINDS.join(', ')}`)
  if (!input.body.trim() && !(input.attachmentIds?.length ?? 0))
    mailError('E_MAIL_EMPTY', 'a message needs text or an attachment')
  if (input.body.length > 100_000) mailError('E_MAIL_TOO_LARGE', 'message text exceeds 100000 characters')

  const T = ctx.table('mail.Thread')
  if (!(await ctx.db.one(from(T).where(eq(T.id, input.threadId), eq(T.active, true)))))
    mailError('E_MAIL_THREAD_NOT_FOUND', `no active thread "${input.threadId}"`)
  const M = ctx.table('mail.Message')
  if (
    input.parentId &&
    !(await ctx.db.one(from(M).where(eq(M.id, input.parentId), eq(M.threadId, input.threadId))))
  )
    mailError('E_MAIL_PARENT', 'parent message is not on this thread')

  let subtypeInternal = false
  if (input.subtypeId) {
    const S = ctx.table('mail.Subtype')
    const subtype = await ctx.db.one(from(S).where(eq(S.id, input.subtypeId), eq(S.active, true)))
    if (!subtype) mailError('E_MAIL_SUBTYPE_NOT_FOUND', `no active subtype "${input.subtypeId}"`)
    subtypeInternal = subtype.internalOnly === true
  }

  const mentioned = unique(input.mentionPartnerIds ?? [])
  const attachments = unique(input.attachmentIds ?? [])
  const P = ctx.table('partner.Partner')
  if (mentioned.length) {
    const found = await ctx.db.all(from(P).select(P.id).where(inArray(P.id, mentioned), eq(P.active, true)))
    if (found.length !== mentioned.length)
      mailError('E_MAIL_PARTNER_NOT_FOUND', 'one or more mentioned partners do not exist or are archived')
  }
  if (attachments.length) {
    const A = ctx.table('storage.Attachment')
    const found = await ctx.db.all(from(A).select(A.id).where(inArray(A.id, attachments)))
    if (found.length !== attachments.length)
      mailError('E_MAIL_ATTACHMENT_NOT_FOUND', 'one or more attachments are outside this company or missing')
  }

  const U = ctx.table('user.User')
  const F = ctx.table('mail.Follower')
  const followers = await ctx.db.all(from(F).where(eq(F.threadId, input.threadId)))
  let followerPartnerIds = followers.map((row) => String(row.partnerId))
  if (input.subtypeId && followers.length) {
    const FS = ctx.table('mail.FollowerSubtype')
    const subscriptions = await ctx.db.all(
      from(FS).where(
        inArray(
          FS.followerId,
          followers.map((row) => row.id),
        ),
      ),
    )
    const explicit = new Set(subscriptions.map((row) => String(row.followerId)))
    const subscribed = new Set(
      subscriptions.filter((row) => row.subtypeId === input.subtypeId).map((row) => String(row.followerId)),
    )
    followerPartnerIds = followers
      .filter((row) => !explicit.has(String(row.id)) || subscribed.has(String(row.id)))
      .map((row) => String(row.partnerId))
  }

  const candidatePartners = unique([...followerPartnerIds, ...mentioned])
  const users = candidatePartners.length
    ? await ctx.db.all(
        from(U).where(inArray(U.partnerId, candidatePartners), eq(U.active, true)).orderBy(asc(U.id)),
      )
    : []
  const internalPartners = new Set(users.map((row) => String(row.partnerId)))
  const externalMentions = mentioned.filter((partnerId) => !internalPartners.has(partnerId))
  const restricted = input.kind === 'note' || subtypeInternal
  if (restricted && externalMentions.length && input.confirmExternalMentions !== true)
    mailError(
      'E_MAIL_EXTERNAL_CONFIRMATION',
      `internal message mentions external partner(s): ${externalMentions.join(', ')}`,
      'set confirmExternalMentions only after the user explicitly confirms disclosure',
    )

  let recipients = candidatePartners
  if (restricted)
    recipients = candidatePartners.filter(
      (partnerId) => internalPartners.has(partnerId) || externalMentions.includes(partnerId),
    )
  if (input.authorPartnerId) recipients = recipients.filter((id) => id !== input.authorPartnerId)
  if (input.authorUserId) {
    const author = await ctx.db.one(from(U).where(eq(U.id, input.authorUserId)))
    if (!author) mailError('E_MAIL_AUTHOR_NOT_FOUND', `no user "${input.authorUserId}"`)
    if (author.partnerId) recipients = recipients.filter((id) => id !== author.partnerId)
  }
  recipients = unique(recipients).sort()

  const createdAt = input.createdAt ?? new Date().toISOString()
  const message: Row = {
    id: input.id,
    threadId: input.threadId,
    ...(input.parentId ? { parentId: input.parentId } : {}),
    ...(input.subtypeId ? { subtypeId: input.subtypeId } : {}),
    ...(input.authorPartnerId ? { authorPartnerId: input.authorPartnerId } : {}),
    ...(input.authorUserId ? { authorUserId: input.authorUserId } : {}),
    ...(input.emailFrom ? { emailFrom: input.emailFrom } : {}),
    kind: input.kind,
    direction: input.direction ?? 'internal',
    ...(input.subject ? { subject: input.subject } : {}),
    body: input.body,
    externalVisible: !restricted || externalMentions.length > 0,
    createdAt,
  }
  await ctx.db.insert('mail.Message', message)

  for (const partnerId of mentioned)
    await ctx.db.insert('mail.Mention', {
      id: `${input.id}:mention:${partnerId}`,
      messageId: input.id,
      partnerId,
    })
  for (const attachmentId of attachments)
    await ctx.db.insert('mail.MessageAttachment', {
      id: `${input.id}:attachment:${attachmentId}`,
      messageId: input.id,
      attachmentId,
    })
  for (const [index, tracking] of (input.tracking ?? []).entries()) {
    if (!tracking.field.trim()) mailError('E_MAIL_TRACKING_FIELD', 'tracking field cannot be empty')
    await ctx.db.insert('mail.TrackingValue', {
      id: `${input.id}:tracking:${index}`,
      messageId: input.id,
      field: tracking.field,
      ...(tracking.oldValue === undefined ? {} : { oldValue: tracking.oldValue }),
      ...(tracking.newValue === undefined ? {} : { newValue: tracking.newValue }),
    })
  }

  const usersByPartner = new Map<string, Row[]>()
  for (const user of users) {
    const rows = usersByPartner.get(String(user.partnerId)) ?? []
    rows.push(user)
    usersByPartner.set(String(user.partnerId), rows)
  }
  const notifications: Row[] = []
  for (const partnerId of recipients) {
    const internalUsers = usersByPartner.get(partnerId) ?? []
    if (internalUsers.length) {
      for (const user of internalUsers)
        notifications.push({
          id: `${input.id}:user:${String(user.id)}`,
          messageId: input.id,
          recipientPartnerId: partnerId,
          recipientUserId: user.id,
          channel: 'inbox',
          state: 'ready',
          createdAt,
        })
    } else {
      notifications.push({
        id: `${input.id}:partner:${partnerId}`,
        messageId: input.id,
        recipientPartnerId: partnerId,
        channel: 'email',
        state: 'ready',
        createdAt,
      })
    }
  }
  for (const notification of notifications) await ctx.db.insert('mail.Notification', notification)
  return { message, notifications, recipientPartnerIds: recipients }
}

export async function listTimeline(
  ctx: Ctx,
  threadId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<Row[]> {
  const T = ctx.table('mail.Thread')
  if (!(await ctx.db.one(from(T).where(eq(T.id, threadId), eq(T.active, true)))))
    mailError('E_MAIL_THREAD_NOT_FOUND', `no active thread "${threadId}"`)
  const M = ctx.table('mail.Message')
  return ctx.db.all(
    from(M)
      .where(eq(M.threadId, threadId))
      .orderBy(desc(M.createdAt), desc(M.id))
      .limit(Math.max(1, Math.min(100, options.limit ?? 30)))
      .offset(Math.max(0, options.offset ?? 0)),
  )
}

export async function listFollowers(ctx: Ctx, threadId: string): Promise<Row[]> {
  const F = ctx.table('mail.Follower')
  return ctx.db.all(from(F).where(eq(F.threadId, threadId)).orderBy(asc(F.createdAt), asc(F.id)))
}

export async function unreadNotifications(ctx: Ctx, userId: string, limit = 50): Promise<Row[]> {
  const N = ctx.table('mail.Notification')
  return ctx.db.all(
    from(N)
      .where(eq(N.recipientUserId, userId), isNull(N.readAt))
      .orderBy(desc(N.createdAt), desc(N.id))
      .limit(Math.max(1, Math.min(100, limit))),
  )
}
