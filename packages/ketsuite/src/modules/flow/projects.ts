// What the project list needs beyond the row itself.
//
// Kept out of operations.ts, which is about issues, and out of functions.ts,
// which is about exposing them.

import { eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'

/**
 * How much work each project is carrying, and how much of it is finished.
 *
 * Two reads for the whole page, not one per project: there is no JOIN to count
 * issues by project in a single query, and the list caps at 200 rows, so a
 * count per row would be 200 round trips. The issues come back in one
 * `inArray`, their columns in a second, and the tally is done here.
 *
 * "Finished" is a column marked `terminalState`, which is the same definition
 * the board and the sub-task progress already use — a project does not carry a
 * status of its own to read instead.
 */
export type ProjectStats = { total: number; done: number }

export async function projectStats(
  ctx: Ctx,
  projectIds: string[],
): Promise<Map<string, ProjectStats>> {
  const tally = new Map<string, ProjectStats>()
  if (!projectIds.length) return tally
  for (const id of projectIds) tally.set(id, { total: 0, done: 0 })
  const I = ctx.table('flow.Issue')
  const issues = await ctx.db.all(
    from(I).where(inArray(I.projectId, projectIds), eq(I.active, true)),
  )
  if (!issues.length) return tally
  const C = ctx.table('flow.Column')
  const columns = await ctx.db.all(
    from(C).where(inArray(C.id, [...new Set(issues.map((row) => String(row.columnId)))])),
  )
  const terminal = new Set(
    columns.filter((column) => column.terminalState).map((column) => String(column.id)),
  )
  for (const issue of issues) {
    const at = tally.get(String(issue.projectId))
    if (!at) continue
    at.total += 1
    if (terminal.has(String(issue.columnId))) at.done += 1
  }
  return tally
}

/**
 * What a project looks like from the outside: how far along it is, and whether
 * it has started at all.
 *
 * Derived from its issues rather than stored. A project has no status column,
 * and inventing one that nobody sets would put a label on screen that means
 * nothing — this at least answers a real question about real rows.
 */
export type ProjectState = 'empty' | 'planned' | 'active' | 'done'

export const projectStateOf = (stats: ProjectStats): ProjectState => {
  if (!stats.total) return 'empty'
  if (stats.done === stats.total) return 'done'
  return stats.done === 0 ? 'planned' : 'active'
}
