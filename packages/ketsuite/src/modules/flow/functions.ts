import { randomUUID } from 'node:crypto'
import { deleteFrom, defineFn, desc, eq, from, inArray } from '@ketvietlab/ketjs'
import { FIELD_KINDS } from './types.ts'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import {
  actorRequired,
  addComment,
  epicTotals,
  sprintTotals,
  archiveIssue,
  restoreIssue,
  startFollowing,
  stopFollowing,
  addDependency,
  assignSprint,
  closeSprint,
  deleteSprint,
  commandKey,
  dependenciesFor,
  groupIssues,
  issueBuckets,
  issue,
  invalid,
  issueDetail,
  listIssues,
  moveIssue,
  n,
  normalized,
  saveIssue,
  startSprint,
} from './operations.ts'
import { emptyIssueListState } from './search.ts'
import {
  addMember,
  canReadProject,
  membersOf,
  readableProject,
  readableRow,
  removeMember,
  visibleProjects,
  visibleRows,
} from './membership.ts'
import { projectsWithMyWork, projectStateOf, projectStats } from './projects.ts'
import {
  archivePage,
  listAllPages,
  listPages,
  movePage,
  pageDetail,
  reorderPage,
  restorePage,
  savePage,
} from './pages.ts'

/**
 * What passing the membership gate costs in effects.
 *
 * Spread into every command that touches a project's data. Named because it is
 * not a capability one function happens to need — it is the condition all of
 * them read under, and a list copied at thirty call sites is a list that will
 * disagree with itself.
 */
const membershipEffects = [
  'read:flow.Project',
  'read:flow.ProjectMember',
  'read:flow.ProjectAccessGrant',
  'read:user.User',
] as const

const flowReadEffects = [
  'read:flow.Project',
  // The membership gate every Flow read now passes through — see membership.ts.
  // Named here rather than at each call site because it is not a capability one
  // function happens to need; it is the condition all of them read under.
  'read:flow.ProjectMember',
  'read:flow.ProjectAccessGrant',
  'read:flow.Column',
  'read:flow.IssueType',
  'read:flow.FieldDef',
  'read:mail.Follower',
  'read:flow.IssueFieldValue',
  'read:flow.Epic',
  'read:flow.Sprint',
  'read:flow.Issue',
  'read:flow.IssueDependency',
  'read:flow.Tag',
  'read:flow.IssueTag',
  'read:user.User',
  'read:mail.Thread',
  'read:mail.Message',
] as const

/**
 * What writing one system entry to an issue's thread costs in effects.
 *
 * `postMessage` resolves the author, addresses the followers and writes the
 * notification, so a command that leaves a timeline entry touches the same mail
 * tables a comment does. Named here because three commands now do it.
 */
const timelineEntryEffects = [
  'read:mail.Thread',
  'read:mail.Follower',
  'write:mail.Follower',
  'read:mail.FollowerSubtype',
  'write:mail.FollowerSubtype',
  'read:mail.Subtype',
  'write:mail.Message',
  'write:mail.TrackingValue',
  'write:mail.Notification',
  'read:user.User',
  'read:partner.Partner',
] as const

const issueWriteEffects = [
  ...flowReadEffects,
  'write:flow.Issue',
  'write:flow.IssueTag',
  'write:flow.IssueFieldValue',
  'write:mail.Thread',
  // Saving an issue now subscribes its author and its assignee to the thread,
  // and writes a system entry when it changes hands — so it touches the same
  // mail tables a comment does.
  'read:mail.Follower',
  'write:mail.Follower',
  'read:mail.FollowerSubtype',
  'write:mail.FollowerSubtype',
  'read:mail.Subtype',
  'write:mail.Message',
  'write:mail.Mention',
  'write:mail.MessageAttachment',
  'write:mail.TrackingValue',
  'write:mail.Notification',
  'read:partner.Partner',
] as const

const commentEffects = [
  'read:flow.Issue',
  'read:mail.Thread',
  'write:mail.Thread',
  'read:mail.Message',
  'write:mail.Message',
  'read:mail.Follower',
  'read:mail.FollowerSubtype',
  'read:mail.Subtype',
  'write:mail.Mention',
  'write:mail.MessageAttachment',
  'write:mail.TrackingValue',
  'write:mail.Notification',
  'write:mail.Follower',
  'write:mail.FollowerSubtype',
  'read:user.User',
  'read:partner.Partner',
] as const

const command = (ctx: Ctx, key: unknown) => {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(key)) return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  return null
}

/** Small pickers read this shape: active first, filtered by name, capped to a page. */
const optionRows = async (
  ctx: Ctx,
  model: string,
  args: Record<string, unknown>,
  order?: (a: Row, b: Row) => number,
): Promise<Row[]> => {
  const rows = await ctx.db.select(model, args.includeArchived === true ? {} : { active: true })
  const needle = normalized(args.search)
  return rows
    .filter(
      (row) => !needle || normalized(row.name).includes(needle) || normalized(row.code).includes(needle),
    )
    .sort(
      (a, b) =>
        (order ? order(a, b) : 0) ||
        String(a.name ?? '').localeCompare(String(b.name ?? '')) ||
        String(a.id).localeCompare(String(b.id)),
    )
    .slice(
      Math.max(0, n(args.cursor ?? 0)),
      Math.max(0, n(args.cursor ?? 0)) + Math.max(1, Math.min(200, n(args.limit ?? 80))),
    )
}

/**
 * How many rows `optionRows` would have to choose from, before the page.
 *
 * The same read and the same filter, stopping short of the slice. Separate
 * rather than folded into `optionRows` because every caller of that wants an
 * array and only the list screens want a figure — and a screen that shows the
 * length of its own page as the total is a screen that lies the moment there
 * is a second page (FLW-039).
 */
const optionCount = async (
  ctx: Ctx,
  model: string,
  args: Record<string, unknown>,
  keep: (row: Row) => boolean = () => true,
): Promise<number> => {
  const rows = await ctx.db.select(model, args.includeArchived === true ? {} : { active: true })
  const needle = normalized(args.search)
  return rows.filter(
    (row) =>
      keep(row) &&
      (!needle || normalized(row.name).includes(needle) || normalized(row.code).includes(needle)),
  ).length
}

/** Plain upsert for the entities with no CAS field — no concurrent editor to race against. */
const saveEntity = (
  model: string,
  fields: string[],
  required: string[],
  defaults: (values: Row, existing: Row | undefined) => Row,
) =>
  defineFn({
    input: { values: 'json', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      `read:${model}`,
      `write:${model}`,
      'read:flow.Project',
      'write:flow.ProjectMember',
      'read:flow.ProjectMember',
      'read:flow.ProjectAccessGrant',
      'read:user.User',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      if (!args.values || typeof args.values !== 'object')
        return invalid(issue('values', 'flow.error.required'))
      const values = args.values as Record<string, unknown>
      const id = String(values.id ?? '')
      if (!id) return invalid(issue('id', 'flow.error.required'))
      // Two shapes, one rule. A project's own row is named by its id; everything
      // else this builds — columns, issue types, epics — names its project in a
      // column. Either way, writing into a project a caller cannot see is the
      // thing this refuses, and it refuses it as "not found".
      const target = model === 'flow.Project' ? id : String(values.projectId ?? '')
      const existing = (await ctx.db.select(model, { id }))[0]
      const known = model === 'flow.Project' ? Boolean(existing) : true
      if (known && target && !(await canReadProject(ctx, target)))
        return invalid(issue('id', 'flow.error.notFound'))
      const cs = ctx
        .change(model, { ...defaults(values, existing), ...values }, existing ?? null)
        .cast(fields)
      const withRequired = required.length ? cs.required(required) : cs
      if (!withRequired.valid) return { ok: false, errors: withRequired.errors }
      await ctx.db.commit(withRequired, existing ? { id } : undefined)
      // A project nobody can see is not a project anybody asked for, and there
      // is no other door: membership is what makes it visible, so the person
      // who created it has to walk through first.
      if (model === 'flow.Project' && !existing && ctx.actor)
        await addMember(ctx, {
          projectId: id,
          userId: ctx.actor,
          addedByUserId: ctx.actor,
          at: new Date().toISOString(),
        })
      return { ok: true, id }
    },
  })

export const functions: Record<string, FnSpec> = {
  'project.list': defineFn({
    input: {
      search: 'text?',
      limit: 'int?',
      includeArchived: 'bool?',
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
    handler: async (ctx, args) => {
      // Membership first, then the caller's own `mine` filter. They answer
      // different questions — "which projects exist for me" and "which of those
      // am I carrying work in" — and only the first one is a rule.
      const visible = await visibleProjects(ctx)
      const rows = (await optionRows(ctx, 'flow.Project', args)).filter(
        (row) => visible === null || visible.includes(String(row.id)),
      )
      if (args.mine !== true) return rows
      const mine = await projectsWithMyWork(ctx)
      return rows.filter((row) => mine.has(String(row.id)))
    },
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
    handler: async (ctx, args) => {
      if (!(await canReadProject(ctx, args.projectId))) return []
      return membersOf(ctx, String(args.projectId))
    },
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
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      if (!(await canReadProject(ctx, args.projectId)))
        return invalid(issue('projectId', 'flow.error.notFound'))
      const user = (await ctx.db.select('user.User', { id: args.userId, active: true }))[0]
      if (!user) return invalid(issue('userId', 'flow.error.notFound'))
      await addMember(ctx, {
        projectId: String(args.projectId),
        userId: String(args.userId),
        addedByUserId: ctx.actor,
        at: new Date().toISOString(),
      })
      return { ok: true, id: `${String(args.projectId)}:${String(args.userId)}` }
    },
  }),

  'project.member.remove': defineFn({
    input: { projectId: 'id', userId: 'id', idempotencyKey: 'text' },
    output: { ok: 'bool', errors: 'json?' },
    effects: [...membershipEffects, 'write:flow.ProjectMember'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      if (!(await canReadProject(ctx, args.projectId)))
        return invalid(issue('projectId', 'flow.error.notFound'))
      // Removing the last member is allowed and is not an accident to guard
      // against: a project with nobody on it is closed, which is what somebody
      // clearing out a project wants. The company-wide grant is how it is
      // reopened, and that is the point of having one.
      const removed = await removeMember(ctx, String(args.projectId), String(args.userId))
      return removed ? { ok: true } : invalid(issue('userId', 'flow.error.notFound'))
    },
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
    handler: (ctx) => ctx.db.select('flow.ProjectAccessGrant', {}),
  }),

  'project.access.grant': defineFn({
    input: { userId: 'id', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.ProjectAccessGrant', 'write:flow.ProjectAccessGrant', 'read:user.User'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
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
    },
  }),

  'project.access.revoke': defineFn({
    input: { userId: 'id', idempotencyKey: 'text' },
    output: { ok: 'bool', errors: 'json?' },
    effects: ['read:flow.ProjectAccessGrant', 'write:flow.ProjectAccessGrant'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      const held = (await ctx.db.select('flow.ProjectAccessGrant', { userId: args.userId }))[0]
      if (!held) return invalid(issue('userId', 'flow.error.notFound'))
      const G = ctx.table('flow.ProjectAccessGrant')
      await ctx.db.del(deleteFrom(G).where(eq(G.id, held.id)))
      return { ok: true }
    },
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
    input: { search: 'text?', includeArchived: 'bool?', mine: 'bool?' },
    output: { total: 'int' },
    effects: [
      'read:flow.Project',
      'read:flow.Issue',
      'read:flow.ProjectMember',
      'read:flow.ProjectAccessGrant',
      'read:user.User',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const visible = await visibleProjects(ctx)
      if (visible !== null && !visible.length) return { total: 0 }
      // Counted over the rows themselves rather than with a SQL count, because
      // `optionRows` matches a normalised name in JS: a count in the database
      // would answer a different, larger question for exactly the searches
      // people type. Reading every project is what the list already does.
      const rows = await optionCount(
        ctx,
        'flow.Project',
        args,
        (row) => visible === null || visible.includes(String(row.id)),
      )
      if (args.mine !== true) return { total: rows }
      const mine = await projectsWithMyWork(ctx)
      return {
        total: await optionCount(
          ctx,
          'flow.Project',
          args,
          (row) => (visible === null || visible.includes(String(row.id))) && mine.has(String(row.id)),
        ),
      }
    },
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
    handler: async (ctx, args) => {
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
    },
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
    handler: async (ctx, args) => (await readableProject(ctx, args.id)) ?? null,
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
    handler: async (ctx, args) => {
      const row = await readableProject(ctx, args.id)
      return row ? { id: row.id, contentAttachmentId: row.contentAttachmentId ?? null } : null
    },
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
    handler: async (ctx, args) => {
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
    },
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
    handler: async (ctx, args) => {
      const D = ctx.table('flow.ProjectDeletion')
      // No membership filter, and it cannot have one: the projects these rows
      // name do not exist any more, so there is nothing left to be a member of.
      // That is why reading this list is its own authority rather than `view`.
      return ctx.db.all(
        from(D)
          .orderBy(desc(D.requestedAt), desc(D.id))
          .limit(Math.max(1, Math.min(200, n(args.limit ?? 50)))),
      )
    },
  }),

  'project.save': saveEntity(
    'flow.Project',
    ['id', 'key', 'name', 'description', 'active'],
    ['key', 'name'],
    (args, existing) => ({ active: existing?.active ?? true, ...args }),
  ),

  'column.list': defineFn({
    input: { projectId: 'id', includeArchived: 'bool?' },
    output: {
      id: 'id',
      projectId: 'id',
      code: 'text',
      name: 'text',
      sequence: 'int',
      terminalState: 'bool',
      active: 'bool',
    },
    effects: [
      'read:flow.Column',
      'read:flow.Project',
      'read:flow.ProjectMember',
      'read:flow.ProjectAccessGrant',
      'read:user.User',
      ...membershipEffects,
    ],
    agent: true,
    handler: async (ctx, args) => {
      // A project's configuration is the project. Answering with its columns
      // for somebody who cannot see the project describes it to them.
      if (!(await canReadProject(ctx, args.projectId))) return []
      const rows = await ctx.db.select(
        'flow.Column',
        args.includeArchived === true
          ? { projectId: args.projectId }
          : { projectId: args.projectId, active: true },
      )
      return rows.sort((a, b) => n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id)))
    },
  }),

  'column.save': saveEntity(
    'flow.Column',
    ['id', 'projectId', 'code', 'name', 'sequence', 'terminalState', 'active'],
    ['projectId', 'code', 'name'],
    (args, existing) => ({
      sequence: existing?.sequence ?? 10,
      terminalState: existing?.terminalState ?? false,
      active: existing?.active ?? true,
      ...args,
    }),
  ),

  'column.archive': defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.Column', 'write:flow.Column', 'read:flow.Issue', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = await readableRow(ctx, 'flow.Column', args.id)
      if (!existing) return invalid(issue('id', 'flow.error.notFound'))
      const held = await ctx.db.select('flow.Issue', { columnId: args.id, active: true })
      if (held.length) return invalid(issue('id', 'flow.error.columnHasIssues'))
      await ctx.db.update('flow.Column', { id: args.id }, { active: false })
      return { ok: true, id: args.id }
    },
  }),

  'issueType.list': defineFn({
    input: { projectId: 'id', includeArchived: 'bool?' },
    output: {
      id: 'id',
      projectId: 'id',
      code: 'text',
      name: 'text',
      color: 'text?',
      sequence: 'int',
      active: 'bool',
    },
    effects: [
      'read:flow.IssueType',
      'read:flow.Project',
      'read:flow.ProjectMember',
      'read:flow.ProjectAccessGrant',
      'read:user.User',
      ...membershipEffects,
    ],
    agent: true,
    handler: async (ctx, args) => {
      if (!(await canReadProject(ctx, args.projectId))) return []
      const rows = await ctx.db.select(
        'flow.IssueType',
        args.includeArchived === true
          ? { projectId: args.projectId }
          : { projectId: args.projectId, active: true },
      )
      return rows.sort((a, b) => n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id)))
    },
  }),

  'issueType.save': saveEntity(
    'flow.IssueType',
    ['id', 'projectId', 'code', 'name', 'color', 'sequence', 'active'],
    ['projectId', 'code', 'name'],
    (args, existing) => ({
      sequence: existing?.sequence ?? 10,
      active: existing?.active ?? true,
      ...args,
    }),
  ),

  /**
   * Archiving a type in use would leave those issues pointing at a row no
   * screen lists any more, so they would read as untyped while still carrying
   * it — the same refusal `column.archive` makes, for the same reason.
   */
  'issueType.archive': defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.IssueType', 'write:flow.IssueType', 'read:flow.Issue', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = await readableRow(ctx, 'flow.IssueType', args.id)
      if (!existing) return invalid(issue('id', 'flow.error.notFound'))
      const held = await ctx.db.select('flow.Issue', { typeId: args.id, active: true })
      if (held.length) return invalid(issue('id', 'flow.error.typeHasIssues'))
      await ctx.db.update('flow.IssueType', { id: args.id }, { active: false })
      return { ok: true, id: args.id }
    },
  }),

  /**
   * The project this reader's board last showed, if any.
   *
   * Answers null rather than guessing a project: the board asks them to pick
   * once, and a wrong guess would show one team's work to somebody who wanted
   * another's.
   */
  'board.scope': defineFn({
    input: {},
    output: { projectId: 'id?' },
    effects: ['read:flow.BoardScope', ...membershipEffects],
    agent: true,
    handler: async (ctx) => {
      if (!ctx.actor) return { projectId: null }
      const held = (await ctx.db.select('flow.BoardScope', { userId: ctx.actor }))[0]
      if (!held) return { projectId: null }
      // Where they were last is not where they may still go: somebody taken off
      // a project keeps the row that remembers it, and answering with it would
      // send the screen to a board that is no longer theirs — and would name a
      // project they can no longer be told exists.
      return (await canReadProject(ctx, held.projectId)) ? { projectId: held.projectId } : { projectId: null }
    },
  }),

  'board.remember': defineFn({
    input: { projectId: 'id' },
    output: { ok: 'bool', errors: 'json?' },
    effects: ['read:flow.BoardScope', 'write:flow.BoardScope', 'read:flow.Project', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!ctx.actor) return invalid(issue('actor', 'flow.error.actorRequired'))
      const project = await readableProject(ctx, args.projectId)
      if (!project || project.active !== true) return invalid(issue('projectId', 'flow.error.notFound'))
      // One row per reader **per company**. The id used to be the user id
      // alone, which read as "one row per reader" and was not: the primary key
      // is not company-scoped, so somebody who works in two companies got one
      // row in whichever they opened first, and every later company answered
      // `ok: true` and remembered nothing. Silent, and only visible as a board
      // that would not stay where you left it (FLW-023).
      const id = `${String(ctx.scope.company)}:${String(ctx.actor)}`
      const row = { id, userId: ctx.actor, projectId: args.projectId, updatedAt: new Date().toISOString() }
      await ctx.db.insertIfAbsent('flow.BoardScope', row)
      await ctx.db.update('flow.BoardScope', { id }, row)
      return { ok: true }
    },
  }),

  'field.list': defineFn({
    input: { projectId: 'id', includeArchived: 'bool?' },
    output: {
      id: 'id',
      projectId: 'id',
      code: 'text',
      name: 'text',
      kind: 'text',
      config: 'json?',
      sequence: 'int',
      active: 'bool',
    },
    effects: [
      'read:flow.FieldDef',
      'read:flow.Project',
      'read:flow.ProjectMember',
      'read:flow.ProjectAccessGrant',
      'read:user.User',
      ...membershipEffects,
    ],
    agent: true,
    handler: async (ctx, args) => {
      if (!(await canReadProject(ctx, args.projectId))) return []
      const rows = await ctx.db.select(
        'flow.FieldDef',
        args.includeArchived === true
          ? { projectId: args.projectId }
          : { projectId: args.projectId, active: true },
      )
      return rows.sort((a, b) => n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id)))
    },
  }),

  /**
   * `kind` is checked here rather than left to the changeset: it is what
   * `saveIssue` branches on to decide whether a value is well-formed, so a
   * kind nothing knows how to check would be a field that accepts anything.
   */
  'field.save': defineFn({
    input: {
      id: 'id',
      projectId: 'id',
      code: 'text',
      name: 'text',
      kind: 'text',
      config: 'json?',
      sequence: 'int?',
      idempotencyKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.FieldDef', 'write:flow.FieldDef', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      const kind = String(args.kind)
      if (!FIELD_KINDS.includes(kind as (typeof FIELD_KINDS)[number]))
        return invalid(issue('kind', 'flow.error.fieldKind'))
      // A select with no options is a control nobody can answer.
      const options = (args.config as { options?: unknown[] } | null)?.options
      if (kind === 'select' && (!Array.isArray(options) || options.length === 0))
        return invalid(issue('config', 'flow.error.fieldOptionsRequired'))
      const id = String(args.id)
      const existing = (await ctx.db.select('flow.FieldDef', { id }))[0]
      const row = {
        id,
        projectId: args.projectId,
        code: String(args.code),
        name: String(args.name),
        kind,
        config: args.config ?? null,
        sequence: args.sequence == null ? (existing?.sequence ?? 10) : Number(args.sequence),
        active: existing?.active ?? true,
      }
      if (existing) await ctx.db.update('flow.FieldDef', { id }, row)
      else {
        const inserted = await ctx.db.insertIfAbsent('flow.FieldDef', row)
        if (!('inserted' in inserted) || !inserted.inserted)
          return invalid(issue('code', 'flow.error.fieldCodeUnique'))
      }
      return { ok: true, id }
    },
  }),

  /**
   * Archiving a field keeps the values already recorded against it.
   *
   * Unlike a column or a type, nothing points *at* a field from a row anyone
   * reads — the values point the other way. So the answers stay, unlisted, and
   * come back if the field is ever restored. Deleting them would be the one
   * irreversible thing on this screen.
   */
  'field.archive': defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.FieldDef', 'write:flow.FieldDef', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('flow.FieldDef', { id: args.id }))[0]
      if (!existing) return invalid(issue('id', 'flow.error.notFound'))
      await ctx.db.update('flow.FieldDef', { id: args.id }, { active: false })
      return { ok: true, id: args.id }
    },
  }),

  'epic.list': defineFn({
    input: { projectId: 'id', id: 'id?', search: 'text?', limit: 'int?', includeArchived: 'bool?' },
    output: {
      id: 'id',
      projectId: 'id',
      title: 'text',
      color: 'text?',
      previewText: 'text?',
      contentAttachmentId: 'id?',
      active: 'bool',
      total: 'int',
      done: 'int',
      estimate: 'decimal',
      estimateDone: 'decimal',
    },
    effects: ['read:flow.Epic', 'read:flow.Issue', 'read:flow.Column', ...membershipEffects],
    agent: true,
    handler: async (ctx, args) => {
      if (!(await canReadProject(ctx, args.projectId))) return []
      const where: Row = { projectId: args.projectId }
      if (args.id) where.id = args.id
      if (args.includeArchived !== true) where.active = true
      const [rows, totals] = await Promise.all([
        ctx.db.select('flow.Epic', where),
        epicTotals(ctx, String(args.projectId)),
      ])
      const needle = normalized(args.search)
      const filtered = rows
        .filter((row) => !needle || normalized(row.title).includes(needle))
        .map((row) => ({
          ...row,
          ...(totals.get(String(row.id)) ?? { total: 0, done: 0, estimate: 0, estimateDone: 0 }),
        }))
      return args.id ? filtered : filtered.slice(0, Math.max(1, Math.min(200, n(args.limit ?? 80))))
    },
  }),

  /**
   * The menu-level epic collection, paged after one company-scoped read.
   *
   * `epic.list` remains project-scoped for relation controls and project
   * screens. Folding those calls together in the backend inherited both its
   * 80-row default and `project.list`'s 200-row cap, so an "all" screen could
   * silently omit valid records.
   */
  'epic.listAll': defineFn({
    input: { search: 'text?', cursor: 'int?', limit: 'int?' },
    output: { rows: 'json', total: 'int' },
    effects: [
      'read:flow.Epic',
      'read:flow.Project',
      'read:flow.ProjectMember',
      'read:flow.ProjectAccessGrant',
      'read:user.User',
    ],
    agent: true,
    handler: async (ctx, args) => {
      // Every project's epics means every project this caller may see. The
      // screen behind it is the cross-project one, so nothing else narrows it.
      const [epics, projects] = await Promise.all([
        visibleRows(ctx, 'flow.Epic', { active: true }),
        ctx.db.select('flow.Project', { active: true }),
      ])
      const named = new Map(projects.map((project) => [String(project.id), String(project.name ?? '')]))
      const needle = normalized(args.search)
      const rows = epics
        .filter(
          (epic) => named.has(String(epic.projectId)) && (!needle || normalized(epic.title).includes(needle)),
        )
        .map((epic): Row & { projectName: string } => ({
          ...(epic as Row),
          projectName: named.get(String(epic.projectId)) ?? '',
        }))
        .sort(
          (a, b) =>
            String(a.projectName).localeCompare(String(b.projectName)) ||
            String(a.title ?? '').localeCompare(String(b.title ?? '')) ||
            String(a.id).localeCompare(String(b.id)),
        )
      const cursor = Math.max(0, n(args.cursor ?? 0))
      const limit = Math.max(1, Math.min(200, n(args.limit ?? 50)))
      return { rows: rows.slice(cursor, cursor + limit), total: rows.length }
    },
  }),

  /**
   * One epic by id — what Live Doc reads to find its stored document, and what
   * the epic's own screen is built from.
   */
  'epic.get': defineFn({
    input: { id: 'id' },
    output: { value: 'json?' },
    effects: [
      'read:flow.Epic',
      'read:flow.Project',
      'read:flow.ProjectMember',
      'read:flow.ProjectAccessGrant',
      'read:user.User',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const held = (await ctx.db.select('flow.Epic', { id: args.id }))[0] ?? null
      return { value: held && (await canReadProject(ctx, held.projectId)) ? held : null }
    },
  }),

  /**
   * Rewriting an epic's document, as a permission key of its own — the same
   * split `page.editContent` makes, and for the same reason.
   */
  'epic.editContent': defineFn({
    input: { id: 'id' },
    // The fields as they are actually returned, not a `value` wrapper the
    // handler never builds: output is projected against these keys, so
    // declaring `value` and answering `{ id, contentAttachmentId }` threw both
    // away and handed the caller `{}`. Live Doc reads `contentAttachmentId`
    // off this to find the stored snapshot, so an empty answer read as "never
    // written" — and the next push started from a blank document and flattened
    // it over the real one.
    output: { id: 'id?', contentAttachmentId: 'id?' },
    effects: ['read:flow.Epic', ...membershipEffects],
    agent: true,
    handler: async (ctx, args) => {
      const row = await readableRow(ctx, 'flow.Epic', args.id)
      return row ? { id: row.id, contentAttachmentId: row.contentAttachmentId ?? null } : null
    },
  }),

  'epic.save': saveEntity(
    'flow.Epic',
    ['id', 'projectId', 'title', 'color', 'active'],
    ['projectId', 'title'],
    (args, existing) => ({ active: existing?.active ?? true, ...args }),
  ),

  'epic.archive': defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.Epic', 'write:flow.Epic', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = await readableRow(ctx, 'flow.Epic', args.id)
      if (!existing) return invalid(issue('id', 'flow.error.notFound'))
      await ctx.db.update('flow.Epic', { id: args.id }, { active: false })
      return { ok: true, id: args.id }
    },
  }),

  /**
   * Every page in a project, flat — the screen assembles the tree.
   *
   * See listPages for why the whole project comes back at once rather than a
   * level per request.
   */
  'page.list': defineFn({
    input: { projectId: 'id?', search: 'text?', includeArchived: 'bool?', limit: 'int?' },
    output: {
      id: 'id',
      projectId: 'id',
      parentPageId: 'id?',
      title: 'text',
      previewText: 'text?',
      contentAttachmentId: 'id?',
      contentUpdatedAt: 'datetime?',
      sequence: 'int',
      active: 'bool',
      version: 'int',
      updatedAt: 'datetime',
      childCount: 'int',
    },
    effects: [
      'read:flow.Page',
      'read:flow.Project',
      'read:flow.ProjectMember',
      'read:flow.ProjectAccessGrant',
      'read:user.User',
      ...membershipEffects,
    ],
    agent: true,
    handler: async (ctx, args) => {
      // Without a project this is the cross-project search, which listPages
      // filters itself; with one it is that project's tree.
      if (args.projectId != null && !(await canReadProject(ctx, args.projectId))) return []
      return listPages(ctx, {
        projectId: args.projectId == null ? null : String(args.projectId),
        search: args.search == null ? null : String(args.search),
        includeArchived: args.includeArchived === true,
        limit: args.limit == null ? undefined : n(args.limit),
      })
    },
  }),

  /**
   * Every project's pages, paged and counted — see listAllPages.
   *
   * `page.list` answers "this project's tree" and stays that. This answers
   * "every document there is", a different question needing a different shape:
   * a total the pager can trust, and the project name beside each row.
   */
  'page.listAll': defineFn({
    input: { search: 'text?', cursor: 'int?', limit: 'int?' },
    output: { rows: 'json', total: 'int' },
    effects: ['read:flow.Page', ...membershipEffects],
    agent: true,
    handler: (ctx, args) =>
      listAllPages(ctx, {
        search: args.search == null ? null : String(args.search),
        cursor: args.cursor == null ? undefined : n(args.cursor),
        limit: args.limit == null ? undefined : n(args.limit),
      }),
  }),

  'page.get': defineFn({
    input: { id: 'id' },
    output: { value: 'json?' },
    effects: [
      'read:flow.Page',
      'read:flow.Project',
      'read:flow.ProjectMember',
      'read:flow.ProjectAccessGrant',
      'read:user.User',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const held = await pageDetail(ctx, String(args.id))
      return { value: held && (await canReadProject(ctx, held.projectId)) ? held : null }
    },
  }),

  'page.save': defineFn({
    input: {
      id: 'id',
      projectId: 'id',
      title: 'text',
      parentPageId: 'id?',
      sequence: 'int?',
      expectedVersion: 'int?',
      idempotencyKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.Page', 'write:flow.Page', 'read:flow.Project', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      savePage(ctx, {
        id: String(args.id),
        projectId: String(args.projectId),
        title: String(args.title),
        parentPageId: args.parentPageId === undefined ? undefined : (args.parentPageId as string | null),
        sequence: args.sequence == null ? null : n(args.sequence),
        expectedVersion: args.expectedVersion == null ? undefined : n(args.expectedVersion),
        idempotencyKey: String(args.idempotencyKey),
      }),
  }),

  /**
   * Re-parenting, as its own key.
   *
   * A hierarchy is only useful if it can be rearranged, and rearranging is a
   * different right from writing: someone may be trusted to edit a page
   * without being trusted to move a whole branch of the wiki.
   */
  'page.move': defineFn({
    input: { id: 'id', parentPageId: 'id?', sequence: 'int?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.Page', 'write:flow.Page', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      movePage(ctx, {
        id: String(args.id),
        parentPageId: (args.parentPageId as string | null) ?? null,
        sequence: args.sequence == null ? null : n(args.sequence),
      }),
  }),

  'page.reorder': defineFn({
    input: { id: 'id', direction: 'text' },
    output: { ok: 'bool', id: 'id?', moved: 'bool?', errors: 'json?' },
    effects: ['read:flow.Page', 'write:flow.Page', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      reorderPage(ctx, {
        id: String(args.id),
        direction: String(args.direction) === 'up' ? 'up' : 'down',
      }),
  }),

  'page.archive': defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.Page', 'write:flow.Page', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => archivePage(ctx, String(args.id)),
  }),

  'page.restore': defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.Page', 'write:flow.Page', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => restorePage(ctx, String(args.id)),
  }),

  /**
   * Rewriting a page's document, as a permission key of its own.
   *
   * It grants nothing by itself — Live Doc calls it only to ask whether this
   * caller may write, and hands back the row it returns (documents.ts). It is
   * separate from `page.save` because writing prose and renaming a page are
   * different rights: a reviewer may hold one without the other.
   */
  'page.editContent': defineFn({
    input: { id: 'id' },
    // The fields as they are actually returned, not a `value` wrapper the
    // handler never builds: output is projected against these keys, so
    // declaring `value` and answering `{ id, contentAttachmentId }` threw both
    // away and handed the caller `{}`. Live Doc reads `contentAttachmentId`
    // off this to find the stored snapshot, so an empty answer read as "never
    // written" — and the next push started from a blank document and flattened
    // it over the real one.
    output: { id: 'id?', contentAttachmentId: 'id?' },
    effects: ['read:flow.Page', ...membershipEffects],
    agent: true,
    handler: async (ctx, args) => {
      const row = await readableRow(ctx, 'flow.Page', args.id)
      return row ? { id: row.id, contentAttachmentId: row.contentAttachmentId ?? null } : null
    },
  }),

  /**
   * The project's sprints with what each is carrying — see sprintTotals.
   *
   * The totals live here rather than behind a key of their own because every
   * caller that wants a sprint wants to know how big it is, and the screen that
   * closes one needs the unfinished count before it can offer anywhere to put it.
   */
  'sprint.list': defineFn({
    input: { projectId: 'id' },
    output: {
      id: 'id',
      projectId: 'id',
      name: 'text',
      startDate: 'date?',
      endDate: 'date?',
      state: 'text',
      total: 'int',
      done: 'int',
      unfinished: 'int',
      estimate: 'decimal',
      estimateDone: 'decimal',
    },
    effects: [
      'read:flow.Sprint',
      'read:flow.Issue',
      'read:flow.Column',
      'read:flow.Project',
      'read:flow.ProjectMember',
      'read:flow.ProjectAccessGrant',
      'read:user.User',
      ...membershipEffects,
    ],
    agent: true,
    handler: async (ctx, args) => {
      if (!(await canReadProject(ctx, args.projectId))) return []
      const [rows, totals] = await Promise.all([
        ctx.db.select('flow.Sprint', { projectId: args.projectId }),
        sprintTotals(ctx, String(args.projectId)),
      ])
      return rows.map((row) => ({
        ...row,
        ...(totals.get(String(row.id)) ?? {
          total: 0,
          done: 0,
          unfinished: 0,
          estimate: 0,
          estimateDone: 0,
        }),
      }))
    },
  }),

  'sprint.save': defineFn({
    input: {
      id: 'id',
      projectId: 'id',
      name: 'text',
      startDate: 'date?',
      endDate: 'date?',
      idempotencyKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.Sprint', 'write:flow.Sprint', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      const existing = await readableRow(ctx, 'flow.Sprint', args.id)
      if (existing && existing.state !== 'planned')
        return invalid(issue('id', 'flow.error.invalidSprintState'))
      if (!(await canReadProject(ctx, args.projectId)))
        return invalid(issue('projectId', 'flow.error.notFound'))
      const name = String(args.name ?? '').trim()
      if (!name) return invalid(issue('name', 'flow.error.required'))
      const values = {
        projectId: args.projectId,
        name,
        startDate: args.startDate ?? null,
        endDate: args.endDate ?? null,
        state: 'planned',
      }
      if (existing) await ctx.db.update('flow.Sprint', { id: args.id }, values)
      else await ctx.db.insert('flow.Sprint', { id: args.id, ...values })
      return { ok: true, id: args.id }
    },
  }),

  'sprint.start': defineFn({
    input: { id: 'id', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:flow.Sprint',
      'write:flow.Sprint',
      // The guard row this contends on, so two callers cannot both be told
      // they started a sprint — see flow.ProjectGuard.
      'read:flow.ProjectGuard',
      'write:flow.ProjectGuard',
      ...membershipEffects,
    ],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      startSprint(ctx, { id: String(args.id), idempotencyKey: String(args.idempotencyKey) }),
  }),

  /**
   * Close it, and decide what happens to the work that did not finish.
   *
   * `carryTo` is absent by default, which is exactly what closing used to do —
   * so nothing that calls this today behaves differently.
   */
  /**
   * Delete a sprint nobody ever started — see deleteSprint for why only those.
   */
  'sprint.delete': defineFn({
    input: { id: 'id', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', released: 'int?', errors: 'json?' },
    effects: [
      'read:flow.Sprint',
      'write:flow.Sprint',
      'read:flow.Issue',
      'write:flow.Issue',
      ...membershipEffects,
    ],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      deleteSprint(ctx, { id: String(args.id), idempotencyKey: String(args.idempotencyKey) }),
  }),

  'sprint.close': defineFn({
    input: { id: 'id', carryTo: 'id?', carry: 'bool?', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', carried: 'int?', errors: 'json?' },
    effects: [
      'read:flow.Sprint',
      'write:flow.Sprint',
      'read:flow.Issue',
      'write:flow.Issue',
      'read:flow.Column',
      ...timelineEntryEffects,
      ...membershipEffects,
    ],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      closeSprint(ctx, {
        id: String(args.id),
        // Three answers, not two: leave it (omit), move it (an id), or take it
        // out of every sprint (`carry: true` with no target).
        ...(args.carryTo || args.carry === true
          ? { carryTo: args.carryTo ? String(args.carryTo) : null }
          : {}),
        idempotencyKey: String(args.idempotencyKey),
      }),
  }),

  /**
   * Every tag, with how much work in the company carries it.
   *
   * The count is here rather than on the screen because of what archiving a tag
   * does: it deletes every `IssueTag` row for it, across every project, and
   * cannot be undone. The block that offers that button sits inside a *project's*
   * settings — so the number is the only thing that says how far the button
   * reaches. One grouped query, not one count per tag.
   */
  'tag.list': defineFn({
    input: { search: 'text?', limit: 'int?', includeArchived: 'bool?' },
    output: { id: 'id', name: 'text', color: 'text?', active: 'bool', usage: 'int' },
    effects: ['read:flow.Tag', 'read:flow.IssueTag'],
    agent: true,
    handler: async (ctx, args) => {
      const rows = await optionRows(ctx, 'flow.Tag', args)
      if (!rows.length) return rows
      const IT = ctx.table('flow.IssueTag')
      // Every row, archived issues included, because that is what `tag.archive`
      // deletes. A count that quietly skipped archived work would understate
      // exactly the thing the reader is about to lose.
      //
      // Counted across every project on purpose, membership notwithstanding.
      // The figure exists to answer "what will archiving this destroy", and
      // archiving a tag clears it from every project at once (FLW-DEC-006) — a
      // count narrowed to the reader's own projects would understate the damage
      // and make the warning a lie. What it gives away is one number about work
      // the reader cannot otherwise see, which is the price of the warning
      // being true. See the exception list in flow-membership.test.ts.
      const groups = await ctx.db.group(
        from(IT)
          .where(
            inArray(
              IT.tagId!,
              rows.map((row) => String(row.id)),
            ),
          )
          .groupBy({ col: IT.tagId! }),
      )
      const counted = new Map(groups.map((group) => [String(group.key[0] ?? ''), n(group.count)]))
      return rows.map((row) => ({ ...row, usage: counted.get(String(row.id)) ?? 0 }))
    },
  }),

  'tag.save': defineFn({
    input: { id: 'id', name: 'text', color: 'text?', active: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.Tag', 'write:flow.Tag'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const name = String(args.name ?? '').trim()
      if (!name) return invalid(issue('name', 'flow.error.required'))
      const existing = (await ctx.db.select('flow.Tag', { id: args.id }))[0]
      const clash = (await ctx.db.select('flow.Tag', { name })).find((row) => row.id !== args.id)
      if (clash) return invalid(issue('name', 'flow.error.duplicateName'))
      const values = {
        name,
        color: args.color ? String(args.color) : (existing?.color ?? null),
        active: args.active ?? existing?.active ?? true,
      }
      if (existing) await ctx.db.update('flow.Tag', { id: args.id }, values)
      else await ctx.db.insert('flow.Tag', { id: args.id, ...values })
      return { ok: true, id: args.id }
    },
  }),

  'tag.archive': defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.Tag', 'write:flow.Tag', 'read:flow.IssueTag', 'write:flow.IssueTag'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('flow.Tag', { id: args.id }))[0]
      if (!existing) return invalid(issue('id', 'flow.error.notFound'))
      await ctx.db.update('flow.Tag', { id: args.id }, { active: false })
      const IT = ctx.table('flow.IssueTag')
      await ctx.db.del(deleteFrom(IT).where(eq(IT.tagId, args.id)))
      return { ok: true, id: args.id }
    },
  }),

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
    handler: (ctx, args) => listIssues(ctx, args),
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
    handler: (ctx, args) => issueBuckets(ctx, args, args.today == null ? undefined : String(args.today)),
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
    handler: (ctx, args) => groupIssues(ctx, args),
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
    handler: async (ctx, args) => {
      const held = await issueDetail(ctx, String(args.id))
      return held && (await canReadProject(ctx, held.projectId)) ? held : null
    },
  }),

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
    handler: async (ctx, args) => (await readableRow(ctx, 'flow.Issue', args.id)) ?? null,
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
    handler: (ctx, args) =>
      saveIssue(ctx, {
        ...(args as Record<string, unknown>),
        id: String(args.id),
        projectId: String(args.projectId),
        columnId: String(args.columnId),
        title: String(args.title),
        idempotencyKey: String(args.idempotencyKey),
        tagIds: Array.isArray(args.tagIds) ? args.tagIds.map(String) : undefined,
        fields:
          args.fields && typeof args.fields === 'object'
            ? (args.fields as Record<string, unknown>)
            : undefined,
      }),
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
    handler: (ctx, args) =>
      moveIssue(ctx, {
        id: String(args.id),
        columnId: String(args.columnId),
        expectedVersion: Number(args.expectedVersion),
        idempotencyKey: String(args.idempotencyKey),
      }),
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
    handler: (ctx, args) =>
      assignSprint(ctx, {
        id: String(args.id),
        sprintId: args.sprintId ? String(args.sprintId) : null,
        expectedVersion: Number(args.expectedVersion),
        idempotencyKey: String(args.idempotencyKey),
      }),
  }),

  'issue.comment': defineFn({
    input: {
      id: 'id',
      issueId: 'id',
      body: 'text',
      kind: 'text?',
      /** Users this comment is addressed to, beyond whoever already follows. */
      mentionUserIds: 'json?',
      idempotencyKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [...commentEffects, 'read:user.User', 'write:mail.Mention', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      addComment(ctx, {
        id: String(args.id),
        issueId: String(args.issueId),
        body: String(args.body),
        kind: args.kind === 'note' ? 'note' : 'comment',
        mentionUserIds: Array.isArray(args.mentionUserIds) ? args.mentionUserIds.map(String) : [],
        idempotencyKey: String(args.idempotencyKey),
      }),
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
    handler: (ctx, args) =>
      archiveIssue(ctx, {
        id: String(args.id),
        expectedVersion: n(args.expectedVersion),
        idempotencyKey: String(args.idempotencyKey),
      }),
  }),

  'issue.restore': defineFn({
    input: { id: 'id', expectedVersion: 'int', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: ['read:flow.Issue', 'write:flow.Issue', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      restoreIssue(ctx, {
        id: String(args.id),
        expectedVersion: n(args.expectedVersion),
        idempotencyKey: String(args.idempotencyKey),
      }),
  }),

  /** The door `issue.unfollow` never had a pair for — see startFollowing. */
  'issue.follow': defineFn({
    input: { issueId: 'id', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:flow.Issue',
      'read:user.User',
      'read:mail.Thread',
      'read:partner.Partner',
      'read:mail.Follower',
      'write:mail.Follower',
      ...membershipEffects,
    ],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      startFollowing(ctx, {
        issueId: String(args.issueId),
        idempotencyKey: String(args.idempotencyKey),
      }),
  }),

  /**
   * Leaves an issue's thread.
   *
   * A separate key from commenting, because it is the opposite act: everything
   * else in this module hands out subscriptions, and this is the only way to
   * give one back.
   */
  'issue.unfollow': defineFn({
    input: { issueId: 'id', idempotencyKey: 'text' },
    output: { ok: 'bool', removed: 'int?', errors: 'json?' },
    // `unfollowThread` clears the follower's per-subtype rows too, which the
    // effect system refused until it was said out loud — which is the point of
    // it: a capability nobody declared is one nobody reviewed.
    effects: [
      'read:flow.Issue',
      'read:user.User',
      'read:mail.Follower',
      'write:mail.Follower',
      'write:mail.FollowerSubtype',
      ...membershipEffects,
    ],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      stopFollowing(ctx, {
        issueId: String(args.issueId),
        idempotencyKey: String(args.idempotencyKey),
      }),
  }),

  'issue.dependency.add': defineFn({
    input: { id: 'id', issueId: 'id', dependsOnIssueId: 'id', relation: 'text', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:flow.Issue',
      'read:flow.IssueDependency',
      'write:flow.IssueDependency',
      ...membershipEffects,
    ],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      addDependency(ctx, {
        id: String(args.id),
        issueId: String(args.issueId),
        dependsOnIssueId: String(args.dependsOnIssueId),
        relation: String(args.relation),
        idempotencyKey: String(args.idempotencyKey),
      }),
  }),

  'issue.dependency.remove': defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:flow.IssueDependency',
      'write:flow.IssueDependency',
      'read:flow.Issue',
      ...membershipEffects,
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('flow.IssueDependency', { id: args.id }))[0]
      // The edge carries no project of its own, so it is read through the issue
      // it hangs off — cutting a link between two issues is editing the project
      // they are in, and needs the same standing as anything else there.
      if (!existing || !(await readableRow(ctx, 'flow.Issue', existing.issueId)))
        return invalid(issue('id', 'flow.error.notFound'))
      const D = ctx.table('flow.IssueDependency')
      await ctx.db.del(deleteFrom(D).where(eq(D.id, args.id)))
      return { ok: true, id: args.id }
    },
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
    handler: async (ctx, args) => {
      const found = await listIssues(ctx, {
        ...(args.projectId ? { projectId: args.projectId } : {}),
        listState: args.search ? { ...emptyIssueListState(), q: String(args.search) } : undefined,
        limit: Math.max(1, Math.min(100, n(args.limit ?? 40))),
      })
      return found.rows
        .filter((row) => !args.excludeId || row.id !== args.excludeId)
        .map((row) => ({ id: row.id, title: row.title, columnName: row.columnName ?? null }))
    },
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
    handler: (ctx, args) =>
      dependenciesFor(
        ctx,
        Array.isArray(args.issueIds) ? args.issueIds.map(String) : [],
        args.includeExternalTargets === true,
      ),
  }),
}
