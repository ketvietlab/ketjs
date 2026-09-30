import type { Ctx } from '@ketvietlab/ketjs'
import type { FlowResult } from './command.ts'
import { actorRequired, commandKey, invalid, issue } from './command.ts'
import { DEPENDENCY_RELATIONS } from '../types.ts'
import { readableRow } from '../membership.ts'

/**
 * Only `blocks` is checked for cycles.
 *
 * `related` carries no ordering — an issue "related to" another can point back
 * without contradiction — so a cycle there is not a bug. A `blocks` cycle would
 * make every issue in the loop permanently unblockable, which is worth refusing
 * up front rather than discovering at move time.
 */
export async function createsBlockCycle(
  ctx: Ctx,
  issueId: string,
  dependsOnIssueId: string,
): Promise<boolean> {
  const seen = new Set<string>([issueId])
  let frontier = [dependsOnIssueId]
  while (frontier.length) {
    if (frontier.includes(issueId)) return true
    const next: string[] = []
    for (const id of frontier) {
      if (seen.has(id)) continue
      seen.add(id)
      const edges = await ctx.db.select('flow.IssueDependency', { issueId: id, relation: 'blocks' })
      next.push(...edges.map((row) => String(row.dependsOnIssueId)))
    }
    frontier = next
  }
  return false
}

export async function addDependency(
  ctx: Ctx,
  input: { id: string; issueId: string; dependsOnIssueId: string; relation: string; idempotencyKey: string },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  if (!DEPENDENCY_RELATIONS.includes(input.relation as never))
    return invalid(issue('relation', 'flow.error.invalidRelation'))
  if (input.issueId === input.dependsOnIssueId)
    return invalid(issue('dependsOnIssueId', 'flow.error.selfDependency'))
  return ctx.tx(async (tx) => {
    const [held, target] = await Promise.all([
      readableRow(tx, 'flow.Issue', input.issueId).then((row) => (row ? [row] : [])),
      readableRow(tx, 'flow.Issue', input.dependsOnIssueId).then((row) => (row ? [row] : [])),
    ])
    if (!held[0] || !target[0]) return invalid(issue('id', 'flow.error.notFound'))
    if (input.relation === 'blocks' && (await createsBlockCycle(tx, input.issueId, input.dependsOnIssueId)))
      return invalid(issue('dependsOnIssueId', 'flow.error.cycle'))
    const inserted = await tx.db.insertIfAbsent('flow.IssueDependency', {
      id: input.id,
      issueId: input.issueId,
      dependsOnIssueId: input.dependsOnIssueId,
      relation: input.relation,
    })
    if (!('dryRun' in inserted) && !inserted.inserted)
      return invalid(issue('dependsOnIssueId', 'flow.error.duplicateDependency'))
    return { ok: true, id: input.id }
  })
}
