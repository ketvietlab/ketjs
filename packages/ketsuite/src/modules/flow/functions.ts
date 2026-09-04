import { deleteFrom, defineFn, eq, from, inArray } from '@ketvietlab/ketjs'
import { FIELD_KINDS } from './types.ts'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import {
  actorRequired,
  addComment,
  archiveIssue,
  restoreIssue,
  startFollowing,
  stopFollowing,
  addDependency,
  assignSprint,
  closeSprint,
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

const flowReadEffects = [
  'read:flow.Project',
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
    .slice(0, Math.max(1, Math.min(200, n(args.limit ?? 80))))
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
    effects: [`read:${model}`, `write:${model}`],
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
      const existing = (await ctx.db.select(model, { id }))[0]
      const cs = ctx
        .change(model, { ...defaults(values, existing), ...values }, existing ?? null)
        .cast(fields)
      const withRequired = required.length ? cs.required(required) : cs
      if (!withRequired.valid) return { ok: false, errors: withRequired.errors }
      await ctx.db.commit(withRequired, existing ? { id } : undefined)
      return { ok: true, id }
    },
  })

export const functions: Record<string, FnSpec> = {
  'project.list': defineFn({
    input: {
      search: 'text?',
      limit: 'int?',
      includeArchived: 'bool?',
      /** Only projects the caller has an issue in — see the note on projectsWithMyWork. */
      mine: 'bool?',
    },
    output: { id: 'id', key: 'text', name: 'text', description: 'text?', active: 'bool' },
    effects: ['read:flow.Project', 'read:flow.Issue'],
    agent: true,
    handler: async (ctx, args) => {
      const rows = await optionRows(ctx, 'flow.Project', args)
      if (args.mine !== true) return rows
      const mine = await projectsWithMyWork(ctx)
      return rows.filter((row) => mine.has(String(row.id)))
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
  /**
   * The issue counts behind a list of projects, in two reads rather than one
   * per project — see `projectStats`.
   */
  'project.stats': defineFn({
    input: { projectIds: 'json' },
    output: { id: 'id', total: 'int', done: 'int', state: 'text' },
    effects: ['read:flow.Issue', 'read:flow.Column'],
    agent: true,
    handler: async (ctx, args) => {
      const ids = Array.isArray(args.projectIds) ? args.projectIds.map(String) : []
      const stats = await projectStats(ctx, ids)
      return [...stats].map(([id, counted]) => ({
        id,
        total: counted.total,
        done: counted.done,
        state: projectStateOf(counted),
      }))
    },
  }),

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
    effects: ['read:flow.Project'],
    agent: true,
    handler: async (ctx, args) => (await ctx.db.select('flow.Project', { id: args.id }))[0] ?? null,
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
    effects: ['read:flow.Project'],
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ctx.db.select('flow.Project', { id: args.id }))[0]
      return row ? { id: row.id, contentAttachmentId: row.contentAttachmentId ?? null } : null
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
    effects: ['read:flow.Column'],
    agent: true,
    handler: async (ctx, args) => {
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
    effects: ['read:flow.Column', 'write:flow.Column', 'read:flow.Issue'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('flow.Column', { id: args.id }))[0]
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
    effects: ['read:flow.IssueType'],
    agent: true,
    handler: async (ctx, args) => {
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
    effects: ['read:flow.IssueType', 'write:flow.IssueType', 'read:flow.Issue'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('flow.IssueType', { id: args.id }))[0]
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
    effects: ['read:flow.BoardScope'],
    agent: true,
    handler: async (ctx) => {
      if (!ctx.actor) return { projectId: null }
      const held = (await ctx.db.select('flow.BoardScope', { userId: ctx.actor }))[0]
      return { projectId: held ? held.projectId : null }
    },
  }),

  'board.remember': defineFn({
    input: { projectId: 'id' },
    output: { ok: 'bool', errors: 'json?' },
    effects: ['read:flow.BoardScope', 'write:flow.BoardScope', 'read:flow.Project'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!ctx.actor) return invalid(issue('actor', 'flow.error.actorRequired'))
      const project = (await ctx.db.select('flow.Project', { id: args.projectId, active: true }))[0]
      if (!project) return invalid(issue('projectId', 'flow.error.notFound'))
      // One row per reader, so opening a different board replaces the answer
      // rather than adding one.
      const id = `${String(ctx.actor)}`
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
    effects: ['read:flow.FieldDef'],
    agent: true,
    handler: async (ctx, args) => {
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
    effects: ['read:flow.FieldDef', 'write:flow.FieldDef'],
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
    effects: ['read:flow.FieldDef', 'write:flow.FieldDef'],
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
    },
    effects: ['read:flow.Epic'],
    agent: true,
    handler: async (ctx, args) => {
      const where: Row = { projectId: args.projectId }
      if (args.id) where.id = args.id
      if (args.includeArchived !== true) where.active = true
      const rows = await ctx.db.select('flow.Epic', where)
      const needle = normalized(args.search)
      const filtered = rows.filter((row) => !needle || normalized(row.title).includes(needle))
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
    effects: ['read:flow.Epic', 'read:flow.Project'],
    agent: true,
    handler: async (ctx, args) => {
      const [epics, projects] = await Promise.all([
        ctx.db.select('flow.Epic', { active: true }),
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
    effects: ['read:flow.Epic'],
    agent: true,
    handler: async (ctx, args) => ({
      value: (await ctx.db.select('flow.Epic', { id: args.id }))[0] ?? null,
    }),
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
    effects: ['read:flow.Epic'],
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ctx.db.select('flow.Epic', { id: args.id }))[0]
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
    effects: ['read:flow.Epic', 'write:flow.Epic'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('flow.Epic', { id: args.id }))[0]
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
    effects: ['read:flow.Page'],
    agent: true,
    handler: (ctx, args) =>
      listPages(ctx, {
        projectId: args.projectId == null ? null : String(args.projectId),
        search: args.search == null ? null : String(args.search),
        includeArchived: args.includeArchived === true,
        limit: args.limit == null ? undefined : n(args.limit),
      }),
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
    effects: ['read:flow.Page', 'read:flow.Project'],
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
    effects: ['read:flow.Page', 'read:flow.Project'],
    agent: true,
    handler: async (ctx, args) => ({ value: await pageDetail(ctx, String(args.id)) }),
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
    effects: ['read:flow.Page', 'write:flow.Page', 'read:flow.Project'],
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
    effects: ['read:flow.Page', 'write:flow.Page'],
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
    effects: ['read:flow.Page', 'write:flow.Page'],
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
    effects: ['read:flow.Page', 'write:flow.Page'],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => archivePage(ctx, String(args.id)),
  }),

  'page.restore': defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.Page', 'write:flow.Page'],
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
    effects: ['read:flow.Page'],
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ctx.db.select('flow.Page', { id: args.id }))[0]
      return row ? { id: row.id, contentAttachmentId: row.contentAttachmentId ?? null } : null
    },
  }),

  'sprint.list': defineFn({
    input: { projectId: 'id' },
    output: { id: 'id', projectId: 'id', name: 'text', startDate: 'date?', endDate: 'date?', state: 'text' },
    effects: ['read:flow.Sprint'],
    agent: true,
    handler: (ctx, args) => ctx.db.select('flow.Sprint', { projectId: args.projectId }),
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
    effects: ['read:flow.Sprint', 'write:flow.Sprint'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      const existing = (await ctx.db.select('flow.Sprint', { id: args.id }))[0]
      if (existing && existing.state !== 'planned')
        return invalid(issue('id', 'flow.error.invalidSprintState'))
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
    effects: ['read:flow.Sprint', 'write:flow.Sprint'],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      startSprint(ctx, { id: String(args.id), idempotencyKey: String(args.idempotencyKey) }),
  }),

  'sprint.close': defineFn({
    input: { id: 'id', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.Sprint', 'write:flow.Sprint'],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      closeSprint(ctx, { id: String(args.id), idempotencyKey: String(args.idempotencyKey) }),
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
    effects: [...flowReadEffects],
    agent: true,
    handler: (ctx, args) => issueDetail(ctx, String(args.id)),
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
    effects: ['read:flow.Issue'],
    agent: true,
    handler: async (ctx, args) => (await ctx.db.select('flow.Issue', { id: args.id }))[0] ?? null,
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
    effects: ['read:flow.Issue', 'write:flow.Issue', 'read:flow.Column', 'read:flow.IssueDependency'],
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
    effects: ['read:flow.Issue', 'write:flow.Issue', 'read:flow.Sprint'],
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
    effects: [...commentEffects, 'read:user.User', 'write:mail.Mention'],
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
   * Leaves an issue's thread.
   *
   * A separate key from commenting, because it is the opposite act: everything
   * else in this module hands out subscriptions, and this is the only way to
   * give one back.
   */
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
    effects: ['read:flow.Issue', 'write:flow.Issue'],
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
    effects: ['read:flow.Issue', 'write:flow.Issue'],
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
    ],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      startFollowing(ctx, {
        issueId: String(args.issueId),
        idempotencyKey: String(args.idempotencyKey),
      }),
  }),

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
    effects: ['read:flow.Issue', 'read:flow.IssueDependency', 'write:flow.IssueDependency'],
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
    effects: ['read:flow.IssueDependency', 'write:flow.IssueDependency'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('flow.IssueDependency', { id: args.id }))[0]
      if (!existing) return invalid(issue('id', 'flow.error.notFound'))
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
    effects: ['read:flow.IssueDependency'],
    agent: true,
    handler: (ctx, args) =>
      dependenciesFor(
        ctx,
        Array.isArray(args.issueIds) ? args.issueIds.map(String) : [],
        args.includeExternalTargets === true,
      ),
  }),
}
