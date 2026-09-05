// What the project list needs beyond the row itself.
//
// Kept out of operations.ts, which is about issues, and out of functions.ts,
// which is about exposing them.

import { eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'

const n = (value: unknown): number => Number(value ?? 0)

/**
 * How much work each project is carrying, and how much of it is finished.
 *
 * Counted where the rows are. This used to read **every active issue in the
 * company** — the list passes up to two hundred project ids and the read had no
 * limit — then tally them in memory. Twenty projects of two thousand issues was
 * forty thousand rows into the request, every time somebody opened the list.
 *
 * Two grouped counts and one small read of the terminal columns replace it. The
 * old comment was right that a count per project would be two hundred round
 * trips; the answer is a `GROUP BY`, not reading everything.
 *
 * "Finished" is a column marked `terminalState`, the same definition the board
 * and the sub-task progress already use — a project carries no status of its own.
 */
/**
 * The projects the caller has work in, as a set of ids.
 *
 * The screen used to infer this from a page of the caller's two hundred most
 * recently updated issues, so anyone with more than that lost projects from
 * their own tab with nothing on screen to say a project was missing. One
 * grouped query answers the question the tab is actually asking, at any size.
 */
export async function projectsWithMyWork(ctx: Ctx): Promise<Set<string>> {
  if (!ctx.actor) return new Set()
  const I = ctx.table('flow.Issue')
  const groups = await ctx.db.group(
    from(I).where(eq(I.assigneeUserId, ctx.actor)).groupBy({ col: I.projectId! }),
  )
  return new Set(groups.map((group) => String(group.key[0] ?? '')))
}

export type ProjectStats = { total: number; done: number }

export async function projectStats(ctx: Ctx, projectIds: string[]): Promise<Map<string, ProjectStats>> {
  const tally = new Map<string, ProjectStats>()
  if (!projectIds.length) return tally
  for (const id of projectIds) tally.set(id, { total: 0, done: 0 })
  const I = ctx.table('flow.Issue')
  const C = ctx.table('flow.Column')
  // Which columns mean finished, for these projects only. A handful of rows,
  // and the one read here that returns rows rather than counts.
  const terminal = (
    await ctx.db.all(
      from(C).where(inArray(C.projectId, projectIds), eq(C.terminalState, true), eq(C.active, true)),
    )
  ).map((row) => String(row.id))
  const live = from(I).where(inArray(I.projectId, projectIds), eq(I.active, true))
  const [totals, finished] = await Promise.all([
    ctx.db.group(live.groupBy({ col: I.projectId! })),
    terminal.length
      ? ctx.db.group(live.where(inArray(I.columnId, terminal)).groupBy({ col: I.projectId! }))
      : Promise.resolve([]),
  ])
  for (const group of totals) {
    const at = tally.get(String(group.key[0] ?? ''))
    if (at) at.total = n(group.count)
  }
  for (const group of finished) {
    const at = tally.get(String(group.key[0] ?? ''))
    if (at) at.done = n(group.count)
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
