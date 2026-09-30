import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { canReadProject, readableProject } from '../membership.ts'
import { invalid, issue } from '../domain/command.ts'
import { defineFn } from '@ketvietlab/ketjs'
import { membershipEffects } from './effects.ts'

export async function boardScopeHandler(ctx: Ctx) {
  if (!ctx.actor) return { projectId: null }
  const held = (await ctx.db.select('flow.BoardScope', { userId: ctx.actor }))[0]
  if (!held) return { projectId: null }
  // Where they were last is not where they may still go: somebody taken off
  // a project keeps the row that remembers it, and answering with it would
  // send the screen to a board that is no longer theirs — and would name a
  // project they can no longer be told exists.
  return (await canReadProject(ctx, held.projectId)) ? { projectId: held.projectId } : { projectId: null }
}

export async function boardRememberHandler(ctx: Ctx, args: Record<string, unknown>) {
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
}

export const boardFunctions: Record<string, FnSpec> = {
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
    handler: boardScopeHandler,
  }),
  'board.remember': defineFn({
    input: { projectId: 'id' },
    output: { ok: 'bool', errors: 'json?' },
    effects: ['read:flow.BoardScope', 'write:flow.BoardScope', 'read:flow.Project', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: boardRememberHandler,
  }),
}
