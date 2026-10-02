import type { Ctx, Row } from '@ketvietlab/ketjs'
import { command } from '../domain/command-check.ts'
import { invalid, issue } from '../domain/command.ts'
import { addMember, canReadProject } from '../membership.ts'
import { defineFn } from '@ketvietlab/ketjs'

/** Plain upsert for the entities with no CAS field — no concurrent editor to race against. */
export const saveEntity = (
  model: string,
  fields: string[],
  required: string[],
  defaults: (values: Row, existing: Row | undefined) => Row,
) => {
  async function saveEntityHandler(ctx: Ctx, args: Record<string, unknown>) {
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
    const cs = ctx.change(model, { ...defaults(values, existing), ...values }, existing ?? null).cast(fields)
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
  }
  return defineFn({
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
    handler: saveEntityHandler,
  })
}
