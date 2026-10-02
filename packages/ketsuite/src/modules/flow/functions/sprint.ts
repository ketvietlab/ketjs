import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { canReadProject, readableRow } from '../membership.ts'
import { sprintTotals } from '../queries/progress.ts'
import { command } from '../domain/command-check.ts'
import { invalid, issue } from '../domain/command.ts'
import { closeSprint, deleteSprint, startSprint } from '../domain/sprint-lifecycle.ts'
import { defineFn } from '@ketvietlab/ketjs'
import { membershipEffects, timelineEntryEffects } from './effects.ts'

export async function sprintListHandler(ctx: Ctx, args: Record<string, unknown>) {
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
}

export async function sprintSaveHandler(ctx: Ctx, args: Record<string, unknown>) {
  const error = command(ctx, args.idempotencyKey)
  if (error) return error
  const existing = await readableRow(ctx, 'flow.Sprint', args.id)
  if (existing && existing.state !== 'planned') return invalid(issue('id', 'flow.error.invalidSprintState'))
  if (!(await canReadProject(ctx, args.projectId))) return invalid(issue('projectId', 'flow.error.notFound'))
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
}

export function sprintStartHandler(ctx: Ctx, args: Record<string, unknown>) {
  return startSprint(ctx, { id: String(args.id), idempotencyKey: String(args.idempotencyKey) })
}

export function sprintDeleteHandler(ctx: Ctx, args: Record<string, unknown>) {
  return deleteSprint(ctx, { id: String(args.id), idempotencyKey: String(args.idempotencyKey) })
}

export function sprintCloseHandler(ctx: Ctx, args: Record<string, unknown>) {
  return closeSprint(ctx, {
    id: String(args.id),
    // Three answers, not two: leave it (omit), move it (an id), or take it
    // out of every sprint (`carry: true` with no target).
    ...(args.carryTo || args.carry === true ? { carryTo: args.carryTo ? String(args.carryTo) : null } : {}),
    idempotencyKey: String(args.idempotencyKey),
  })
}

export const sprintFunctions: Record<string, FnSpec> = {
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
    handler: sprintListHandler,
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
    handler: sprintSaveHandler,
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
    handler: sprintStartHandler,
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
    handler: sprintDeleteHandler,
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
    handler: sprintCloseHandler,
  }),
}
