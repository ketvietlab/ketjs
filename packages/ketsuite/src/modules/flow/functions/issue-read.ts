import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { groupIssues, issueBuckets, issueDetail, listIssues } from '../queries/issue-list.ts'
import { canReadProject } from '../membership.ts'
import { emptyIssueListState } from '../search.ts'
import { n } from '../domain/command.ts'
import { dependenciesFor } from '../queries/issue-dependencies.ts'
import { defineFn } from '@ketvietlab/ketjs'
import { flowReadEffects, membershipEffects } from './effects.ts'

export function issueListHandler(ctx: Ctx, args: Record<string, unknown>) {
  return listIssues(ctx, args)
}

export function issueBucketsHandler(ctx: Ctx, args: Record<string, unknown>) {
  return issueBuckets(ctx, args, args.today == null ? undefined : String(args.today))
}

export function issueGroupHandler(ctx: Ctx, args: Record<string, unknown>) {
  return groupIssues(ctx, args)
}

export async function issueGetHandler(ctx: Ctx, args: Record<string, unknown>) {
  const held = await issueDetail(ctx, String(args.id))
  return held && (await canReadProject(ctx, held.projectId)) ? held : null
}

export async function issueOptionsHandler(ctx: Ctx, args: Record<string, unknown>) {
  const found = await listIssues(ctx, {
    ...(args.projectId ? { projectId: args.projectId } : {}),
    listState: args.search ? { ...emptyIssueListState(), q: String(args.search) } : undefined,
    limit: Math.max(1, Math.min(100, n(args.limit ?? 40))),
  })
  return found.rows
    .filter((row) => !args.excludeId || row.id !== args.excludeId)
    .map((row) => ({ id: row.id, title: row.title, columnName: row.columnName ?? null }))
}

export function issueDependenciesHandler(ctx: Ctx, args: Record<string, unknown>) {
  return dependenciesFor(
    ctx,
    Array.isArray(args.issueIds) ? args.issueIds.map(String) : [],
    args.includeExternalTargets === true,
  )
}

export const issueReadFunctions: Record<string, FnSpec> = {
  'issue.list': defineFn({
    input: {
      /** A day; narrows to issues due before it that are not finished. */
      overdueOn: 'text?',
      projectId: 'id?',
      columnId: 'id?',
      epicId: 'id?',
      sprintId: 'id?',
      assigneeUserId: 'id?',
      /** Assigned to whoever is asking; resolved from the actor, not the caller. */
      mine: 'bool?',
      includeArchived: 'bool?',
      cursor: 'text?',
      limit: 'int?',
      listState: 'json?',
      path: 'json?',
      timezone: 'text?',
    },
    output: { rows: 'json', total: 'int', nextCursor: 'text?', fieldFilterTruncated: 'bool?' },
    effects: [...flowReadEffects, 'read:company.Company'],
    agent: true,
    handler: issueListHandler,
  }),
  /**
   * How the issues under the same filter divide up — see `issueBuckets`.
   *
   * Four counts, not a page of rows, so the figures beside a list of a
   * thousand issues cost four queries.
   */
  'issue.buckets': defineFn({
    input: {
      projectId: 'id?',
      epicId: 'id?',
      sprintId: 'id?',
      assigneeUserId: 'id?',
      mine: 'bool?',
      includeArchived: 'bool?',
      listState: 'json',
      /** Optional: the company's own civil date when the caller names none. */
      today: 'text?',
    },
    output: {
      total: 'int',
      done: 'int',
      overdue: 'int',
      waiting: 'int',
      working: 'int',
      today: 'text',
    },
    // The same `issueQuery` `issue.list` and `issue.group` run, so the same
    // `flow.IssueFieldValue` read whenever the state carries a `field:<code>`
    // rule — see resolveFieldFilters. A capability nobody declares is one
    // nobody reviewed, and this one was missing while the other two had it.
    effects: [
      'read:flow.Issue',
      'read:flow.Column',
      'read:flow.FieldDef',
      'read:flow.IssueFieldValue',
      // Where the company keeps its calendar — see businessTimezone.
      'read:company.Company',
      ...membershipEffects,
    ],
    agent: true,
    handler: issueBucketsHandler,
  }),
  'issue.group': defineFn({
    input: {
      projectId: 'id?',
      columnId: 'id?',
      epicId: 'id?',
      sprintId: 'id?',
      assigneeUserId: 'id?',
      mine: 'bool?',
      includeArchived: 'bool?',
      listState: 'json',
      path: 'json?',
      timezone: 'text?',
      limit: 'int?',
      offset: 'int?',
    },
    effects: [...flowReadEffects, 'read:company.Company'],
    agent: true,
    handler: issueGroupHandler,
  }),
  'issue.get': defineFn({
    input: { id: 'id' },
    effects: [
      ...flowReadEffects,
      'read:flow.Project',
      'read:flow.ProjectMember',
      'read:flow.ProjectAccessGrant',
      'read:user.User',
    ],
    agent: true,
    // Not found rather than forbidden: that an issue exists in a project this
    // caller cannot see is itself the half of the answer to withhold.
    handler: issueGetHandler,
  }),
  /**
   * Issues as picker rows, for the one field that points at another issue —
   * the dependency target. `issue.list` answers a paged envelope the picker
   * cannot read, and its search only takes a `listState`, so this wraps that
   * the same way `crm.case.options` wraps `listCases`.
   */
  'issue.options': defineFn({
    input: { search: 'text?', limit: 'int?', projectId: 'id?', excludeId: 'id?' },
    output: { id: 'id', title: 'text', columnName: 'text?' },
    effects: [...flowReadEffects, 'read:company.Company'],
    agent: true,
    handler: issueOptionsHandler,
  }),
  /** Blocking edges among a node set — the map view's one batch read, see dependenciesFor. */
  'issue.dependencies': defineFn({
    input: { issueIds: 'json', includeExternalTargets: 'bool?' },
    output: { issueId: 'id', dependsOnIssueId: 'id', relation: 'text' },
    effects: ['read:flow.IssueDependency', 'read:flow.Issue', ...membershipEffects],
    agent: true,
    // The ids come from the caller, so this answered about any issue anybody
    // named — including whether an issue in a project they cannot see has
    // blockers, which is an existence answer about a hidden project. The map
    // view passes ids it just read, so filtering costs it nothing (FLW-018).
    handler: issueDependenciesHandler,
  }),
}
