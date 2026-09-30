import type { Ctx } from '@ketvietlab/ketjs'
import type { FlowIssue, FlowResult } from './command.ts'
import { actorRequired, commandKey, commandRecordId, invalid, issue, n } from './command.ts'
import { readableRow } from '../membership.ts'
import { archiveIssue, moveIssue, restoreIssue, saveIssue } from './issue-write.ts'

/**
 * Move an issue into another project.
 *
 * Both ends go through the membership gate: moving work into a project you
 * cannot see is writing to a project you cannot see, and moving it out of one
 * is reading it. Either way the answer is the same "not found" every other
 * Flow path gives (FLW-DEC-012).
 *
 * An issue with children refuses rather than leaving them behind pointing at a
 * parent in another project. That is the same shape of orphan the purge job
 * takes care to avoid, and silently splitting a tree is worse than saying no.
 */
export const BULK_ACTIONS = ['move', 'assign', 'archive', 'restore'] as const

export type BulkAction = (typeof BULK_ACTIONS)[number]

/** How many issues one request may touch. */
export const BULK_LIMIT = 200

export type BulkOutcome = {
  applied: number
  refused: Array<{ id: string; code: string }>
}

/**
 * One action over many issues, applied one at a time and reported per issue.
 *
 * **This is not protected against concurrent edits, and cannot be.** Every
 * single-issue command takes an `expectedVersion` because the caller read the
 * record and is saying which version they meant. A person who ticked forty
 * rows on a list has read no versions and could not supply them, so this reads
 * each issue's current version and acts on it. Filling in a version on the
 * caller's behalf would be pretending to a guarantee that is not there — the
 * point of saying so here is that the guarantee is genuinely absent, not that
 * it is hidden.
 *
 * What replaces it is the report. Nothing is rolled back for a neighbour's
 * failure: an issue the caller cannot see, one already in the state asked for,
 * one that lost a race — each is named with its reason, and the rest still
 * happen. A bulk action that failed atomically would leave somebody with forty
 * rows and no idea which one was the problem.
 */
export async function bulkIssues(
  ctx: Ctx,
  input: { ids: readonly string[]; action: BulkAction; value?: string | null; idempotencyKey: string },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  if (!BULK_ACTIONS.includes(input.action)) return invalid(issue('action', 'flow.error.invalidAction'))
  const ids = [...new Set(input.ids.map(String).filter(Boolean))]
  if (!ids.length) return invalid(issue('ids', 'flow.error.required'))
  if (ids.length > BULK_LIMIT) return invalid(issue('ids', 'flow.error.tooMany', { limit: BULK_LIMIT }))
  if ((input.action === 'move' || input.action === 'assign') && !input.value)
    return invalid(issue('value', 'flow.error.required'))

  const outcome: BulkOutcome = { applied: 0, refused: [] }
  for (const id of ids) {
    // Read through the gate, one at a time. An issue in a project this caller
    // is not on is not found, and is refused for that reason rather than
    // being silently skipped — a count that does not add up is worse than a
    // refusal that says why.
    const held = await readableRow(ctx, 'flow.Issue', id)
    if (!held) {
      outcome.refused.push({ id, code: 'flow.error.notFound' })
      continue
    }
    // A key per issue, derived from the one the request carries, so a retry
    // of the whole batch replays each item rather than being refused as a
    // duplicate of the first.
    const key = commandRecordId(`flow.issue.bulk:${input.action}:${id}`, input.idempotencyKey)
    const version = n(held.version)
    const result =
      input.action === 'move'
        ? await moveIssue(ctx, {
            id,
            columnId: String(input.value),
            expectedVersion: version,
            idempotencyKey: key,
          })
        : input.action === 'archive'
          ? await archiveIssue(ctx, { id, expectedVersion: version, idempotencyKey: key })
          : input.action === 'restore'
            ? await restoreIssue(ctx, { id, expectedVersion: version, idempotencyKey: key })
            : await saveIssue(ctx, {
                id,
                projectId: String(held.projectId),
                columnId: String(held.columnId),
                title: String(held.title ?? ''),
                assigneeUserId: input.value ? String(input.value) : null,
                expectedVersion: version,
                idempotencyKey: key,
              })
    if (result.ok) outcome.applied += 1
    else
      outcome.refused.push({
        id,
        code: String((result.errors as FlowIssue[] | undefined)?.[0]?.code ?? 'flow.error.invalid'),
      })
  }
  return { ok: true, ...outcome }
}
