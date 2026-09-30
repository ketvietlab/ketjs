import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { canReadProject, readableRow } from '../membership.ts'
import { invalid, issue, n } from '../domain/command.ts'
import { defineFn } from '@ketvietlab/ketjs'
import { membershipEffects } from './effects.ts'
import { saveEntity } from './entity-save.ts'

export async function issueTypeListHandler(ctx: Ctx, args: Record<string, unknown>) {
  if (!(await canReadProject(ctx, args.projectId))) return []
  const rows = await ctx.db.select(
    'flow.IssueType',
    args.includeArchived === true
      ? { projectId: args.projectId }
      : { projectId: args.projectId, active: true },
  )
  return rows.sort((a, b) => n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id)))
}

export async function issueTypeArchiveHandler(ctx: Ctx, args: Record<string, unknown>) {
  const existing = await readableRow(ctx, 'flow.IssueType', args.id)
  if (!existing) return invalid(issue('id', 'flow.error.notFound'))
  const held = await ctx.db.select('flow.Issue', { typeId: args.id, active: true })
  if (held.length) return invalid(issue('id', 'flow.error.typeHasIssues'))
  await ctx.db.update('flow.IssueType', { id: args.id }, { active: false })
  return { ok: true, id: args.id }
}

export const issueTypeFunctions: Record<string, FnSpec> = {
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
    handler: issueTypeListHandler,
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
    handler: issueTypeArchiveHandler,
  }),
}
