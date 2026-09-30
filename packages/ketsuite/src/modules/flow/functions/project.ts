import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { matchingProjects } from '../queries/project-list.ts'
import { invalid, issue, n } from '../domain/command.ts'
import {
  addMember,
  canReadProject,
  membersOf,
  readableProject,
  removeMember,
  visibleProjects,
} from '../membership.ts'
import { command } from '../domain/command-check.ts'
import { defineFn, deleteFrom, desc, eq, from } from '@ketvietlab/ketjs'
import { projectStateOf, projectStats } from '../projects.ts'
import { randomUUID } from 'node:crypto'
import { membershipEffects } from './effects.ts'
import { saveEntity } from './entity-save.ts'

export async function projectListHandler(ctx: Ctx, args: Record<string, unknown>) {
  const rows = await matchingProjects(ctx, args)
  const offset = Math.max(0, Math.trunc(n(args.cursor ?? 0)))
  const limit = Math.max(1, Math.min(200, Math.trunc(n(args.limit ?? 80))))
  return rows.slice(offset, offset + limit)
}

export async function projectMemberListHandler(ctx: Ctx, args: Record<string, unknown>) {
  if (!(await canReadProject(ctx, args.projectId))) return []
  return membersOf(ctx, String(args.projectId))
}

export async function projectMemberAddHandler(ctx: Ctx, args: Record<string, unknown>) {
  const error = command(ctx, args.idempotencyKey)
  if (error) return error
  if (!(await canReadProject(ctx, args.projectId))) return invalid(issue('projectId', 'flow.error.notFound'))
  const user = (await ctx.db.select('user.User', { id: args.userId, active: true }))[0]
  if (!user) return invalid(issue('userId', 'flow.error.notFound'))
  await addMember(ctx, {
    projectId: String(args.projectId),
    userId: String(args.userId),
    addedByUserId: ctx.actor,
    at: new Date().toISOString(),
  })
  return { ok: true, id: `${String(args.projectId)}:${String(args.userId)}` }
}

export async function projectMemberRemoveHandler(ctx: Ctx, args: Record<string, unknown>) {
  const error = command(ctx, args.idempotencyKey)
  if (error) return error
  if (!(await canReadProject(ctx, args.projectId))) return invalid(issue('projectId', 'flow.error.notFound'))
  // Removing the last member is allowed and is not an accident to guard
  // against: a project with nobody on it is closed, which is what somebody
  // clearing out a project wants. The company-wide grant is how it is
  // reopened, and that is the point of having one.
  const removed = await removeMember(ctx, String(args.projectId), String(args.userId))
  return removed ? { ok: true } : invalid(issue('userId', 'flow.error.notFound'))
}

export function projectAccessListHandler(ctx: Ctx) {
  return ctx.db.select('flow.ProjectAccessGrant', {})
}

export async function projectAccessGrantHandler(ctx: Ctx, args: Record<string, unknown>) {
  const error = command(ctx, args.idempotencyKey)
  if (error) return error
  const user = (await ctx.db.select('user.User', { id: args.userId, active: true }))[0]
  if (!user) return invalid(issue('userId', 'flow.error.notFound'))
  await ctx.db.insertIfAbsent('flow.ProjectAccessGrant', {
    id: String(args.userId),
    userId: args.userId,
    addedAt: new Date().toISOString(),
    addedByUserId: ctx.actor,
  })
  return { ok: true, id: String(args.userId) }
}

export async function projectAccessRevokeHandler(ctx: Ctx, args: Record<string, unknown>) {
  const error = command(ctx, args.idempotencyKey)
  if (error) return error
  const held = (await ctx.db.select('flow.ProjectAccessGrant', { userId: args.userId }))[0]
  if (!held) return invalid(issue('userId', 'flow.error.notFound'))
  const G = ctx.table('flow.ProjectAccessGrant')
  await ctx.db.del(deleteFrom(G).where(eq(G.id, held.id)))
  return { ok: true }
}

export async function projectCountHandler(ctx: Ctx, args: Record<string, unknown>) {
  return { total: (await matchingProjects(ctx, args)).length }
}

export async function projectStatsHandler(ctx: Ctx, args: Record<string, unknown>) {
  const asked = Array.isArray(args.projectIds) ? args.projectIds.map(String) : []
  // A count is a reading. Asking for the totals of a project you are not on
  // would answer "how much work is in there", which is most of what the
  // project is.
  const visible = await visibleProjects(ctx)
  const ids = visible === null ? asked : asked.filter((id) => visible.includes(id))
  const stats = await projectStats(ctx, ids)
  return [...stats].map(([id, counted]) => ({
    id,
    total: counted.total,
    done: counted.done,
    state: projectStateOf(counted),
  }))
}

export async function projectGetHandler(ctx: Ctx, args: Record<string, unknown>) {
  return (await readableProject(ctx, args.id)) ?? null
}

export async function projectEditContentHandler(ctx: Ctx, args: Record<string, unknown>) {
  const row = await readableProject(ctx, args.id)
  return row ? { id: row.id, contentAttachmentId: row.contentAttachmentId ?? null } : null
}

export async function projectDeleteHandler(ctx: Ctx, args: Record<string, unknown>) {
  const error = command(ctx, args.idempotencyKey)
  if (error) return error
  // Through the membership gate like everything else: a project you cannot
  // see is a project you cannot end, and it answers the same "not found" a
  // project that was never there would.
  const project = await readableProject(ctx, args.projectId)
  if (!project) return invalid(issue('projectId', 'flow.error.notFound'))
  // Exactly the name, untrimmed of meaning: a confirmation that accepts a
  // near-match is a confirmation that will be typed without reading.
  if (String(args.confirmName ?? '').trim() !== String(project.name ?? ''))
    return invalid(issue('confirmName', 'flow.error.confirmNameMismatch'))

  const id = randomUUID()
  await ctx.db.insert('flow.ProjectDeletion', {
    id,
    projectId: String(project.id),
    // Copied, not referenced. After the purge there is nowhere left to
    // read these from, and an audit row naming an id nobody recognises
    // answers no question anybody will ask of it.
    projectKey: String(project.key ?? ''),
    projectName: String(project.name ?? ''),
    requestedAt: new Date().toISOString(),
    requestedByUserId: ctx.actor,
    reason: args.reason ? String(args.reason) : null,
    state: 'requested',
    completedAt: null,
    removed: null,
  })
  await ctx.jobs.enqueue(
    'flow.purgeProject',
    { projectId: String(project.id), deletionId: id },
    // One purge per project. Asking twice while the first is still running
    // is the same request, and running two at once over the same rows is
    // two jobs racing to delete what the other is reading.
    { uniqueKey: `flow.purgeProject:${String(project.id)}` },
  )
  return { ok: true, id }
}

export async function projectDeletionListHandler(ctx: Ctx, args: Record<string, unknown>) {
  const D = ctx.table('flow.ProjectDeletion')
  // No membership filter, and it cannot have one: the projects these rows
  // name do not exist any more, so there is nothing left to be a member of.
  // That is why reading this list is its own authority rather than `view`.
  return ctx.db.all(
    from(D)
      .orderBy(desc(D.requestedAt), desc(D.id))
      .limit(Math.max(1, Math.min(200, n(args.limit ?? 50)))),
  )
}

export const projectFunctions: Record<string, FnSpec> = {
  'project.list': defineFn({
    input: {
      search: 'text?',
      limit: 'int?',
      includeArchived: 'bool?',
      archivedOnly: 'bool?',
      /** Where in the ordered list this page starts — see project.count. */
      cursor: 'int?',
      /** Only projects the caller has an issue in — see the note on projectsWithMyWork. */
      mine: 'bool?',
    },
    output: { id: 'id', key: 'text', name: 'text', description: 'text?', active: 'bool' },
    effects: [
      'read:flow.Project',
      'read:flow.Issue',
      'read:flow.ProjectMember',
      'read:flow.ProjectAccessGrant',
      'read:user.User',
    ],
    agent: true,
    handler: projectListHandler,
  }),
  /**
   * Who is on a project.
   *
   * Reading the membership of a project is reading the project, so it is gated
   * the same way: somebody who cannot see the project cannot see who is on it,
   * and finds out nothing by asking.
   */
  'project.member.list': defineFn({
    input: { projectId: 'id' },
    output: { id: 'id', projectId: 'id', userId: 'id', userName: 'text', addedAt: 'datetime' },
    effects: [...membershipEffects],
    agent: true,
    handler: projectMemberListHandler,
  }),
  /**
   * Put somebody on a project, or take them off.
   *
   * Configuration rather than everyday work: adding a person decides what they
   * may read, which is a different act from moving their cards around. The
   * caller has to be able to see the project first — you cannot staff a project
   * you are not on unless you hold the company-wide grant.
   */
  'project.member.add': defineFn({
    input: { projectId: 'id', userId: 'id', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [...membershipEffects, 'write:flow.ProjectMember'],
    idempotent: true,
    agent: true,
    handler: projectMemberAddHandler,
  }),
  'project.member.remove': defineFn({
    input: { projectId: 'id', userId: 'id', idempotencyKey: 'text' },
    output: { ok: 'bool', errors: 'json?' },
    effects: [...membershipEffects, 'write:flow.ProjectMember'],
    idempotent: true,
    agent: true,
    handler: projectMemberRemoveHandler,
  }),
  /**
   * Who reads every project in the company, and the two commands that decide it.
   *
   * The widest reach Flow grants, so it is `security` risk with an authority of
   * its own: this is the row that makes somebody able to read a project nobody
   * added them to. It exists so membership can be administered at all, and so a
   * project whose members have left is not unreachable.
   */
  'project.access.list': defineFn({
    input: {},
    output: { id: 'id', userId: 'id', addedAt: 'datetime' },
    effects: ['read:flow.ProjectAccessGrant'],
    agent: true,
    handler: projectAccessListHandler,
  }),
  'project.access.grant': defineFn({
    input: { userId: 'id', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.ProjectAccessGrant', 'write:flow.ProjectAccessGrant', 'read:user.User'],
    idempotent: true,
    agent: true,
    handler: projectAccessGrantHandler,
  }),
  'project.access.revoke': defineFn({
    input: { userId: 'id', idempotencyKey: 'text' },
    output: { ok: 'bool', errors: 'json?' },
    effects: ['read:flow.ProjectAccessGrant', 'write:flow.ProjectAccessGrant'],
    idempotent: true,
    agent: true,
    handler: projectAccessRevokeHandler,
  }),
  /**
   * How many projects there are to page through.
   *
   * The list screen used to show the length of the page it had — capped at two
   * hundred — as though it were the total, so a company with more projects was
   * told a number that was simply wrong, and the rest were unreachable. This
   * answers the real figure, through the same membership filter the list uses
   * (FLW-039).
   */
  'project.count': defineFn({
    input: { search: 'text?', includeArchived: 'bool?', archivedOnly: 'bool?', mine: 'bool?' },
    output: { total: 'int' },
    effects: [
      'read:flow.Project',
      'read:flow.Issue',
      'read:flow.ProjectMember',
      'read:flow.ProjectAccessGrant',
      'read:user.User',
    ],
    agent: true,
    handler: projectCountHandler,
  }),
  /**
   * The issue counts behind a list of projects, in two reads rather than one
   * per project — see `projectStats`.
   */
  'project.stats': defineFn({
    input: { projectIds: 'json' },
    output: { id: 'id', total: 'int', done: 'int', state: 'text' },
    effects: [
      'read:flow.Issue',
      'read:flow.Column',
      'read:flow.Project',
      'read:flow.ProjectMember',
      'read:flow.ProjectAccessGrant',
      'read:user.User',
    ],
    agent: true,
    handler: projectStatsHandler,
  }),
  /**
   * One project by id, the way `issue.get` answers one issue.
   *
   * Every project-scoped screen needs the project behind the id in its URL.
   * Resolving that through `project.list` means listing and filtering, and
   * `optionRows` caps at 200 rows sorted by name — so the 201st project by
   * name would answer "not found" on its own board.
   */
  'project.get': defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      key: 'text',
      name: 'text',
      description: 'text?',
      previewText: 'text?',
      contentAttachmentId: 'id?',
      active: 'bool',
    },
    effects: [
      'read:flow.Project',
      'read:flow.ProjectMember',
      'read:flow.ProjectAccessGrant',
      'read:user.User',
    ],
    agent: true,
    // Nothing rather than a refusal: that a project exists is itself the half of
    // the answer a hidden project must not give away — see readableProject.
    handler: projectGetHandler,
  }),
  /**
   * Rewriting a project's brief, as a permission key of its own — separate
   * from `project.save`, which renames the project and archives it.
   */
  'project.editContent': defineFn({
    input: { id: 'id' },
    // The fields as they are actually returned, not a `value` wrapper the
    // handler never builds: output is projected against these keys, so
    // declaring `value` and answering `{ id, contentAttachmentId }` threw both
    // away and handed the caller `{}`. Live Doc reads `contentAttachmentId`
    // off this to find the stored snapshot, so an empty answer read as "never
    // written" — and the next push started from a blank document and flattened
    // it over the real one.
    output: { id: 'id?', contentAttachmentId: 'id?' },
    effects: ['read:flow.Project', ...membershipEffects],
    agent: true,
    handler: projectEditContentHandler,
  }),
  /**
   * Destroy a project and everything in it.
   *
   * Archiving is the default and stays the default — this is the other thing,
   * for when somebody has asked for the data to be gone rather than hidden
   * (FLW-DEC-018). It is not `flow.configure`: configuring a project and
   * ending one are not the same act, and a role that does the first every week
   * should not be able to do the second by accident.
   *
   * Three things happen here and the order is the point. The name typed by the
   * caller has to match the project's own, so that destroying the wrong
   * project takes more than a mis-click on a list. The record of the request
   * is written **before** anything else, because a record that appears only on
   * success misses the case worth auditing. Only then is the work queued —
   * fifteen tables, every thread, and the bytes behind every document do not
   * fit in a request, and the blob store is reachable only from a job.
   */
  'project.delete': defineFn({
    input: { projectId: 'id', confirmName: 'text', reason: 'text?', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      ...membershipEffects,
      'read:flow.ProjectDeletion',
      'write:flow.ProjectDeletion',
      'enqueue:flow.purgeProject',
    ],
    idempotent: true,
    agent: true,
    handler: projectDeleteHandler,
  }),
  /** What was asked to be deleted, and what became of it. */
  'project.deletion.list': defineFn({
    input: { limit: 'int?' },
    output: {
      id: 'id',
      projectId: 'id',
      projectKey: 'text',
      projectName: 'text',
      requestedAt: 'datetime',
      requestedByUserId: 'id?',
      reason: 'text?',
      state: 'text',
      completedAt: 'datetime?',
    },
    effects: ['read:flow.ProjectDeletion'],
    agent: true,
    handler: projectDeletionListHandler,
  }),
  'project.save': saveEntity(
    'flow.Project',
    ['id', 'key', 'name', 'description', 'active'],
    ['key', 'name'],
    (args, existing) => ({ active: existing?.active ?? true, ...args }),
  ),
}
