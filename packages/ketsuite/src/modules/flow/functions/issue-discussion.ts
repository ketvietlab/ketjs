import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { addComment, startFollowing, stopFollowing } from '../domain/issue-discussion.ts'
import { defineFn } from '@ketvietlab/ketjs'
import { commentEffects, membershipEffects } from './effects.ts'

export function issueCommentHandler(ctx: Ctx, args: Record<string, unknown>) {
  return addComment(ctx, {
    id: String(args.id),
    issueId: String(args.issueId),
    body: String(args.body),
    kind: args.kind === 'note' ? 'note' : 'comment',
    mentionUserIds: Array.isArray(args.mentionUserIds) ? args.mentionUserIds.map(String) : [],
    idempotencyKey: String(args.idempotencyKey),
  })
}

export function issueFollowHandler(ctx: Ctx, args: Record<string, unknown>) {
  return startFollowing(ctx, {
    issueId: String(args.issueId),
    idempotencyKey: String(args.idempotencyKey),
  })
}

export function issueUnfollowHandler(ctx: Ctx, args: Record<string, unknown>) {
  return stopFollowing(ctx, {
    issueId: String(args.issueId),
    idempotencyKey: String(args.idempotencyKey),
  })
}

export const issueDiscussionFunctions: Record<string, FnSpec> = {
  'issue.comment': defineFn({
    input: {
      id: 'id',
      issueId: 'id',
      body: 'text',
      kind: 'text?',
      /** Users this comment is addressed to, beyond whoever already follows. */
      mentionUserIds: 'json?',
      idempotencyKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [...commentEffects, 'read:user.User', 'write:mail.Mention', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: issueCommentHandler,
  }),
  /** The door `issue.unfollow` never had a pair for — see startFollowing. */
  'issue.follow': defineFn({
    input: { issueId: 'id', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:flow.Issue',
      'read:user.User',
      'read:mail.Thread',
      'read:partner.Partner',
      'read:mail.Follower',
      'write:mail.Follower',
      ...membershipEffects,
    ],
    idempotent: true,
    agent: true,
    handler: issueFollowHandler,
  }),
  /**
   * Leaves an issue's thread.
   *
   * A separate key from commenting, because it is the opposite act: everything
   * else in this module hands out subscriptions, and this is the only way to
   * give one back.
   */
  'issue.unfollow': defineFn({
    input: { issueId: 'id', idempotencyKey: 'text' },
    output: { ok: 'bool', removed: 'int?', errors: 'json?' },
    // `unfollowThread` clears the follower's per-subtype rows too, which the
    // effect system refused until it was said out loud — which is the point of
    // it: a capability nobody declared is one nobody reviewed.
    effects: [
      'read:flow.Issue',
      'read:user.User',
      'read:mail.Follower',
      'write:mail.Follower',
      'write:mail.FollowerSubtype',
      ...membershipEffects,
    ],
    idempotent: true,
    agent: true,
    handler: issueUnfollowHandler,
  }),
}
