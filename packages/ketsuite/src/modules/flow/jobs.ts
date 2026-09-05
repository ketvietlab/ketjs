// Taking a project out of existence.
//
// Archiving is the default and always was; this is the other thing, and it is
// a job rather than a request because of what it has to touch: fifteen of
// Flow's own tables, the mail threads on every issue, and the bytes behind
// every document and attachment. None of that fits in the time a person will
// hold a page open, and the bytes are only reachable from a job at all.
//
// Two properties this file is built around, both from the W7 acceptance gate:
//
//   **Nothing orphaned.** Every table that carries a project, directly or one
//   hop away, is named here. A row left behind is a row no screen will ever
//   show and no query will ever find, which is worse than not deleting at all.
//
//   **Runnable again.** A purge that dies halfway has to be able to finish, so
//   every step is a delete over an id set — the same statement whether it has
//   run before or not — and the steps go children first, so a crash leaves
//   rows that still point at something rather than rows that point at nothing.
//
// See FLW-DEC-018.

import { defineJob, deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import type { JobContext, JobSpec } from '@ketvietlab/ketjs'
import { purgeThreadEffects, purgeThreads, threadsFor } from '../mail/operations.ts'
import { purgeAttachmentEffects, purgeAttachments } from '../storage/jobs.ts'

/**
 * The tables that name a project directly, in the order they are emptied.
 *
 * Children first. `Issue` is last of the issue-shaped ones because three other
 * tables point at it, and `Project` itself is not here at all — it goes at the
 * end, after everything that could still name it is gone.
 */
const projectScoped = [
  'flow.BoardScope',
  'flow.Page',
  'flow.Epic',
  'flow.Sprint',
  'flow.Column',
  'flow.IssueType',
  'flow.FieldDef',
  'flow.ProjectMember',
] as const

/** The tables that reach a project through an issue. */
const issueScoped = ['flow.IssueFieldValue', 'flow.IssueDependency', 'flow.IssueTag'] as const

/** The records a document or an attachment can hang off. */
const attachmentOwners = ['flow.Project', 'flow.Epic', 'flow.Page', 'flow.Issue'] as const

export const flowJobs: Record<string, JobSpec> = {
  purgeProject: defineJob({
    queue: 'maintenance',
    input: { projectId: 'id', deletionId: 'id' },
    effects: [
      'read:flow.Project',
      'write:flow.Project',
      'read:flow.Issue',
      'write:flow.Issue',
      'write:flow.IssueFieldValue',
      'write:flow.IssueDependency',
      'write:flow.IssueTag',
      'read:flow.Page',
      'write:flow.Page',
      'read:flow.Epic',
      'write:flow.Epic',
      'write:flow.Sprint',
      'write:flow.Column',
      'write:flow.IssueType',
      'write:flow.FieldDef',
      'write:flow.BoardScope',
      'write:flow.ProjectMember',
      'read:flow.ProjectDeletion',
      'write:flow.ProjectDeletion',
      ...purgeThreadEffects,
      ...purgeAttachmentEffects,
    ],
    idempotent: true,
    maxAttempts: 5,
    timeoutMs: 600_000,
    handler: async (ctx: JobContext, args) => {
      const projectId = String(args.projectId)
      const removed: Record<string, number> = {}

      // The issues first, because everything else keyed to an issue is keyed
      // through this list and the list has to be read before the rows go.
      const I = ctx.table('flow.Issue')
      const issues = await ctx.db.all(from(I).select(I.id).where(eq(I.projectId, projectId)))
      const issueIds = issues.map((row) => String(row.id))

      // Documents and files, bytes included. Before the rows that name them,
      // so a crash leaves attachments to find rather than keys to nothing.
      const P = ctx.table('flow.Page')
      const E = ctx.table('flow.Epic')
      const owned: Record<string, string[]> = {
        'flow.Project': [projectId],
        'flow.Issue': issueIds,
        'flow.Page': (await ctx.db.all(from(P).select(P.id).where(eq(P.projectId, projectId)))).map((row) =>
          String(row.id),
        ),
        'flow.Epic': (await ctx.db.all(from(E).select(E.id).where(eq(E.projectId, projectId)))).map((row) =>
          String(row.id),
        ),
      }
      let attachments = 0
      for (const model of attachmentOwners)
        attachments += await purgeAttachments(ctx, model, owned[model] ?? [])
      removed.attachments = attachments

      // Conversation next. An issue's thread carries its comments, its
      // followers and everything mail keeps beside them; mail deletes those,
      // because mail is what knows the whole list.
      const threadIds = (
        await Promise.all(attachmentOwners.map((model) => threadsFor(ctx, model, owned[model] ?? [])))
      ).flat()
      removed.threads = await purgeThreads(ctx, threadIds)

      if (issueIds.length)
        for (const model of issueScoped) {
          const T = ctx.table(model)
          await ctx.db.del(deleteFrom(T).where(inArray(T.issueId, issueIds)))
        }

      // Blocking edges point both ways, so the ones aimed *into* this project
      // from an issue somewhere else have to go too — they are the rows most
      // easily left behind, and a dependency on an issue that no longer exists
      // is a board that renders an arrow into nothing.
      if (issueIds.length) {
        const D = ctx.table('flow.IssueDependency')
        await ctx.db.del(deleteFrom(D).where(inArray(D.dependsOnIssueId, issueIds)))
      }

      await ctx.db.del(deleteFrom(I).where(eq(I.projectId, projectId)))
      removed.issues = issueIds.length

      for (const model of projectScoped) {
        const T = ctx.table(model)
        await ctx.db.del(deleteFrom(T).where(eq(T.projectId, projectId)))
      }

      const PR = ctx.table('flow.Project')
      await ctx.db.del(deleteFrom(PR).where(eq(PR.id, projectId)))
      removed.projects = 1

      // The record of the request outlives everything it describes, which is
      // the whole reason it is a separate row rather than a column on the
      // project. Closed last, so a purge that died earlier is still marked
      // `requested` and can be told apart from one that finished.
      await ctx.db.update(
        'flow.ProjectDeletion',
        { id: String(args.deletionId) },
        { state: 'done', completedAt: new Date().toISOString(), removed },
      )

      // A job returns nothing, so what it did goes to the log — the counts in
      // particular, because "nothing orphaned" is a claim somebody will want to
      // check against a number rather than take on faith.
      console.log(JSON.stringify({ event: 'flow.purgeProject', projectId, removed }))
    },
  }),
}
