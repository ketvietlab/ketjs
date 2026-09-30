import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { bulkIssues } from '../domain/issue-bulk.ts'
import type { BulkAction } from '../domain/issue-bulk.ts'
import { copyIssue, transferIssue } from '../domain/issue-transfer.ts'
import { defineFn } from '@ketvietlab/ketjs'
import { membershipEffects } from './effects.ts'

export function issueBulkHandler(ctx: Ctx, args: Record<string, unknown>) {
  return bulkIssues(ctx, {
    ids: Array.isArray(args.ids) ? args.ids.map(String) : [],
    action: String(args.action) as BulkAction,
    value: args.value ? String(args.value) : null,
    idempotencyKey: String(args.idempotencyKey),
  })
}

export function issueCopyToHandler(ctx: Ctx, args: Record<string, unknown>) {
  return copyIssue(ctx, {
    id: String(args.id),
    projectId: String(args.projectId),
    columnId: args.columnId ? String(args.columnId) : null,
    title: args.title ? String(args.title) : null,
    idempotencyKey: String(args.idempotencyKey),
  })
}

export function issueTransferHandler(ctx: Ctx, args: Record<string, unknown>) {
  return transferIssue(ctx, {
    id: String(args.id),
    projectId: String(args.projectId),
    columnId: args.columnId ? String(args.columnId) : null,
    expectedVersion: Number(args.expectedVersion),
    idempotencyKey: String(args.idempotencyKey),
  })
}

export const issueBatchFunctions: Record<string, FnSpec> = {
  /**
   * One action over many issues — see bulkIssues, and read the note there
   * about what it deliberately does not guarantee.
   */
  'issue.bulk': defineFn({
    input: { ids: 'json', action: 'text', value: 'id?', idempotencyKey: 'text' },
    output: { ok: 'bool', applied: 'int?', refused: 'json?', errors: 'json?' },
    effects: [
      'read:flow.Issue',
      'write:flow.Issue',
      'read:flow.Column',
      'write:flow.IssueFieldValue',
      'write:flow.IssueTag',
      'read:flow.Tag',
      'read:flow.IssueTag',
      'read:flow.FieldDef',
      'read:flow.IssueType',
      'read:flow.Sprint',
      'read:mail.Thread',
      'write:mail.Thread',
      'read:mail.Message',
      'write:mail.Message',
      'read:mail.Follower',
      'write:mail.Follower',
      'read:mail.Subtype',
      'write:mail.Notification',
      'write:mail.TrackingValue',
      'read:user.User',
      ...membershipEffects,
    ],
    idempotent: true,
    agent: true,
    handler: issueBulkHandler,
  }),
  /** A copy of an issue in another project — see copyIssue for what it brings. */
  'issue.copyTo': defineFn({
    input: { id: 'id', projectId: 'id', columnId: 'id?', title: 'text?', idempotencyKey: 'text' },
    output: {
      ok: 'bool',
      id: 'id?',
      columnId: 'id?',
      fieldsCarried: 'int?',
      fieldsDropped: 'int?',
      typeCleared: 'bool?',
      errors: 'json?',
    },
    effects: [
      'read:flow.Issue',
      'write:flow.Issue',
      'read:flow.Column',
      'read:flow.IssueType',
      'read:flow.FieldDef',
      'read:flow.IssueFieldValue',
      'write:flow.IssueFieldValue',
      'read:flow.Tag',
      'read:flow.IssueTag',
      'write:flow.IssueTag',
      'read:flow.Sprint',
      'read:mail.Thread',
      'write:mail.Thread',
      'read:mail.Message',
      'write:mail.Message',
      'read:mail.Follower',
      'write:mail.Follower',
      'read:mail.Subtype',
      'write:mail.Notification',
      'write:mail.TrackingValue',
      'read:user.User',
      ...membershipEffects,
    ],
    idempotent: true,
    agent: true,
    handler: issueCopyToHandler,
  }),
  /**
   * Take an issue to another project — see transferIssue for what travels.
   *
   * Its own key rather than a shape of `issue.save`, which refuses to change
   * a project at all: moving work between projects touches columns, types,
   * epics, sprints and custom fields, and priced as an edit it would look like
   * renaming a title.
   */
  'issue.transfer': defineFn({
    input: {
      id: 'id',
      projectId: 'id',
      columnId: 'id?',
      expectedVersion: 'int',
      idempotencyKey: 'text',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      version: 'int?',
      columnId: 'id?',
      fieldsCarried: 'int?',
      fieldsDropped: 'int?',
      typeCleared: 'bool?',
      epicCleared: 'bool?',
      sprintCleared: 'bool?',
      errors: 'json?',
    },
    effects: [
      'read:flow.Issue',
      'write:flow.Issue',
      'read:flow.Column',
      'read:flow.IssueType',
      'read:flow.FieldDef',
      'read:flow.IssueFieldValue',
      'write:flow.IssueFieldValue',
      ...membershipEffects,
    ],
    idempotent: true,
    agent: true,
    handler: issueTransferHandler,
  }),
}
