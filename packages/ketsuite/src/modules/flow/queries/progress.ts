import type { Ctx } from '@ketvietlab/ketjs'
import { eq, from, isNotNull } from '@ketvietlab/ketjs'
import { n } from '../domain/command.ts'

/**
 * What a sprint is carrying, and how much of it is finished — see FLW-021.
 *
 * `estimate` has been stored, shown on the form and shown in the summary since
 * the module was written, and added up nowhere: a sprint had no total and there
 * was no velocity to read. Counted per sprint in two grouped passes rather than
 * one query per sprint.
 */
export async function sprintTotals(
  ctx: Ctx,
  projectId: string,
): Promise<
  Map<string, { total: number; done: number; unfinished: number; estimate: number; estimateDone: number }>
> {
  const tally = new Map<
    string,
    { total: number; done: number; unfinished: number; estimate: number; estimateDone: number }
  >()
  const terminal = new Set(
    (await ctx.db.select('flow.Column', { projectId, terminalState: true, active: true })).map((row) =>
      String(row.id),
    ),
  )
  // One read of the project's live issues that carry a sprint. Estimates are
  // decimals, which no `count` adds up, so the sum happens here — over the
  // sprint members only, not over the project.
  const I = ctx.table('flow.Issue')
  const rows = await ctx.db.all(
    from(I).where(eq(I.projectId, projectId), eq(I.active, true), isNotNull(I.sprintId)),
  )
  for (const row of rows) {
    const key = String(row.sprintId)
    const at = tally.get(key) ?? { total: 0, done: 0, unfinished: 0, estimate: 0, estimateDone: 0 }
    const finished = terminal.has(String(row.columnId))
    at.total += 1
    at.estimate += n(row.estimate)
    if (finished) {
      at.done += 1
      at.estimateDone += n(row.estimate)
    } else at.unfinished += 1
    tally.set(key, at)
  }
  return tally
}

/** The same reading for epics, which have the same missing total. */
export async function epicTotals(
  ctx: Ctx,
  projectId: string,
): Promise<Map<string, { total: number; done: number; estimate: number; estimateDone: number }>> {
  const tally = new Map<string, { total: number; done: number; estimate: number; estimateDone: number }>()
  const terminal = new Set(
    (await ctx.db.select('flow.Column', { projectId, terminalState: true, active: true })).map((row) =>
      String(row.id),
    ),
  )
  const I = ctx.table('flow.Issue')
  const rows = await ctx.db.all(
    from(I).where(eq(I.projectId, projectId), eq(I.active, true), isNotNull(I.epicId)),
  )
  for (const row of rows) {
    const key = String(row.epicId)
    const at = tally.get(key) ?? { total: 0, done: 0, estimate: 0, estimateDone: 0 }
    at.total += 1
    at.estimate += n(row.estimate)
    if (terminal.has(String(row.columnId))) {
      at.done += 1
      at.estimateDone += n(row.estimate)
    }
    tally.set(key, at)
  }
  return tally
}
