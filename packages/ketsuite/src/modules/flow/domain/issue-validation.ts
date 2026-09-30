import type { Ctx, Row } from '@ketvietlab/ketjs'
import { readableProject } from '../membership.ts'
import type { FlowIssue } from './command.ts'
import type { FieldKind } from '../types.ts'
import { issue } from './command.ts'

/**
 * Live, and readable by this caller.
 *
 * Creating an issue in a project somebody cannot see is writing to a project
 * they cannot see, so the same gate answers both. The caller turns a false here
 * into "not found", which is also the right answer for a project that is real
 * but not theirs.
 */
export const projectExists = async (ctx: Ctx, id: unknown): Promise<boolean> => {
  const project = await readableProject(ctx, id)
  return Boolean(project && project.active === true)
}

export const columnOf = async (ctx: Ctx, id: unknown): Promise<Row | null> =>
  (await ctx.db.select('flow.Column', { id, active: true }))[0] ?? null

export const userExists = async (ctx: Ctx, id: unknown): Promise<boolean> =>
  !id || Boolean((await ctx.db.select('user.User', { id, active: true }))[0])

/**
 * A sprint an issue may still be dropped into.
 *
 * `null` reads as "no sprint" (always allowed). A closed sprint is the one
 * state that refuses new membership — see the design note on the Sprint model.
 */
export async function assignableSprint(ctx: Ctx, sprintId: unknown): Promise<Row | null | undefined> {
  if (!sprintId) return null
  const sprint = (await ctx.db.select('flow.Sprint', { id: sprintId }))[0]
  if (!sprint) return undefined
  return sprint.state === 'closed' ? undefined : sprint
}

/**
 * An epic an issue may belong to.
 *
 * `undefined` means "named but not found". Every other reference on an issue
 * — column, sprint, parent — is checked for existence and for belonging to
 * the same project; epic was the one that was written straight through, so an
 * issue in project A could be filed under project B's epic and would then
 * appear on B's epic panel and dependency map while still living on A's board.
 */
export async function issueEpic(ctx: Ctx, epicId: unknown): Promise<Row | null | undefined> {
  if (!epicId) return null
  return (await ctx.db.select('flow.Epic', { id: epicId }))[0] ?? undefined
}

/**
 * A type an issue may be filed as.
 *
 * Checked for existence and for belonging to the same project, which is what
 * `epicId` was not and had to be taught — a reference written straight through
 * puts a row on a board it does not belong to, and every screen downstream
 * then agrees with it.
 */
export async function issueType(ctx: Ctx, typeId: unknown): Promise<Row | null | undefined> {
  if (!typeId) return null
  return (await ctx.db.select('flow.IssueType', { id: typeId }))[0] ?? undefined
}

/** The options a `select` field offers, as codes. */
export const optionCodes = (config: unknown): string[] => {
  const options = (config as { options?: Array<{ code?: unknown }> } | null)?.options
  return Array.isArray(options) ? options.map((option) => String(option?.code ?? '')) : []
}

/**
 * Whether a value is well-formed for the kind of field holding it.
 *
 * Empty always passes and clears the value: a field a team added last week is
 * blank on every issue that already existed, and refusing to save those until
 * somebody fills it in would make adding a field an act of vandalism.
 */
export function fieldValueError(field: Row, raw: unknown): FlowIssue | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  const kind = String(field.kind) as FieldKind
  const bad = (code: string) => issue(`field:${String(field.code)}`, code)
  if (kind === 'number' && !Number.isFinite(Number(value))) return bad('flow.error.fieldNumber')
  if (kind === 'date' && Number.isNaN(Date.parse(value))) return bad('flow.error.fieldDate')
  if (kind === 'bool' && value !== 'true' && value !== 'false') return bad('flow.error.fieldBool')
  // http/https only, the same rule the editor applies to a link it renders:
  // this one ends up in an href on somebody else's screen too.
  if (kind === 'url' && !/^https?:\/\//i.test(value)) return bad('flow.error.fieldUrl')
  if (kind === 'select' && !optionCodes(field.config).includes(value)) return bad('flow.error.fieldOption')
  return null
}

/**
 * The custom fields of one project, by id and by code.
 *
 * Callers name a field either way — a screen posts ids, an agent writing
 * `{ environment: 'production' }` names codes — and both have to land on the
 * same definition.
 */
export async function fieldsOfProject(ctx: Ctx, projectId: unknown): Promise<Map<string, Row>> {
  const defs = await ctx.db.select('flow.FieldDef', { projectId, active: true })
  const by = new Map<string, Row>()
  for (const def of defs) {
    by.set(String(def.id), def)
    by.set(String(def.code), def)
  }
  return by
}

/**
 * A parent an issue may point at.
 *
 * Sub-tasks nest inside one project's board, so a parent from another project
 * would put a child on a board its parent is not on. A cycle is worse: the
 * pair becomes each other's ancestor and any walk up the tree runs forever.
 * `blocks` already refuses cycles for the same reason (see createsBlockCycle);
 * parentage had no check at all, and accepted a parent id that did not exist.
 */
export async function parentIssueError(
  ctx: Ctx,
  issueId: string,
  parentIssueId: unknown,
  projectId: string,
): Promise<FlowIssue | null> {
  if (!parentIssueId) return null
  if (String(parentIssueId) === issueId) return issue('parentIssueId', 'flow.error.selfParent')
  const parent = (await ctx.db.select('flow.Issue', { id: parentIssueId }))[0]
  if (!parent) return issue('parentIssueId', 'flow.error.notFound')
  if (String(parent.projectId) !== projectId)
    return issue('parentIssueId', 'flow.error.parentProjectMismatch')
  const seen = new Set<string>([issueId])
  let at: Row | undefined = parent
  while (at) {
    const id = String(at.id)
    if (seen.has(id)) return issue('parentIssueId', 'flow.error.parentCycle')
    seen.add(id)
    at = at.parentIssueId ? (await ctx.db.select('flow.Issue', { id: at.parentIssueId }))[0] : undefined
  }
  return null
}
