import type { Ctx } from '@ketvietlab/ketjs'
import { readableRow } from '../membership.ts'

/**
 * Whether the reader follows this issue, so a screen can offer the right verb.
 */
export async function following(ctx: Ctx, issueId: string): Promise<boolean> {
  const held = await readableRow(ctx, 'flow.Issue', issueId)
  if (!held || !ctx.actor) return false
  const user = (await ctx.db.select('user.User', { id: ctx.actor }))[0]
  if (!user?.partnerId) return false
  const rows = await ctx.db.select('mail.Follower', {
    threadId: held.threadId,
    partnerId: user.partnerId,
  })
  return rows.length > 0
}
