import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { canReadProject } from '../membership.ts'
import { invalid, issue, n } from '../domain/command.ts'
import { command } from '../domain/command-check.ts'
import { FIELD_KINDS } from '../types.ts'
import { defineFn } from '@ketvietlab/ketjs'
import { membershipEffects } from './effects.ts'

export async function fieldListHandler(ctx: Ctx, args: Record<string, unknown>) {
  if (!(await canReadProject(ctx, args.projectId))) return []
  const rows = await ctx.db.select(
    'flow.FieldDef',
    args.includeArchived === true
      ? { projectId: args.projectId }
      : { projectId: args.projectId, active: true },
  )
  return rows.sort((a, b) => n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id)))
}

export async function fieldSaveHandler(ctx: Ctx, args: Record<string, unknown>) {
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
}

export async function fieldArchiveHandler(ctx: Ctx, args: Record<string, unknown>) {
  const existing = (await ctx.db.select('flow.FieldDef', { id: args.id }))[0]
  if (!existing) return invalid(issue('id', 'flow.error.notFound'))
  await ctx.db.update('flow.FieldDef', { id: args.id }, { active: false })
  return { ok: true, id: args.id }
}

export const fieldFunctions: Record<string, FnSpec> = {
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
    handler: fieldListHandler,
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
    handler: fieldSaveHandler,
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
    handler: fieldArchiveHandler,
  }),
}
