import type { Ctx } from '@ketvietlab/ketjs'
import { followThread, postMessage, unfollowThread } from '../../mail/index.ts'
import { from, inArray } from '@ketvietlab/ketjs'
import type { FlowResult } from './command.ts'
import { actorRequired, commandKey, invalid, issue } from './command.ts'
import { readableRow } from '../membership.ts'

/**
 * Subscribes a user to an issue's thread, when the platform can address them.
 *
 * Followers are partner-keyed the whole way down — `mail.Notification`'s
 * `recipientPartnerId` is required — while `user.User.partnerId` is optional
 * by design ("an internal operator needs no entry in the address book"). So a
 * user without one cannot be subscribed and cannot be notified. Skipping is
 * the truthful outcome: the alternative is creating address-book rows as a
 * side effect of assigning a task, which is not a decision this module gets
 * to make.
 */
export async function followIssue(ctx: Ctx, threadId: unknown, userId: unknown): Promise<void> {
  if (!threadId || !userId) return
  const user = (await ctx.db.select('user.User', { id: userId }))[0]
  if (!user?.partnerId) return
  await followThread(ctx, {
    id: `${String(threadId)}:${String(user.partnerId)}`,
    threadId: String(threadId),
    partnerId: String(user.partnerId),
  })
}

/**
 * The partners behind a list of mentioned users.
 *
 * Mentions are partner-keyed the whole way down, the same as followers, so a
 * user without a partner cannot be mentioned any more than they can be
 * notified — see `followIssue` above for why that is the platform's shape
 * rather than something to work around here. They are dropped rather than
 * refused: a comment naming five people should still reach the four the system
 * can address.
 */
export async function mentionPartners(ctx: Ctx, userIds: readonly string[]): Promise<string[]> {
  const wanted = [...new Set(userIds.filter(Boolean).map(String))]
  if (!wanted.length) return []
  const U = ctx.table('user.User')
  const users = await ctx.db.all(from(U).where(inArray(U.id, wanted)))
  return [
    ...new Set(
      users
        .map((user) => user.partnerId)
        .filter(Boolean)
        .map(String),
    ),
  ]
}

export async function addComment(
  ctx: Ctx,
  input: {
    id: string
    issueId: string
    body: string
    kind?: 'comment' | 'note'
    /** Who this comment is addressed to, beyond whoever already follows it. */
    mentionUserIds?: string[]
    idempotencyKey: string
  },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  if (!input.body.trim()) return invalid(issue('body', 'flow.error.required'))
  const held = await readableRow(ctx, 'flow.Issue', input.issueId)
  if (!held) return invalid(issue('issueId', 'flow.error.notFound'))
  // Before the message, so the author is subscribed to the replies to it.
  // `postMessage` excludes the author from its own recipients, so this does
  // not notify them about their own comment.
  await followIssue(ctx, held.threadId, ctx.actor)
  // Naming somebody subscribes them, so the answer to what they were asked
  // reaches them too. Being mentioned once is how most people end up following
  // an issue at all, which is also why `stopFollowing` exists below.
  for (const userId of input.mentionUserIds ?? []) await followIssue(ctx, held.threadId, userId)
  const result = await postMessage(ctx, {
    id: input.id,
    threadId: String(held.threadId),
    authorUserId: ctx.actor ?? undefined,
    kind: input.kind ?? 'comment',
    body: input.body.trim(),
    mentionPartnerIds: await mentionPartners(ctx, input.mentionUserIds ?? []),
  })
  return { ok: true, id: String(result.message.id) }
}

/**
 * Follow an issue on purpose, rather than by being assigned it, commenting on
 * it or being named in it.
 *
 * Those three are how everybody who follows an issue got there, and `unfollow`
 * was the only door in the other direction. Somebody who wanted to watch
 * another person's work had to comment on it — which is noise in the timeline —
 * or ask to be mentioned.
 */
export async function startFollowing(
  ctx: Ctx,
  input: { issueId: string; idempotencyKey: string },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  const held = await readableRow(ctx, 'flow.Issue', input.issueId)
  if (!held) return invalid(issue('issueId', 'flow.error.notFound'))
  await followIssue(ctx, held.threadId, ctx.actor)
  return { ok: true, id: input.issueId }
}

export async function stopFollowing(
  ctx: Ctx,
  input: { issueId: string; idempotencyKey: string },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  const held = await readableRow(ctx, 'flow.Issue', input.issueId)
  if (!held) return invalid(issue('issueId', 'flow.error.notFound'))
  const user = (await ctx.db.select('user.User', { id: ctx.actor }))[0]
  if (!user?.partnerId) return { ok: true, removed: 0 }
  const removed = await unfollowThread(ctx, String(held.threadId), String(user.partnerId))
  return { ok: true, removed }
}
