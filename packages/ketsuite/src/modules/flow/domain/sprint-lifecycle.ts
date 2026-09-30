import type { Ctx } from '@ketvietlab/ketjs'
import { actorRequired, commandKey, invalid, issue, n, now } from './command.ts'
import type { FlowResult } from './command.ts'
import { readableRow } from '../membership.ts'
import { deleteFrom, eq } from '@ketvietlab/ketjs'
import { moved, trackIssueChange } from './issue-write.ts'

/**
 * Contend on one row per project, so an invariant that spans rows has
 * something a database can serialize — see `flow.ProjectGuard`.
 *
 * The row is made on first use rather than with the project: a project that
 * never starts a sprint never needs one, and creating it here means projects
 * that predate this code get one the first time it matters.
 */
export async function serializeProject(ctx: Ctx, projectId: string): Promise<void> {
  const id = `guard:${projectId}`
  await ctx.db.insertIfAbsent('flow.ProjectGuard', { id, projectId, updatedAt: now() })
  await ctx.db.update('flow.ProjectGuard', { id }, { updatedAt: now() })
}

export async function startSprint(
  ctx: Ctx,
  input: { id: string; idempotencyKey: string },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  return ctx.tx(async (tx) => {
    const held = await readableRow(tx, 'flow.Sprint', input.id)
    if (!held) return invalid(issue('id', 'flow.error.notFound'))
    if (held.state !== 'planned') return invalid(issue('id', 'flow.error.invalidSprintState'))
    // Take the project's guard row before reading, so a second caller doing
    // the same thing waits here rather than racing past the check below. The
    // read after it is a new statement and so takes a fresh snapshot, which is
    // what lets it see a sprint the other transaction has just started.
    await serializeProject(tx, String(held.projectId))
    // A project runs at most one active sprint at a time, which is what makes
    // "the current sprint" a well-defined thing for the board to show.
    const active = await tx.db.select('flow.Sprint', { projectId: held.projectId, state: 'active' })
    if (active.length) return invalid(issue('id', 'flow.error.sprintAlreadyActive'))
    await tx.db.update('flow.Sprint', { id: input.id }, { state: 'active' })
    return { ok: true, id: input.id }
  })
}

/**
 * Close a sprint, and say what happens to the work that did not finish.
 *
 * Closing used to change one column and stop. The issues stayed in a sprint
 * nobody would look at again, and moving them was one screen each — the step
 * every sprint process has, done by hand.
 *
 * `carryTo` names where the unfinished work goes: another sprint of the same
 * project that is still open, or `null` to take it out of the sprint entirely.
 * Omitting it leaves the work where it is, which is what closing has always
 * done, so no existing caller changes behaviour.
 *
 * The carry is not compare-and-set. A sprint close is a deliberate act on the
 * whole set, and failing it because one issue was edited a second ago would be
 * the wrong answer; the version still moves, so anyone with that issue open
 * gets the conflict on their own next save.
 */
/**
 * Remove a sprint that was never started.
 *
 * Only `planned`, and there is no way back from `closed` at all. FLW-DEC-015
 * asked which of the two a sprint is — a record of what a team did in a
 * fortnight, or a planning tool somebody can take back — and the answer was
 * the record. So `closed` is final: every figure that reports on the past
 * reads a closed sprint, and those figures stay put. `closeSprint` is how a
 * sprint ends; this is for the other case, one made by mistake or planned and
 * then abandoned before it ever began.
 *
 * A sprint closed by accident is recovered by planning the next one, not by
 * reopening the last.
 *
 * Issues planned into it are let go rather than deleted with it. They go back
 * to the backlog, which is where they were before somebody put them in a
 * sprint that never happened; taking the work away with the plan would be a
 * surprise nobody asked for (FLW-016).
 */
export async function deleteSprint(
  ctx: Ctx,
  input: { id: string; idempotencyKey: string },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  return ctx.tx(async (tx) => {
    const held = await readableRow(tx, 'flow.Sprint', input.id)
    if (!held) return invalid(issue('id', 'flow.error.notFound'))
    if (held.state !== 'planned') return invalid(issue('id', 'flow.error.invalidSprintState'))
    const planned = await tx.db.select('flow.Issue', { sprintId: input.id })
    for (const row of planned)
      await tx.db.update('flow.Issue', { id: row.id }, { sprintId: null, updatedAt: now() })
    const S = tx.table('flow.Sprint')
    await tx.db.del(deleteFrom(S).where(eq(S.id, input.id)))
    return { ok: true, id: input.id, released: planned.length }
  })
}

export async function closeSprint(
  ctx: Ctx,
  input: { id: string; carryTo?: string | null; idempotencyKey: string },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  return ctx.tx(async (tx) => {
    const held = await readableRow(tx, 'flow.Sprint', input.id)
    if (!held) return invalid(issue('id', 'flow.error.notFound'))
    if (held.state !== 'active') return invalid(issue('id', 'flow.error.invalidSprintState'))
    let carried = 0
    if (input.carryTo !== undefined) {
      const target = input.carryTo ? await readableRow(tx, 'flow.Sprint', input.carryTo) : null
      if (input.carryTo) {
        if (!target || String(target.projectId) !== String(held.projectId))
          return invalid(issue('carryTo', 'flow.error.sprintProjectMismatch'))
        if (target.state === 'closed') return invalid(issue('carryTo', 'flow.error.sprintClosed'))
        if (String(target.id) === String(held.id))
          return invalid(issue('carryTo', 'flow.error.invalidSprintState'))
      }
      const terminal = new Set(
        (
          await tx.db.select('flow.Column', {
            projectId: held.projectId,
            terminalState: true,
            active: true,
          })
        ).map((row) => String(row.id)),
      )
      const members = await tx.db.select('flow.Issue', { sprintId: input.id, active: true })
      const timestamp = now()
      for (const row of members) {
        if (terminal.has(String(row.columnId))) continue
        await tx.db.update(
          'flow.Issue',
          { id: row.id },
          { sprintId: target ? target.id : null, version: n(row.version) + 1, updatedAt: timestamp },
        )
        await trackIssueChange(tx, {
          issueId: String(row.id),
          threadId: row.threadId,
          version: n(row.version) + 1,
          body: 'flow.timeline.sprint',
          changes: moved('sprintId', row.sprintId, target ? target.id : null),
        })
        carried += 1
      }
    }
    await tx.db.update('flow.Sprint', { id: input.id }, { state: 'closed' })
    return { ok: true, id: input.id, carried }
  })
}
