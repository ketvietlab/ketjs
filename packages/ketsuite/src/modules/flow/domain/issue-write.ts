import type { Ctx, Row } from '@ketvietlab/ketjs'
import type { FlowResult } from './command.ts'
import { actorRequired, commandKey, invalid, issue, n, now } from './command.ts'
import { ISSUE_PRIORITIES } from '../types.ts'
import {
  assignableSprint,
  columnOf,
  fieldValueError,
  fieldsOfProject,
  issueEpic,
  issueType,
  parentIssueError,
  projectExists,
  userExists,
} from './issue-validation.ts'
import { readableRow } from '../membership.ts'
import { deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import { followIssue } from './issue-discussion.ts'
import { ensureThread, postMessage } from '../../mail/index.ts'

export type SaveIssueInput = {
  id: string
  projectId: string
  columnId: string
  typeId?: string | null
  epicId?: string | null
  sprintId?: string | null
  parentIssueId?: string | null
  title: string
  assigneeUserId?: string | null
  priority?: string
  startDate?: string | null
  dueDate?: string | null
  estimate?: unknown
  tagIds?: string[]
  /** Custom field values, keyed by field id or by field code. */
  fields?: Record<string, unknown>
  expectedVersion?: number
  idempotencyKey: string
}

export async function saveIssue(ctx: Ctx, input: SaveIssueInput): Promise<FlowResult> {
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!String(input.title ?? '').trim()) return invalid(issue('title', 'flow.error.required'))
  if (!ISSUE_PRIORITIES.includes(String(input.priority ?? 'normal') as never))
    return invalid(issue('priority', 'flow.error.invalidPriority'))
  if (!(await projectExists(ctx, input.projectId))) return invalid(issue('projectId', 'flow.error.notFound'))
  const column = await columnOf(ctx, input.columnId)
  if (!column || String(column.projectId) !== String(input.projectId))
    return invalid(issue('columnId', 'flow.error.invalidColumn'))
  if (!(await userExists(ctx, input.assigneeUserId)))
    return invalid(issue('assigneeUserId', 'flow.error.notFound'))
  const sprint = await assignableSprint(ctx, input.sprintId)
  if (sprint === undefined) return invalid(issue('sprintId', 'flow.error.sprintClosed'))
  if (sprint && String(sprint.projectId) !== String(input.projectId))
    return invalid(issue('sprintId', 'flow.error.sprintProjectMismatch'))
  const epic = await issueEpic(ctx, input.epicId)
  if (epic === undefined) return invalid(issue('epicId', 'flow.error.notFound'))
  if (epic && String(epic.projectId) !== String(input.projectId))
    return invalid(issue('epicId', 'flow.error.epicProjectMismatch'))
  const kind = await issueType(ctx, input.typeId)
  if (kind === undefined) return invalid(issue('typeId', 'flow.error.notFound'))
  if (kind && String(kind.projectId) !== String(input.projectId))
    return invalid(issue('typeId', 'flow.error.typeProjectMismatch'))
  return ctx.tx(async (tx) => {
    const existing = await readableRow(tx, 'flow.Issue', input.id)
    if (existing && String(existing.projectId) !== String(input.projectId))
      return invalid(issue('projectId', 'flow.error.immutableProject'))
    // moveIssue is the only door into a column, because it is the one that
    // checks `blocks` dependencies before letting an issue reach a terminal
    // state. Save used to keep `existing.columnId` and still answer ok, so a
    // caller asking for a different column was told the move had happened.
    if (existing && String(existing.columnId) !== String(input.columnId))
      return invalid(issue('columnId', 'flow.error.columnNeedsMove'))
    const parentError = await parentIssueError(tx, input.id, input.parentIssueId, String(input.projectId))
    if (parentError) return invalid(parentError)
    // Resolved before the issue row is touched: `tx` only rolls back on a
    // thrown exception, not on a plain `return invalid(...)`, so validating
    // tags after the insert/compareAndSet below committed a half-written
    // issue (row present, no tags, caller told `ok: false`) on every bad
    // tagId — found by seeding 1000 issues and finding "failed" ones that
    // existed anyway.
    const tagIds = input.tagIds ? [...new Set(input.tagIds)] : null
    if (tagIds) {
      const tags = tagIds.length
        ? await tx.db.all(
            from(tx.table('flow.Tag')).where(
              inArray(tx.table('flow.Tag').id, tagIds),
              eq(tx.table('flow.Tag').active, true),
            ),
          )
        : []
      if (tags.length !== tagIds.length) return invalid(issue('tagIds', 'flow.error.notFound'))
    }
    // Custom field values, resolved and checked here for the same reason the
    // tags above are: `tx` rolls back on a thrown exception, not on a returned
    // `invalid`, so anything validated after the write below leaves a
    // half-written issue behind and still reports failure.
    const fieldWrites: Array<{ field: Row; value: string }> = []
    if (input.fields) {
      const defs = await fieldsOfProject(tx, input.projectId)
      for (const [key, raw] of Object.entries(input.fields)) {
        const field = defs.get(String(key))
        // A field this project does not have, rather than one that is merely
        // empty: naming it is a mistake worth reporting, the same as an epic
        // from another board.
        if (!field) return invalid(issue(`field:${key}`, 'flow.error.fieldUnknown'))
        const error = fieldValueError(field, raw)
        if (error) return invalid(error)
        fieldWrites.push({ field, value: String(raw ?? '').trim() })
      }
    }
    const timestamp = now()
    const nextVersion = n(existing?.version) + 1
    // A reference the caller did not mention keeps what is stored; an
    // explicit null clears it. `priority` and `estimate` below already read
    // this way, but epic, sprint, parent, assignee and due date did not — so
    // any caller sending a partial record silently cleared the rest. The
    // issue detail screen is exactly that caller: its form carries no sprint
    // and no parent field (both have their own action), so editing a title
    // dropped the issue out of its sprint and orphaned its sub-task link.
    const kept = <T>(given: T | null | undefined, stored: unknown): unknown =>
      given === undefined ? (stored ?? null) : given || null
    const values: Row = {
      projectId: input.projectId,
      columnId: existing ? existing.columnId : input.columnId,
      typeId: input.typeId === undefined ? (existing?.typeId ?? null) : kind ? kind.id : null,
      epicId: input.epicId === undefined ? (existing?.epicId ?? null) : epic ? epic.id : null,
      sprintId: input.sprintId === undefined ? (existing?.sprintId ?? null) : sprint ? sprint.id : null,
      parentIssueId: kept(input.parentIssueId, existing?.parentIssueId),
      title: input.title.trim(),
      assigneeUserId: kept(input.assigneeUserId, existing?.assigneeUserId),
      priority: input.priority ?? existing?.priority ?? 'normal',
      startDate: kept(input.startDate, existing?.startDate),
      dueDate: kept(input.dueDate, existing?.dueDate),
      estimate: input.estimate == null ? (existing?.estimate ?? null) : String(input.estimate),
      active: true,
      version: nextVersion,
      updatedAt: timestamp,
    }
    let threadId: string
    if (existing) {
      const expected = input.expectedVersion ?? n(existing.version)
      const changed = await tx.db.compareAndSet('flow.Issue', { id: input.id }, { version: expected }, values)
      if (!('dryRun' in changed) && !changed.matched)
        return invalid(issue('version', 'flow.error.conflict', { current: existing.version }))
      threadId = String(existing.threadId)
    } else {
      const thread = await ensureIssueThread(tx, input.id, input.title.trim(), timestamp)
      threadId = String(thread.id)
      await tx.db.insert('flow.Issue', {
        id: input.id,
        ...values,
        threadId: thread.id,
        createdByUserId: tx.actor ?? null,
        createdAt: timestamp,
      })
    }
    if (tagIds) {
      const IT = tx.table('flow.IssueTag')
      await tx.db.del(deleteFrom(IT).where(eq(IT.issueId, input.id)))
      for (const tagId of tagIds)
        await tx.db.insertIfAbsent('flow.IssueTag', { id: `${input.id}:${tagId}`, issueId: input.id, tagId })
    }
    // One row per issue and field, so a value is replaced rather than
    // accumulated. Emptying one deletes the row instead of storing "": a field
    // nobody has answered and a field answered with nothing read the same on
    // screen, and only one of them should cost a row.
    for (const { field, value } of fieldWrites) {
      const id = `${input.id}:${String(field.id)}`
      if (!value) {
        const V = tx.table('flow.IssueFieldValue')
        await tx.db.del(deleteFrom(V).where(eq(V.id, id)))
        continue
      }
      // insertIfAbsent then update, rather than branching on whether the row
      // exists: `db.update` answers with a result object either way, so there
      // is nothing truthy to branch on, and the pair is correct in both cases.
      await tx.db.insertIfAbsent('flow.IssueFieldValue', {
        id,
        issueId: input.id,
        fieldId: field.id,
        value,
      })
      await tx.db.update('flow.IssueFieldValue', { id }, { value })
    }

    // Whoever opened it, and whoever it lands on, are subscribed to its
    // thread. Until this existed the thread had no followers at all, so
    // `postMessage` addressed nobody and every comment notified nobody — the
    // discussion feature was wired end to end and silently inert.
    if (!existing) await followIssue(tx, threadId, tx.actor)
    const assignee = values.assigneeUserId
    if (assignee) await followIssue(tx, threadId, assignee)
    // Only what actually moved: a system entry on every title edit is noise,
    // and the timeline is the one place that has to stay readable.
    const handedOver =
      assignee && String(assignee) !== String(existing?.assigneeUserId ?? '')
        ? [
            {
              field: 'assigneeUserId',
              ...(existing?.assigneeUserId ? { oldValue: String(existing.assigneeUserId) } : {}),
              newValue: String(assignee),
            },
          ]
        : []
    const rescheduled = existing
      ? [
          ...moved('dueDate', existing.dueDate, values.dueDate),
          ...moved('priority', existing.priority, values.priority),
        ]
      : []
    if (handedOver.length || rescheduled.length)
      await postMessage(tx, {
        id: `${input.id}:assigned:${nextVersion}`,
        threadId,
        authorUserId: tx.actor ?? undefined,
        kind: 'system',
        // A message key, resolved by whoever renders the timeline — the same
        // arrangement crm_backend's `entryBody` already reads. Handing an issue
        // over keeps its own key, because that is the entry people look for.
        body: rescheduled.length && !handedOver.length ? 'flow.timeline.changed' : 'flow.timeline.assigned',
        tracking: [...handedOver, ...rescheduled],
      })
    return { ok: true, id: input.id, version: nextVersion }
  })
}

/**
 * One system entry per command, carrying every tracked field that moved.
 *
 * The timeline used to record exactly one thing — who an issue was handed to —
 * so "who put this in Done, and when" had no answer anywhere in the system. The
 * fields tracked are the ones a person asks about afterwards: the column, the
 * deadline, the priority and the sprint. Title and description are deliberately
 * out: an entry per keystroke is what makes a timeline unreadable, and both
 * already have their own history in the Live Doc.
 *
 * One message rather than one per field, because a single edit that moved three
 * of them is one thing that happened.
 */
export async function trackIssueChange(
  tx: Ctx,
  input: {
    issueId: string
    threadId: unknown
    version: number
    body: string
    changes: Array<{ field: string; oldValue?: string; newValue?: string }>
  },
): Promise<void> {
  if (!input.changes.length || !input.threadId) return
  await postMessage(tx, {
    id: `${input.issueId}:changed:${input.version}`,
    threadId: String(input.threadId),
    authorUserId: tx.actor ?? undefined,
    kind: 'system',
    body: input.body,
    tracking: input.changes,
  })
}

/** A change worth an entry, or nothing when the value did not actually move. */
export const moved = (
  field: string,
  before: unknown,
  after: unknown,
): Array<{ field: string; oldValue?: string; newValue?: string }> => {
  const from = before == null || before === '' ? '' : String(before)
  const to = after == null || after === '' ? '' : String(after)
  if (from === to) return []
  return [{ field, ...(from ? { oldValue: from } : {}), ...(to ? { newValue: to } : {}) }]
}

export async function ensureIssueThread(
  ctx: Ctx,
  issueId: string,
  title: string,
  createdAt: string,
): Promise<Row> {
  return ensureThread(ctx, {
    id: `thread:flow.Issue:${issueId}`,
    resModel: 'flow.Issue',
    resId: issueId,
    displayName: title,
    createdAt,
  })
}

export async function moveIssue(
  ctx: Ctx,
  input: { id: string; columnId: string; expectedVersion: number; idempotencyKey: string },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  return ctx.tx(async (tx) => {
    const held = await readableRow(tx, 'flow.Issue', input.id)
    if (!held) return invalid(issue('id', 'flow.error.notFound'))
    const column = await columnOf(tx, input.columnId)
    if (!column || String(column.projectId) !== String(held.projectId))
      return invalid(issue('columnId', 'flow.error.invalidColumn'))
    if (column.terminalState === true) {
      const blockers = (
        await tx.db.select('flow.IssueDependency', { issueId: input.id, relation: 'blocks' })
      ).map((row) => String(row.dependsOnIssueId))
      if (blockers.length) {
        const blockingIssues = await tx.db.all(
          from(tx.table('flow.Issue')).where(inArray(tx.table('flow.Issue').id, blockers)),
        )
        const columnIds = [...new Set(blockingIssues.map((row) => String(row.columnId)))]
        const blockingColumns = columnIds.length
          ? await tx.db.all(
              from(tx.table('flow.Column')).where(inArray(tx.table('flow.Column').id, columnIds)),
            )
          : []
        const terminal = new Set(
          blockingColumns.filter((row) => row.terminalState === true).map((row) => String(row.id)),
        )
        const open = blockingIssues.filter((row) => !terminal.has(String(row.columnId)))
        if (open.length) return invalid(issue('columnId', 'flow.error.blocked'))
      }
    }
    const timestamp = now()
    const changed = await tx.db.compareAndSet(
      'flow.Issue',
      { id: input.id },
      { version: input.expectedVersion },
      { columnId: input.columnId, version: n(held.version) + 1, updatedAt: timestamp },
    )
    if (!('dryRun' in changed) && !changed.matched)
      return invalid(issue('version', 'flow.error.conflict', { current: held.version }))
    await trackIssueChange(tx, {
      issueId: input.id,
      threadId: held.threadId,
      version: n(held.version) + 1,
      body: 'flow.timeline.moved',
      changes: moved('columnId', held.columnId, input.columnId),
    })
    return { ok: true, id: input.id, version: n(held.version) + 1 }
  })
}

export async function assignSprint(
  ctx: Ctx,
  input: { id: string; sprintId: string | null; expectedVersion: number; idempotencyKey: string },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  return ctx.tx(async (tx) => {
    const held = await readableRow(tx, 'flow.Issue', input.id)
    if (!held) return invalid(issue('id', 'flow.error.notFound'))
    const sprint = await assignableSprint(tx, input.sprintId)
    if (sprint === undefined) return invalid(issue('sprintId', 'flow.error.sprintClosed'))
    if (sprint && String(sprint.projectId) !== String(held.projectId))
      return invalid(issue('sprintId', 'flow.error.sprintProjectMismatch'))
    const timestamp = now()
    const changed = await tx.db.compareAndSet(
      'flow.Issue',
      { id: input.id },
      { version: input.expectedVersion },
      { sprintId: sprint ? sprint.id : null, version: n(held.version) + 1, updatedAt: timestamp },
    )
    if (!('dryRun' in changed) && !changed.matched)
      return invalid(issue('version', 'flow.error.conflict', { current: held.version }))
    await trackIssueChange(tx, {
      issueId: input.id,
      threadId: held.threadId,
      version: n(held.version) + 1,
      body: 'flow.timeline.sprint',
      changes: moved('sprintId', held.sprintId, sprint ? sprint.id : null),
    })
    return { ok: true, id: input.id, version: n(held.version) + 1 }
  })
}

/**
 * Leaves an issue's thread.
 *
 * The only way out of a subscription this module hands out freely: being
 * assigned an issue, commenting on one, or being mentioned in one all
 * subscribe you, and every comment afterwards reaches you. Without this the
 * follower set only ever grows, and a single mention in a busy spec is a
 * standing appointment nobody agreed to.
 *
 * Answers ok when there was nothing to remove, because "I do not want these"
 * is satisfied either way.
 */
/**
 * Take an issue off the board without pretending it was finished.
 *
 * `Issue.active` has been in the model and in four indexes since Flow was
 * written, `issue.list` has taken `includeArchived`, and nothing has ever
 * written `false` — so the only way to clear a cancelled task was to drop it in
 * the done column, which made every progress figure lie about it.
 *
 * Under compare-and-set, unlike `page.archive`: an issue carries a version
 * because two people work the same one, and archiving from a stale screen is
 * exactly the kind of mistake that guard exists for.
 *
 * What archiving is *not*: it is not completion and it is not deletion.
 * Dependencies stay, so an archived blocker still blocks — silently unblocking
 * work is the worst way to clear a blocker (FLW-DEC-011). Sub-tasks keep their
 * parent, so restoring a parent restores the branch as it was.
 */
export async function archiveIssue(
  ctx: Ctx,
  input: { id: string; expectedVersion: number; idempotencyKey: string },
): Promise<FlowResult> {
  return setIssueActive(ctx, input, false)
}

/**
 * Put it back, exactly where it was.
 *
 * Unlike `page.restore` this needs no reparenting rule: a sub-task of an
 * archived parent is still listed on every board and list of its own, so it
 * cannot come back invisible the way a page under an archived page would.
 */
export async function restoreIssue(
  ctx: Ctx,
  input: { id: string; expectedVersion: number; idempotencyKey: string },
): Promise<FlowResult> {
  return setIssueActive(ctx, input, true)
}

export async function setIssueActive(
  ctx: Ctx,
  input: { id: string; expectedVersion: number; idempotencyKey: string },
  active: boolean,
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  return ctx.tx(async (tx) => {
    const held = await readableRow(tx, 'flow.Issue', input.id)
    if (!held) return invalid(issue('id', 'flow.error.notFound'))
    // Already where the caller wants it: say so rather than burning a version.
    if (Boolean(held.active) === active) return { ok: true, id: input.id, version: n(held.version) }
    if (n(held.version) !== input.expectedVersion)
      return invalid(issue('version', 'flow.error.conflict', { current: held.version }))
    const version = n(held.version) + 1
    await tx.db.update('flow.Issue', { id: input.id }, { active, version, updatedAt: now() })
    return { ok: true, id: input.id, version }
  })
}
