import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { canReadProject, readableRow } from '../membership.ts'
import { invalid, issue, n } from '../domain/command.ts'
import { defineFn } from '@ketvietlab/ketjs'
import { membershipEffects } from './effects.ts'
import { saveEntity } from './entity-save.ts'

export async function columnListHandler(ctx: Ctx, args: Record<string, unknown>) {
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
}

export async function columnArchiveHandler(ctx: Ctx, args: Record<string, unknown>) {
  const existing = await readableRow(ctx, 'flow.Column', args.id)
  if (!existing) return invalid(issue('id', 'flow.error.notFound'))
  const held = await ctx.db.select('flow.Issue', { columnId: args.id, active: true })
  if (held.length) return invalid(issue('id', 'flow.error.columnHasIssues'))
  await ctx.db.update('flow.Column', { id: args.id }, { active: false })
  return { ok: true, id: args.id }
}

export const columnFunctions: Record<string, FnSpec> = {
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
    handler: columnListHandler,
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
    handler: columnArchiveHandler,
  }),
}
