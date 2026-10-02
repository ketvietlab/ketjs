import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { readableRow } from '../membership.ts'
import { archiveIssue, assignSprint, moveIssue, restoreIssue, saveIssue } from '../domain/issue-write.ts'
import { n } from '../domain/command.ts'
import { defineFn } from '@ketvietlab/ketjs'
import { issueWriteEffects, membershipEffects, timelineEntryEffects } from './effects.ts'

export async function issueEditDescriptionHandler(ctx: Ctx, args: Record<string, unknown>) {
  return (await readableRow(ctx, 'flow.Issue', args.id)) ?? null
}

export function issueSaveHandler(ctx: Ctx, args: Record<string, unknown>) {
  return saveIssue(ctx, {
    ...(args as Record<string, unknown>),
    id: String(args.id),
    projectId: String(args.projectId),
    columnId: String(args.columnId),
    title: String(args.title),
    idempotencyKey: String(args.idempotencyKey),
    tagIds: Array.isArray(args.tagIds) ? args.tagIds.map(String) : undefined,
    fields:
      args.fields && typeof args.fields === 'object' ? (args.fields as Record<string, unknown>) : undefined,
  })
}

export function issueMoveHandler(ctx: Ctx, args: Record<string, unknown>) {
  return moveIssue(ctx, {
    id: String(args.id),
    columnId: String(args.columnId),
    expectedVersion: Number(args.expectedVersion),
    idempotencyKey: String(args.idempotencyKey),
  })
}

export function issueAssignSprintHandler(ctx: Ctx, args: Record<string, unknown>) {
  return assignSprint(ctx, {
    id: String(args.id),
    sprintId: args.sprintId ? String(args.sprintId) : null,
    expectedVersion: Number(args.expectedVersion),
    idempotencyKey: String(args.idempotencyKey),
  })
}

export function issueArchiveHandler(ctx: Ctx, args: Record<string, unknown>) {
  return archiveIssue(ctx, {
    id: String(args.id),
    expectedVersion: n(args.expectedVersion),
    idempotencyKey: String(args.idempotencyKey),
  })
}

export function issueRestoreHandler(ctx: Ctx, args: Record<string, unknown>) {
  return restoreIssue(ctx, {
    id: String(args.id),
    expectedVersion: n(args.expectedVersion),
    idempotencyKey: String(args.idempotencyKey),
  })
}

export const issueWriteFunctions: Record<string, FnSpec> = {
  /**
   * The permission that guards the collaborative description.
   *
   * The description is a Yjs document edited over flow_backend's `/push` and
   * `/leave` routes, not through `issue.save`, so it needs its own grantable
   * key — those routes used to authorize with `issue.get`, which made a
   * read-only role able to rewrite any issue's text. It answers with the
   * issue so the caller does not read it twice.
   */
  'issue.editDescription': defineFn({
    input: { id: 'id' },
    effects: ['read:flow.Issue', ...membershipEffects],
    agent: true,
    handler: issueEditDescriptionHandler,
  }),
  'issue.save': defineFn({
    input: {
      id: 'id',
      projectId: 'id',
      columnId: 'id',
      typeId: 'id?',
      epicId: 'id?',
      sprintId: 'id?',
      parentIssueId: 'id?',
      title: 'text',
      assigneeUserId: 'id?',
      priority: 'text?',
      startDate: 'date?',
      dueDate: 'date?',
      estimate: 'decimal?',
      tagIds: 'json?',
      /** Custom field values, keyed by field id or by field code. */
      fields: 'json?',
      expectedVersion: 'int?',
      idempotencyKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [...issueWriteEffects],
    idempotent: true,
    agent: true,
    handler: issueSaveHandler,
  }),
  'issue.move': defineFn({
    input: { id: 'id', columnId: 'id', expectedVersion: 'int', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    // The move leaves a timeline entry now — "who put this in Done, and when"
    // is the question the cluster could not answer — so it writes to the thread.
    effects: [
      'read:flow.Issue',
      'write:flow.Issue',
      'read:flow.Column',
      'read:flow.IssueDependency',
      ...timelineEntryEffects,
      ...membershipEffects,
    ],
    idempotent: true,
    agent: true,
    handler: issueMoveHandler,
  }),
  'issue.assignSprint': defineFn({
    input: { id: 'id', sprintId: 'id?', expectedVersion: 'int', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [
      'read:flow.Issue',
      'write:flow.Issue',
      'read:flow.Sprint',
      ...timelineEntryEffects,
      ...membershipEffects,
    ],
    idempotent: true,
    agent: true,
    handler: issueAssignSprintHandler,
  }),
  /**
   * Off the board, without claiming it was finished — see archiveIssue.
   *
   * Its own key rather than a flag on `issue.save`: taking work out of every
   * figure the project reports is a different act from editing a field, and the
   * catalogue can price it separately.
   */
  'issue.archive': defineFn({
    input: { id: 'id', expectedVersion: 'int', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: ['read:flow.Issue', 'write:flow.Issue', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: issueArchiveHandler,
  }),
  'issue.restore': defineFn({
    input: { id: 'id', expectedVersion: 'int', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: ['read:flow.Issue', 'write:flow.Issue', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: issueRestoreHandler,
  }),
}
