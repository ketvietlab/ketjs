import { deleteFrom, defineFn, eq } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import {
  actorRequired,
  addComment,
  addDependency,
  assignSprint,
  closeSprint,
  commandKey,
  dependenciesFor,
  groupIssues,
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

const flowReadEffects = [
  'read:flow.Project',
  'read:flow.Column',
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
  'write:mail.Thread',
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
    input: { search: 'text?', limit: 'int?', includeArchived: 'bool?' },
    output: { id: 'id', key: 'text', name: 'text', description: 'text?', active: 'bool' },
    effects: ['read:flow.Project'],
    agent: true,
    handler: (ctx, args) => optionRows(ctx, 'flow.Project', args),
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

  'epic.list': defineFn({
    input: { projectId: 'id', search: 'text?', limit: 'int?', includeArchived: 'bool?' },
    output: { id: 'id', projectId: 'id', title: 'text', color: 'text?', active: 'bool' },
    effects: ['read:flow.Epic'],
    agent: true,
    handler: async (ctx, args) => {
      const rows = await ctx.db.select(
        'flow.Epic',
        args.includeArchived === true
          ? { projectId: args.projectId }
          : { projectId: args.projectId, active: true },
      )
      const needle = normalized(args.search)
      return rows
        .filter((row) => !needle || normalized(row.title).includes(needle))
        .slice(0, Math.max(1, Math.min(200, n(args.limit ?? 80))))
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

  'tag.list': defineFn({
    input: { search: 'text?', limit: 'int?', includeArchived: 'bool?' },
    output: { id: 'id', name: 'text', color: 'text?', active: 'bool' },
    effects: ['read:flow.Tag'],
    agent: true,
    handler: (ctx, args) => optionRows(ctx, 'flow.Tag', args),
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
      projectId: 'id?',
      columnId: 'id?',
      epicId: 'id?',
      sprintId: 'id?',
      assigneeUserId: 'id?',
      includeArchived: 'bool?',
      cursor: 'text?',
      limit: 'int?',
      listState: 'json?',
      path: 'json?',
      timezone: 'text?',
    },
    output: { rows: 'json', total: 'int', nextCursor: 'text?' },
    effects: [...flowReadEffects],
    agent: true,
    handler: (ctx, args) => listIssues(ctx, args),
  }),

  'issue.group': defineFn({
    input: {
      projectId: 'id?',
      columnId: 'id?',
      epicId: 'id?',
      sprintId: 'id?',
      assigneeUserId: 'id?',
      includeArchived: 'bool?',
      listState: 'json',
      path: 'json?',
      timezone: 'text?',
      limit: 'int?',
      offset: 'int?',
    },
    effects: [...flowReadEffects],
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
      epicId: 'id?',
      sprintId: 'id?',
      parentIssueId: 'id?',
      title: 'text',
      assigneeUserId: 'id?',
      priority: 'text?',
      dueDate: 'date?',
      estimate: 'decimal?',
      tagIds: 'json?',
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
    input: { id: 'id', issueId: 'id', body: 'text', kind: 'text?', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [...commentEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) =>
      addComment(ctx, {
        id: String(args.id),
        issueId: String(args.issueId),
        body: String(args.body),
        kind: args.kind === 'note' ? 'note' : 'comment',
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
    effects: [...flowReadEffects],
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
    input: { issueIds: 'json' },
    output: { issueId: 'id', dependsOnIssueId: 'id', relation: 'text' },
    effects: ['read:flow.IssueDependency'],
    agent: true,
    handler: (ctx, args) =>
      dependenciesFor(ctx, Array.isArray(args.issueIds) ? args.issueIds.map(String) : []),
  }),
}
