import type { Ctx, Row } from '@ketvietlab/ketjs'
import type { FlowIssue, FlowResult } from './command.ts'
import { actorRequired, commandKey, commandRecordId, invalid, issue, n, now } from './command.ts'
import { deleteFrom, eq, inArray } from '@ketvietlab/ketjs'
import { readableProject, readableRow } from '../membership.ts'
import { saveIssue } from './issue-write.ts'

/**
 * A `blocks` dependency that has not itself reached a terminal column keeps the
 * blocked issue out of one too — the one place the fixed dependency vocabulary
 * (see types.ts) drives actual behavior instead of just being a label.
 */
/**
 * What a project keeps to itself, and what travels with an issue that leaves.
 *
 * Almost everything an issue points at belongs to the project it is in:
 * columns, issue types, epics, sprints and custom field definitions are all
 * keyed by project, so none of them mean anything on the other side. Tags are
 * the exception and stay untouched, because a tag belongs to the company
 * rather than to the project that happened to use it (FLW-DEC-006).
 *
 * The mapping is by `code`, not by id. A destination that has its own "bug"
 * type or its own "severity" field is asking for the same thing under the same
 * name, and carrying the value across is what somebody moving work expects.
 * Anything with no counterpart is dropped and counted, because a move that
 * quietly loses a field value is a move nobody can audit afterwards.
 */
export type TransferReport = {
  columnId: string
  typeId: string | null
  epicCleared: boolean
  sprintCleared: boolean
}

export async function planTransfer(
  ctx: Ctx,
  held: Row,
  projectId: string,
  columnId: unknown,
): Promise<TransferReport | FlowIssue> {
  const columns = await ctx.db.select('flow.Column', { projectId, active: true })
  if (!columns.length) return issue('projectId', 'flow.error.projectHasNoColumns')
  const named = columnId ? columns.find((row) => String(row.id) === String(columnId)) : undefined
  if (columnId && !named) return issue('columnId', 'flow.error.notFound')
  // No column named: the first one work arrives in, by the order the board
  // shows. Landing in a terminal column would report the issue as finished
  // the moment it moved, which is the one answer a move must not invent.
  const landing =
    named ??
    [...columns]
      .filter((row) => row.terminalState !== true)
      .sort((a, b) => n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id)))[0] ??
    columns[0]!

  let typeId: string | null = null
  if (held.typeId) {
    const from = (await ctx.db.select('flow.IssueType', { id: held.typeId }))[0]
    const to = from
      ? (await ctx.db.select('flow.IssueType', { projectId, code: from.code, active: true }))[0]
      : undefined
    typeId = to ? String(to.id) : null
  }
  return {
    columnId: String(landing.id),
    typeId,
    epicCleared: held.epicId != null,
    sprintCleared: held.sprintId != null,
  }
}

/** Carry the custom field values whose code exists on the other side. */
export async function carryFields(
  ctx: Ctx,
  fromIssueId: string,
  toIssueId: string,
  projectId: string,
): Promise<{ carried: number; dropped: number }> {
  const values = await ctx.db.select('flow.IssueFieldValue', { issueId: fromIssueId })
  if (!values.length) return { carried: 0, dropped: 0 }
  const defs = await ctx.db.select('flow.FieldDef', { projectId, active: true })
  const byCode = new Map(defs.map((def) => [String(def.code), def]))
  let carried = 0
  for (const value of values) {
    const from = (await ctx.db.select('flow.FieldDef', { id: value.fieldId }))[0]
    const to = from ? byCode.get(String(from.code)) : undefined
    if (!to) continue
    await ctx.db.insertIfAbsent('flow.IssueFieldValue', {
      id: `${toIssueId}:${String(to.id)}`,
      issueId: toIssueId,
      fieldId: to.id,
      value: value.value ?? null,
    })
    carried += 1
  }
  return { carried, dropped: values.length - carried }
}

export async function transferIssue(
  ctx: Ctx,
  input: {
    id: string
    projectId: string
    columnId?: string | null
    expectedVersion: number
    idempotencyKey: string
  },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  return ctx.tx(async (tx) => {
    const held = await readableRow(tx, 'flow.Issue', input.id)
    if (!held) return invalid(issue('id', 'flow.error.notFound'))
    if (String(held.projectId) === String(input.projectId))
      return invalid(issue('projectId', 'flow.error.sameProject'))
    if (n(held.version) !== input.expectedVersion)
      return invalid(issue('version', 'flow.error.conflict', { current: held.version }))
    const destination = await readableProject(tx, input.projectId)
    if (!destination || destination.active !== true) return invalid(issue('projectId', 'flow.error.notFound'))
    const children = await tx.db.select('flow.Issue', { parentIssueId: input.id, active: true })
    if (children.length) return invalid(issue('id', 'flow.error.issueHasChildren'))

    const plan = await planTransfer(tx, held, String(input.projectId), input.columnId)
    if ('code' in plan) return invalid(plan as FlowIssue)

    // The values move rather than being copied, so they are read before the
    // old ones go and written against the destination's own definitions.
    const carried = await carryFields(tx, input.id, input.id, String(input.projectId))
    const V = tx.table('flow.IssueFieldValue')
    const defs = await tx.db.select('flow.FieldDef', { projectId: held.projectId })
    if (defs.length)
      await tx.db.del(
        deleteFrom(V).where(
          eq(V.issueId, input.id),
          inArray(
            V.fieldId,
            defs.map((def) => String(def.id)),
          ),
        ),
      )

    const version = n(held.version) + 1
    await tx.db.update(
      'flow.Issue',
      { id: input.id },
      {
        projectId: input.projectId,
        columnId: plan.columnId,
        typeId: plan.typeId,
        // Neither means anything on the other side, and keeping either would
        // put an issue in a sprint its new project does not run.
        epicId: null,
        sprintId: null,
        parentIssueId: null,
        version,
        updatedAt: now(),
      },
    )
    return {
      ok: true,
      id: input.id,
      version,
      columnId: plan.columnId,
      fieldsCarried: carried.carried,
      fieldsDropped: carried.dropped,
      typeCleared: Boolean(held.typeId) && plan.typeId === null,
      epicCleared: plan.epicCleared,
      sprintCleared: plan.sprintCleared,
    }
  })
}

/**
 * Put a copy of an issue into another project, leaving the original alone.
 *
 * The same mapping `transferIssue` uses, because the crossing is the same
 * crossing — a type or a field that has no counterpart on the other side has
 * none whether the issue is moving or being duplicated.
 *
 * What a copy deliberately does not bring is the history: the comments, the
 * followers and the document are the record of a conversation that happened
 * about *that* issue, and duplicating them would put words in people's mouths
 * on a record they never saw. The copy starts with a title and the fields, and
 * whoever asked for it can say the rest themselves (FLW-020).
 */
export async function copyIssue(
  ctx: Ctx,
  input: {
    id: string
    projectId: string
    columnId?: string | null
    title?: string | null
    idempotencyKey: string
  },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  const held = await readableRow(ctx, 'flow.Issue', input.id)
  if (!held) return invalid(issue('id', 'flow.error.notFound'))
  const destination = await readableProject(ctx, input.projectId)
  if (!destination || destination.active !== true) return invalid(issue('projectId', 'flow.error.notFound'))
  const plan = await planTransfer(ctx, held, String(input.projectId), input.columnId)
  if ('code' in plan) return invalid(plan as FlowIssue)

  // Derived from the key, so a double click makes one copy rather than two —
  // the same reason the create form derives its id (FLW-033).
  const id = commandRecordId(`flow.issue.copy:${input.id}:${String(input.projectId)}`, input.idempotencyKey)
  const tags = await ctx.db.select('flow.IssueTag', { issueId: input.id })
  const made = await saveIssue(ctx, {
    id,
    projectId: String(input.projectId),
    columnId: plan.columnId,
    typeId: plan.typeId,
    title: String(input.title ?? held.title ?? ''),
    assigneeUserId: held.assigneeUserId ? String(held.assigneeUserId) : null,
    priority: String(held.priority ?? '2'),
    startDate: held.startDate ? String(held.startDate) : null,
    dueDate: held.dueDate ? String(held.dueDate) : null,
    estimate: held.estimate ?? undefined,
    // A tag is the company's, so it means the same thing in both projects.
    tagIds: tags.map((row) => String(row.tagId)),
    idempotencyKey: input.idempotencyKey,
  })
  if (!made.ok) return made
  const carried = await carryFields(ctx, input.id, id, String(input.projectId))
  return {
    ok: true,
    id,
    columnId: plan.columnId,
    fieldsCarried: carried.carried,
    fieldsDropped: carried.dropped,
    typeCleared: Boolean(held.typeId) && plan.typeId === null,
  }
}
