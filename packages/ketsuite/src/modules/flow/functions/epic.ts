import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { canReadProject, readableRow, visibleRows } from '../membership.ts'
import { epicTotals } from '../queries/progress.ts'
import { invalid, issue, n, normalized } from '../domain/command.ts'
import { defineFn } from '@ketvietlab/ketjs'
import { membershipEffects } from './effects.ts'
import { saveEntity } from './entity-save.ts'

export async function epicListHandler(ctx: Ctx, args: Record<string, unknown>) {
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
}

export async function epicListAllHandler(ctx: Ctx, args: Record<string, unknown>) {
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
}

export async function epicGetHandler(ctx: Ctx, args: Record<string, unknown>) {
  const held = (await ctx.db.select('flow.Epic', { id: args.id }))[0] ?? null
  return { value: held && (await canReadProject(ctx, held.projectId)) ? held : null }
}

export async function epicEditContentHandler(ctx: Ctx, args: Record<string, unknown>) {
  const row = await readableRow(ctx, 'flow.Epic', args.id)
  return row ? { id: row.id, contentAttachmentId: row.contentAttachmentId ?? null } : null
}

export async function epicArchiveHandler(ctx: Ctx, args: Record<string, unknown>) {
  const existing = await readableRow(ctx, 'flow.Epic', args.id)
  if (!existing) return invalid(issue('id', 'flow.error.notFound'))
  await ctx.db.update('flow.Epic', { id: args.id }, { active: false })
  return { ok: true, id: args.id }
}

export const epicFunctions: Record<string, FnSpec> = {
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
    handler: epicListHandler,
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
    handler: epicListAllHandler,
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
    handler: epicGetHandler,
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
    handler: epicEditContentHandler,
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
    handler: epicArchiveHandler,
  }),
}
