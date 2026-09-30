import type { Ctx, Row } from '@ketvietlab/ketjs'
import { restrictToVisible, visibleProjects } from '../membership.ts'
import { eq, from, inArray } from '@ketvietlab/ketjs'

/**
 * Blocking dependencies leading into a given set of issues, batched — the map
 * view (flow_backend's dependency atlas, one epic at a time) needs the edges
 * among its own node set, not the per-issue read `issueDetail` already does.
 * No JOIN in this query builder by design, so this is one query against
 * `IssueDependency` alone.
 *
 * Both ends are matched by default: an edge pointing out of the set is not an
 * edge of the set. The map opts into outgoing edges so it can page a large
 * source set in bounded chunks, then filters both ends against the complete
 * epic after aggregation. The id list remains capped because it arrives over
 * HTTP.
 */
export const DEPENDENCY_BATCH = 200

export async function dependenciesFor(
  ctx: Ctx,
  issueIds: readonly string[],
  includeExternalTargets = false,
): Promise<Row[]> {
  const asked = [...new Set(issueIds.map(String))].slice(0, DEPENDENCY_BATCH)
  if (!asked.length) return []
  // The ids arrive from the caller, not from a query this function ran, so the
  // membership rule has to be applied to them here. Without it, naming an issue
  // in somebody else's project answered whether it had blockers — a small
  // answer, and still an answer about a project that is supposed to be
  // invisible (FLW-018).
  const I = ctx.table('flow.Issue')
  const visible = await visibleProjects(ctx)
  const readable = await ctx.db.all(
    restrictToVisible(from(I).select(I.id).where(inArray(I.id, asked)), I.projectId, visible),
  )
  const ids = readable.map((row) => String(row.id))
  if (!ids.length) return []
  const D = ctx.table('flow.IssueDependency')
  const held = new Set(ids)
  const rows = await ctx.db.all(from(D).where(inArray(D.issueId, ids), eq(D.relation, 'blocks')))
  // An external target is an issue outside the set that was asked about, which
  // the map draws an arrow to. It may still be one the caller cannot read, so
  // the far end is filtered the same way the near end was.
  if (!includeExternalTargets) return rows.filter((row) => held.has(String(row.dependsOnIssueId)))
  const targets = [...new Set(rows.map((row) => String(row.dependsOnIssueId)))].filter((id) => !held.has(id))
  if (!targets.length) return rows
  const reachable = new Set(
    (
      await ctx.db.all(
        restrictToVisible(from(I).select(I.id).where(inArray(I.id, targets)), I.projectId, visible),
      )
    ).map((row) => String(row.id)),
  )
  return rows.filter(
    (row) => held.has(String(row.dependsOnIssueId)) || reachable.has(String(row.dependsOnIssueId)),
  )
}
