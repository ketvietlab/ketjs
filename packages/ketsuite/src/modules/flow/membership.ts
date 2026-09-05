// Which projects a caller may see, and the one place that decides it.
//
// Every read of project data in this module goes through `visibleProjects` or
// `readableProject`. That is not a style preference: the only insurance against
// a leak is that there is one gate rather than fifty, because the one somebody
// forgets is the one nobody notices until a person reads what they should not.
//
// The shape is `crm.caseAudience`'s, for the same reasons it has that shape:
//
//   `null` means "everything". Either the call carries no actor at all — a job
//   or a fixture running as the system — or the actor is a superuser, or the
//   actor holds a company-wide grant. A grant row is the business-manager
//   alternative to making somebody a technical superuser.
//
//   Anything else is the list of projects they are a member of, and a caller
//   who is a member of nothing reads nothing. A project with no members is
//   visible to nobody, which is the only safe default for a model whose whole
//   purpose is to keep some projects unread.
//
// See FLW-DEC-012.

import { deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'

/**
 * Answered once per call, not once per query.
 *
 * A single function call cannot change who the caller is or what they are a
 * member of, and `issueQuery` alone runs several queries for one screen. Three
 * reads per query became three reads per call the moment this was added, which
 * is the difference between a filter you can afford everywhere and one you
 * start leaving out.
 *
 * Keyed weakly by the context, so it lives exactly as long as the call does and
 * a transaction's own context — `ctx.tx` hands the body a different one — gets
 * its own answer rather than inheriting a stale one.
 */
const answered = new WeakMap<Ctx, Promise<string[] | null>>()

/**
 * Every project id the caller may read, or `null` for "no restriction".
 *
 * `null` and `[]` are different answers and callers must keep them apart: the
 * first is "see everything", the second is "see nothing". Collapsing them would
 * make the filter stop filtering for exactly the people it exists to stop.
 */
export function visibleProjects(ctx: Ctx): Promise<string[] | null> {
  const held = answered.get(ctx)
  if (held) return held
  const asked = resolveVisibleProjects(ctx)
  answered.set(ctx, asked)
  return asked
}

async function resolveVisibleProjects(ctx: Ctx): Promise<string[] | null> {
  if (!ctx.actor) return null
  // Read in order and stop at the first answer, rather than asking all three at
  // once: a superuser costs one read and a grant holder two, and the third —
  // the membership list itself — is only needed by the callers who are actually
  // restricted. The memo above is what keeps even that to once per call.
  const user = (await ctx.db.select('user.User', { id: ctx.actor, active: true }))[0] ?? null
  if (user?.superuser === true) return null
  const grant = (await ctx.db.select('flow.ProjectAccessGrant', { userId: ctx.actor }))[0] ?? null
  if (grant) return null
  const rows = await ctx.db.select('flow.ProjectMember', { userId: ctx.actor })
  return rows.map((row) => String(row.projectId))
}

/**
 * The project behind an id, if this caller may read it — otherwise `null`.
 *
 * `null` rather than a refusal, because the caller turns it into "not found".
 * Telling somebody that a project exists but is not theirs is telling them that
 * a project exists, which for a model built to hide some projects is the wrong
 * half of the answer to give away.
 */
export async function readableProject(ctx: Ctx, projectId: unknown): Promise<Row | null> {
  const id = String(projectId ?? '')
  if (!id) return null
  const project = (await ctx.db.select('flow.Project', { id }))[0]
  if (!project) return null
  const visible = await visibleProjects(ctx)
  if (visible === null) return project
  return visible.includes(id) ? project : null
}

/** True when the caller may read this project — the boolean form of the above. */
export const canReadProject = async (ctx: Ctx, projectId: unknown): Promise<boolean> =>
  (await readableProject(ctx, projectId)) !== null

/**
 * Restrict a query on a table that carries `projectId` to what the caller sees.
 *
 * The empty case matters and needs no branch: `inArray` with an empty list
 * compiles to `1 = 0` — see the note in query.ts — so a caller who is a member
 * of nothing gets an empty answer rather than an unfiltered one, and nobody has
 * to remember to write that case.
 */
export const restrictToVisible = <T extends { where(...clauses: never[]): T }>(
  query: T,
  column: unknown,
  visible: string[] | null,
): T => (visible === null ? query : query.where(inArray(column as never, visible) as never))

/**
 * The rows of a project-scoped table the caller may read.
 *
 * For the paths that do not build a query — `db.select` with a plain filter —
 * so they filter through the same rule rather than through a copy of it.
 */
export async function visibleRows(ctx: Ctx, model: string, where: Row = {}): Promise<Row[]> {
  const visible = await visibleProjects(ctx)
  if (visible !== null && !visible.length) return []
  const rows = await ctx.db.select(model, where)
  if (visible === null) return rows
  const allowed = new Set(visible)
  return rows.filter((row) => allowed.has(String(row.projectId)))
}

/**
 * Put somebody on a project.
 *
 * Used by the membership commands and by project creation alike: whoever makes
 * a project is on it, because a project nobody can see is not a project anybody
 * asked for — and because it is the only way the first member ever gets there.
 */
export async function addMember(
  ctx: Ctx,
  input: { projectId: string; userId: string; addedByUserId?: string | null; at: string },
): Promise<void> {
  await ctx.db.insertIfAbsent('flow.ProjectMember', {
    id: `${input.projectId}:${input.userId}`,
    projectId: input.projectId,
    userId: input.userId,
    addedAt: input.at,
    addedByUserId: input.addedByUserId ?? null,
  })
}

/** Everyone on a project, oldest first, with the name a screen can print. */
export async function membersOf(ctx: Ctx, projectId: string): Promise<Row[]> {
  const rows = await ctx.db.select('flow.ProjectMember', { projectId })
  const userIds = [...new Set(rows.map((row) => String(row.userId)))]
  const U = ctx.table('user.User')
  const users = userIds.length ? await ctx.db.all(from(U).where(inArray(U.id, userIds))) : []
  const named = new Map(users.map((user) => [String(user.id), String(user.name ?? user.login ?? '')]))
  return rows
    .map((row): Row => ({ ...row, userName: named.get(String(row.userId)) ?? '' }))
    .sort(
      (a, b) =>
        String(a.addedAt).localeCompare(String(b.addedAt)) || String(a.id).localeCompare(String(b.id)),
    )
}

/** Take somebody off a project. */
export async function removeMember(ctx: Ctx, projectId: string, userId: string): Promise<boolean> {
  const held = (await ctx.db.select('flow.ProjectMember', { projectId, userId }))[0]
  if (!held) return false
  const M = ctx.table('flow.ProjectMember')
  await ctx.db.del(deleteFrom(M).where(eq(M.id, held.id)))
  return true
}

/**
 * A row of a project-scoped table, if the caller may read its project.
 *
 * Every command that starts by loading the record it is about goes through
 * this, so a caller who is not on the project gets the same `null` a missing
 * row gives — and the command answers "not found" without a second branch for
 * "found, but not yours". That the record exists is exactly what a hidden
 * project must not reveal, and a separate refusal would reveal it.
 */
export async function readableRow(ctx: Ctx, model: string, id: unknown): Promise<Row | undefined> {
  const row = (await ctx.db.select(model, { id }))[0]
  if (!row) return undefined
  return (await canReadProject(ctx, row.projectId)) ? row : undefined
}
