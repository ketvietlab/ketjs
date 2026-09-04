import { randomUUID } from 'node:crypto'
import {
  asc,
  bucketEq,
  compileListFilter,
  dateBucket,
  deleteFrom,
  desc,
  eq,
  from,
  gte,
  inArray,
  isNotNull,
  isNull,
  isTimezone,
  lt,
  not,
  or,
} from '@ketvietlab/ketjs'
import type { Ctx, ListState, Row } from '@ketvietlab/ketjs'
import { ensureThread, followThread, listTimeline, postMessage, unfollowThread } from '../mail/index.ts'
import { DEPENDENCY_RELATIONS, ISSUE_PRIORITIES } from './types.ts'
import type { FieldKind } from './types.ts'
import { emptyIssueListState, FIELD_FILTER_PREFIX, issueListSearch } from './search.ts'

export type FlowIssue = { field: string; code: string; params?: Record<string, unknown> }
export type FlowResult = { ok: boolean; id?: string; errors?: FlowIssue[]; [key: string]: unknown }

export const issue = (field: string, code: string, params?: Record<string, unknown>): FlowIssue => ({
  field,
  code,
  ...(params ? { params } : {}),
})
export const invalid = (...errors: FlowIssue[]): FlowResult => ({ ok: false, errors })
export const now = (): string => new Date().toISOString()

/**
 * The company's civil-date timezone, or UTC when it has none.
 *
 * "Overdue" and "grouped by day" are claims about a calendar, and a calendar
 * belongs to a place. For Flow that place is the company: unlike Hospitality it
 * has no notion of a site, and a company that disagreed with itself about what
 * day it is would make the figures beside a list and the list itself say
 * different things — see FLW-DEC-010.
 *
 * The column is Accounting's by name because Accounting needed a civil date
 * first. It is the company's by meaning, and reading it here is what keeps two
 * settings from having to agree.
 */
export async function businessTimezone(ctx: Ctx): Promise<string> {
  const companyId = ctx.scope?.company
  if (!companyId) return 'UTC'
  const company = (await ctx.db.select('company.Company', { id: companyId }))[0]
  const timezone = String(company?.accountingTimezone ?? '').trim()
  return isTimezone(timezone) ? timezone : 'UTC'
}

/**
 * Today where the company is — which, for most of the day in Vietnam, is not
 * today in UTC. A task due today was being counted late from 07:00 local.
 */
export async function businessToday(ctx: Ctx, timezone?: string): Promise<string> {
  const zone = timezone ?? (await businessTimezone(ctx))
  return dateBucket(new Date().toISOString(), 'day', zone) ?? new Date().toISOString().slice(0, 10)
}
export const n = (value: unknown): number => Number(value ?? 0)

export const normalized = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()

export const actorRequired = (ctx: Ctx): string | null => ctx.actor || null

export const commandKey = (value: unknown): string | null => {
  const key = String(value ?? '').trim()
  return key.length >= 8 && key.length <= 200 ? key : null
}

const projectExists = async (ctx: Ctx, id: unknown): Promise<boolean> =>
  Boolean((await ctx.db.select('flow.Project', { id, active: true }))[0])

const columnOf = async (ctx: Ctx, id: unknown): Promise<Row | null> =>
  (await ctx.db.select('flow.Column', { id, active: true }))[0] ?? null

const userExists = async (ctx: Ctx, id: unknown): Promise<boolean> =>
  !id || Boolean((await ctx.db.select('user.User', { id, active: true }))[0])

/**
 * A sprint an issue may still be dropped into.
 *
 * `null` reads as "no sprint" (always allowed). A closed sprint is the one
 * state that refuses new membership — see the design note on the Sprint model.
 */
async function assignableSprint(ctx: Ctx, sprintId: unknown): Promise<Row | null | undefined> {
  if (!sprintId) return null
  const sprint = (await ctx.db.select('flow.Sprint', { id: sprintId }))[0]
  if (!sprint) return undefined
  return sprint.state === 'closed' ? undefined : sprint
}

/**
 * Subscribes a user to an issue's thread, when the platform can address them.
 *
 * Followers are partner-keyed the whole way down — `mail.Notification`'s
 * `recipientPartnerId` is required — while `user.User.partnerId` is optional
 * by design ("an internal operator needs no entry in the address book"). So a
 * user without one cannot be subscribed and cannot be notified. Skipping is
 * the truthful outcome: the alternative is creating address-book rows as a
 * side effect of assigning a task, which is not a decision this module gets
 * to make.
 */
async function followIssue(ctx: Ctx, threadId: unknown, userId: unknown): Promise<void> {
  if (!threadId || !userId) return
  const user = (await ctx.db.select('user.User', { id: userId }))[0]
  if (!user?.partnerId) return
  await followThread(ctx, {
    id: `${String(threadId)}:${String(user.partnerId)}`,
    threadId: String(threadId),
    partnerId: String(user.partnerId),
  })
}

/**
 * The partners behind a list of mentioned users.
 *
 * Mentions are partner-keyed the whole way down, the same as followers, so a
 * user without a partner cannot be mentioned any more than they can be
 * notified — see `followIssue` above for why that is the platform's shape
 * rather than something to work around here. They are dropped rather than
 * refused: a comment naming five people should still reach the four the system
 * can address.
 */
async function mentionPartners(ctx: Ctx, userIds: readonly string[]): Promise<string[]> {
  const wanted = [...new Set(userIds.filter(Boolean).map(String))]
  if (!wanted.length) return []
  const U = ctx.table('user.User')
  const users = await ctx.db.all(from(U).where(inArray(U.id, wanted)))
  return [
    ...new Set(
      users
        .map((user) => user.partnerId)
        .filter(Boolean)
        .map(String),
    ),
  ]
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
async function issueEpic(ctx: Ctx, epicId: unknown): Promise<Row | null | undefined> {
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
async function issueType(ctx: Ctx, typeId: unknown): Promise<Row | null | undefined> {
  if (!typeId) return null
  return (await ctx.db.select('flow.IssueType', { id: typeId }))[0] ?? undefined
}

/** The options a `select` field offers, as codes. */
const optionCodes = (config: unknown): string[] => {
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
async function fieldsOfProject(ctx: Ctx, projectId: unknown): Promise<Map<string, Row>> {
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
async function parentIssueError(
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

/**
 * How far along each issue is, counted from its sub-tasks.
 *
 * "Done" is a sub-task sitting in a column with `terminalState` — the concept
 * models.ts introduced for exactly this kind of question, so that a team whose
 * workflow is five columns wide gets the same answer as one running three, and
 * neither has to be called "Done".
 *
 * Sub-tasks are the checklist. The description can hold one too, and does, but
 * that one is prose: nobody can be given an item in it, nothing can be counted
 * from outside the document, and it is not what this reads.
 *
 * Unlimited on purpose, unlike `dependenciesFor` below. The query is already
 * bounded twice over — by one page of parents, and by sub-tasks being a
 * relation a person types out by hand — and a cap on a *count* is worse than a
 * cap on a list: a truncated list looks truncated, while 3/5 that should read
 * 3/9 just looks wrong.
 */
async function progressOf(
  ctx: Ctx,
  issueIds: string[],
): Promise<Map<string, { done: number; total: number }>> {
  const tally = new Map<string, { done: number; total: number }>()
  if (!issueIds.length) return tally
  const I = ctx.table('flow.Issue')
  const children = await ctx.db.all(
    from(I).where(inArray(I.parentIssueId, issueIds)).where(eq(I.active, true)),
  )
  if (!children.length) return tally
  const C = ctx.table('flow.Column')
  const columnIds = [...new Set(children.map((child) => String(child.columnId)))]
  const columns = await ctx.db.all(from(C).where(inArray(C.id, columnIds)))
  const terminal = new Set(
    columns.filter((column) => column.terminalState).map((column) => String(column.id)),
  )
  for (const child of children) {
    const key = String(child.parentIssueId)
    const at = tally.get(key) ?? { done: 0, total: 0 }
    at.total += 1
    if (terminal.has(String(child.columnId))) at.done += 1
    tally.set(key, at)
  }
  return tally
}

export async function serializeIssueList(ctx: Ctx, rows: Row[]): Promise<Row[]> {
  const ids = (values: unknown[]): string[] => [...new Set(values.filter(Boolean).map(String))]
  const columnIds = ids(rows.map((row) => row.columnId))
  const epicIds = ids(rows.map((row) => row.epicId))
  const sprintIds = ids(rows.map((row) => row.sprintId))
  const userIds = ids(rows.map((row) => row.assigneeUserId))
  const typeIds = ids(rows.map((row) => row.typeId))
  const issueIds = rows.map((row) => String(row.id))
  // The project too, for the one list that spans them: an issue read outside
  // its own board has to say which board it came from.
  const projectIds = ids(rows.map((row) => row.projectId))
  const [columns, epics, sprints, users, projects, types, progress, values] = await Promise.all([
    columnIds.length
      ? ctx.db.all(from(ctx.table('flow.Column')).where(inArray(ctx.table('flow.Column').id, columnIds)))
      : [],
    epicIds.length
      ? ctx.db.all(from(ctx.table('flow.Epic')).where(inArray(ctx.table('flow.Epic').id, epicIds)))
      : [],
    sprintIds.length
      ? ctx.db.all(from(ctx.table('flow.Sprint')).where(inArray(ctx.table('flow.Sprint').id, sprintIds)))
      : [],
    userIds.length
      ? ctx.db.all(from(ctx.table('user.User')).where(inArray(ctx.table('user.User').id, userIds)))
      : [],
    projectIds.length
      ? ctx.db.all(from(ctx.table('flow.Project')).where(inArray(ctx.table('flow.Project').id, projectIds)))
      : [],
    typeIds.length
      ? ctx.db.all(from(ctx.table('flow.IssueType')).where(inArray(ctx.table('flow.IssueType').id, typeIds)))
      : [],
    progressOf(ctx, issueIds),
    // Custom field values for the whole page in one query, so a list can show
    // a column for them. Keyed by field id rather than code, because a screen
    // holds the definitions and matches on what it was given.
    issueIds.length
      ? ctx.db.all(
          from(ctx.table('flow.IssueFieldValue')).where(
            inArray(ctx.table('flow.IssueFieldValue').issueId, issueIds),
          ),
        )
      : [],
  ])
  const by = (values: Row[]) => new Map(values.map((row) => [String(row.id), row]))
  const columnBy = by(columns)
  const epicBy = by(epics)
  const sprintBy = by(sprints)
  const userBy = by(users)
  const projectBy = by(projects)
  const typeBy = by(types)
  const fieldsBy = new Map<string, Record<string, unknown>>()
  for (const entry of values) {
    const key = String(entry.issueId)
    const held = fieldsBy.get(key) ?? {}
    held[String(entry.fieldId)] = entry.value
    fieldsBy.set(key, held)
  }
  return rows.map((row) => {
    const counted = progress.get(String(row.id))
    return {
      ...row,
      /**
       * The day a bar starts, which is not the same fact as `startDate`.
       *
       * Nobody sets a start date on most issues, and a chart still has to
       * begin somewhere; the day it was written down is the honest stand-in.
       * Kept separate from the stored value on purpose — a form bound to this
       * would show the fallback as an answer, and saving would then write it
       * back as one.
       */
      startsOn: row.startDate ?? (row.createdAt ? String(row.createdAt).slice(0, 10) : null),
      subtaskTotal: counted?.total ?? 0,
      subtaskDone: counted?.done ?? 0,
      /**
       * Null, not zero, when an issue has no sub-tasks. "Nothing to do" and
       * "nothing done yet" are different facts, and a column of 0% against every
       * issue nobody had broken down would report the second while meaning the
       * first.
       */
      progress: counted ? Math.round((counted.done * 100) / counted.total) : null,
      projectName: row.projectId ? (projectBy.get(String(row.projectId))?.name ?? row.projectId) : null,
      columnName: row.columnId ? (columnBy.get(String(row.columnId))?.name ?? row.columnId) : null,
      /**
       * Whether this issue's column is one the board treats as finished.
       *
       * The name alone cannot answer it — "Done", "Shipped" and "Closed" are
       * all somebody's terminal column and none of them is a keyword — so a
       * screen wanting to mark a late issue would have to re-read the columns
       * it was just handed.
       */
      terminal: row.columnId ? columnBy.get(String(row.columnId))?.terminalState === true : false,
      epicTitle: row.epicId ? (epicBy.get(String(row.epicId))?.title ?? row.epicId) : null,
      sprintName: row.sprintId ? (sprintBy.get(String(row.sprintId))?.name ?? row.sprintId) : null,
      assigneeName: row.assigneeUserId
        ? (userBy.get(String(row.assigneeUserId))?.name ?? row.assigneeUserId)
        : null,
      /** `{ [fieldId]: value }`, for whatever fields this row happens to hold. */
      fieldValues: fieldsBy.get(String(row.id)) ?? {},
      typeName: row.typeId ? (typeBy.get(String(row.typeId))?.name ?? row.typeId) : null,
      typeColor: row.typeId ? (typeBy.get(String(row.typeId))?.color ?? null) : null,
    }
  })
}

/**
 * How many issues one custom-field filter may match.
 *
 * The value lives in another table and this query builder has no JOIN, so the
 * rule is answered by collecting ids and handing them to `IN (...)`. That list
 * becomes SQL parameters, and every database has a ceiling on those — SQLite's
 * has historically been 999.
 *
 * Capped rather than left to fail at the driver, and reported rather than
 * trimmed quietly: a truncated *list* looks truncated, while a truncated
 * *filter* looks like an answer. `listIssues` passes `fieldFilterTruncated`
 * back so a screen can say so.
 */
export const FIELD_FILTER_MATCHES = 900

type FieldFilterOutcome = { state: ListState; ids: string[] | null; truncated: boolean }

/**
 * Answers every `field:<code>` rule as a set of issue ids, and takes the rules
 * out of the state on the way.
 *
 * The value lives in another table, so the rule cannot compile against a column
 * of `flow.Issue`. Rewriting it in place does not work either — the spec
 * declares a select field's `choices`, and a list of ids is not among them, so
 * validation refuses the rewritten rule. So the rules leave, and what they
 * selected is applied to the query directly.
 *
 * Only the top level is read, which is the only shape the filter UI builds
 * (facets and the custom-filter row are both flat, and flat means AND). A rule
 * nested inside an `or` group is left where it is rather than quietly hoisted
 * out of it: removing one from an `or` widens the group, and answering a
 * narrower question than was asked is the failure that looks like success.
 */
async function resolveFieldFilters(
  ctx: Ctx,
  state: ListState,
  projectId: unknown,
): Promise<FieldFilterOutcome> {
  const top = (state.filters ?? []) as Array<Record<string, unknown>>
  const rules = top.filter(
    (node) => node?.kind === 'rule' && String(node.field ?? '').startsWith(FIELD_FILTER_PREFIX),
  )
  if (!rules.length) return { state, ids: null, truncated: false }
  const defs = await ctx.db.select(
    'flow.FieldDef',
    projectId ? { projectId, active: true } : { active: true },
  )
  const byCode = new Map(defs.map((def) => [String(def.code), def]))
  let truncated = false
  let matched: Set<string> | null = null

  for (const rule of rules) {
    const code = String(rule.field).slice(FIELD_FILTER_PREFIX.length)
    const def = byCode.get(code)
    const found = new Set<string>()
    if (def) {
      const V = ctx.table('flow.IssueFieldValue')
      let query = from(V).where(eq(V.fieldId, def.id))
      const operator = String(rule.operator)
      if (operator === 'equals') query = query.where(eq(V.value, String(rule.value ?? '')))
      else if (operator === 'anyOf') {
        const values = (Array.isArray(rule.value) ? rule.value : [rule.value]).map(String)
        query = query.where(inArray(V.value, values))
      }
      // `isSet` needs no clause of its own: a row exists only where there is a
      // value, because emptying a field deletes its row rather than storing "".
      const rows = await ctx.db.all(query.limit(FIELD_FILTER_MATCHES + 1))
      if (rows.length > FIELD_FILTER_MATCHES) truncated = true
      for (const row of rows.slice(0, FIELD_FILTER_MATCHES)) found.add(String(row.issueId))
    }
    // Several rules narrow each other, which is what a flat filter row means.
    matched = matched ? new Set([...matched].filter((id: string) => found.has(id))) : found
  }

  return {
    state: { ...state, filters: top.filter((node) => !rules.includes(node)) as ListState['filters'] },
    ids: [...(matched ?? new Set<string>())],
    truncated,
  }
}

const listStateOf = (value: unknown): ListState | null =>
  value && typeof value === 'object' ? (value as ListState) : null

/**
 * The columns a board treats as finished, and the one it starts from.
 *
 * Read once and shared, because "late" and "not started" both need them and
 * two readings could disagree. A finished issue is never late, however long
 * ago its date was — the work is done, and a red date on it would be asking
 * for something that has already happened.
 */
const boardEdges = async (ctx: Ctx): Promise<{ terminal: string[]; first: string[] }> => {
  const C = ctx.table('flow.Column')
  const columns = await ctx.db.all(from(C).where(eq(C.active, true)))
  const firstOf = new Map<string, { id: string; sequence: number }>()
  for (const column of columns) {
    if (column.terminalState) continue
    const key = String(column.projectId)
    const held = firstOf.get(key)
    const at = { id: String(column.id), sequence: n(column.sequence) }
    if (!held || at.sequence < held.sequence) firstOf.set(key, at)
  }
  return {
    terminal: columns.filter((column) => column.terminalState).map((column) => String(column.id)),
    first: [...firstOf.values()].map((column) => column.id),
  }
}

const issueQuery = async (ctx: Ctx, args: Record<string, unknown>) => {
  const I = ctx.table('flow.Issue')
  const given = listStateOf(args.listState) ?? emptyIssueListState()
  // A caller may still name a timezone — an agent reporting for somewhere else
  // — but no caller has to, and the screens no longer do. The default is the
  // company's own calendar rather than UTC, which was nobody's calendar.
  const timezone = String(args.timezone ?? '').trim() || (await businessTimezone(ctx))
  let query = from(I)
  // The spec has to know the project's own fields, or `parseListState` would
  // have dropped their rules as unknown before they ever reached here.
  const defs = args.projectId
    ? await ctx.db.select('flow.FieldDef', { projectId: args.projectId, active: true })
    : []
  const { state, ids, truncated } = await resolveFieldFilters(ctx, given, args.projectId)
  const spec = issueListSearch(I, defs)
  const compiled = compileListFilter(spec, state, { timezone })
  if (compiled) query = query.where(compiled)
  // No match is not "no filter": asking for a value nothing holds has to answer
  // with nothing, which an empty list already does — `query.ts` compiles an
  // empty `IN` to `1 = 0` rather than to no clause at all.
  if (ids) query = query.where(inArray(I.id, ids))
  const path = Array.isArray(args.path) ? args.path : []
  for (let index = 0; index < path.length; index++) {
    const selected = state.groupBy[index]
    const field = spec.groupable?.find((candidate) => candidate.key === selected?.key)
    if (!field) continue
    const value = path[index]
    query = query.where(
      selected?.interval
        ? bucketEq(field.col, selected.interval, timezone, String(value))
        : eq(field.col, value),
    )
  }
  if (args.projectId) query = query.where(eq(I.projectId, args.projectId))
  if (args.columnId) query = query.where(eq(I.columnId, args.columnId))
  if (args.epicId) query = query.where(eq(I.epicId, args.epicId))
  if (args.sprintId) query = query.where(eq(I.sprintId, args.sprintId))
  if (args.assigneeUserId) query = query.where(eq(I.assigneeUserId, args.assigneeUserId))
  // "Assigned to me" is resolved here rather than by the caller: a screen has
  // no cheap way to learn who is signed in, and `activity.listMy` already
  // settles the question the same way. A request with no actor matches
  // nothing, which is the safe reading of "mine".
  if (args.mine === true) query = query.where(eq(I.assigneeUserId, ctx.actor ?? '\u0000'))
  // A day, and the query narrows to what was already due before it and is not
  // finished. Here rather than at each caller so the list, the counts and the
  // rail cannot drift apart on what "late" means.
  if (args.overdueOn) {
    const { terminal } = await boardEdges(ctx)
    query = query.where(
      isNotNull(I.dueDate),
      lt(I.dueDate, String(args.overdueOn)),
      ...(terminal.length ? [not(inArray(I.columnId, terminal))] : []),
    )
  }
  if (!state.includeArchived && args.includeArchived !== true) query = query.where(eq(I.active, true))
  const sorts = state.sort.length ? state.sort : emptyIssueListState().sort
  const sortable = new Map((spec.sortable ?? []).map((field) => [field.key, field.col]))
  for (const sort of sorts) {
    const col = sortable.get(sort.key)
    if (col) query = query.orderBy(sort.dir === 'desc' ? desc(col) : asc(col))
  }
  return { query, state, spec, timezone, truncated }
}

export async function listIssues(
  ctx: Ctx,
  args: Record<string, unknown>,
): Promise<{
  rows: Row[]
  total: number
  nextCursor: string | null
  fieldFilterTruncated?: boolean
}> {
  const { query, truncated } = await issueQuery(ctx, args)
  const offset = Math.max(0, Number.parseInt(String(args.cursor ?? '0'), 10) || 0)
  const limit = Math.max(1, Math.min(200, n(args.limit ?? 50)))
  const [total, page] = await Promise.all([
    ctx.db.count(query),
    ctx.db.all(query.limit(limit).offset(offset)),
  ])
  return {
    rows: await serializeIssueList(ctx, page),
    total,
    nextCursor: offset + limit < total ? String(offset + limit) : null,
    // Only said when it happened. A filter that quietly stopped short reads as
    // an answer, which is the one thing it must not do.
    ...(truncated ? { fieldFilterTruncated: true } : {}),
  }
}

export async function groupIssues(ctx: Ctx, args: Record<string, unknown>) {
  const { query, state, spec, timezone } = await issueQuery(ctx, args)
  const path = Array.isArray(args.path) ? args.path : []
  const selected = state.groupBy[path.length]
  const field = spec.groupable?.find((candidate) => candidate.key === selected?.key)
  if (!field) return []
  let grouped = query
    .groupBy({ col: field.col, interval: selected?.interval, timezone })
    .orderGroupsBy({ by: 'key', dir: 'asc' })
  if (args.limit != null) grouped = grouped.limit(Number(args.limit))
  if (args.offset != null) grouped = grouped.offset(Number(args.offset))
  return ctx.db.group(grouped)
}

/**
 * How the issues in view divide up: finished, late, not started, under way.
 *
 * Counted, not listed. Each figure is a `count` over the same query the list
 * itself runs, so a board of a thousand issues costs four counts rather than a
 * thousand rows — and every bucket answers the question the list is already
 * filtered by, instead of describing something wider than what is on screen.
 *
 * The four are disjoint and add up to the total, which is the only way a row of
 * figures beside a list is readable at all:
 *
 *   done      the issue sits in a column marked `terminalState`
 *   overdue   not done, has a due date, and that date has passed
 *   waiting   not done, not overdue, in the first column of its board
 *   working   everything else that is not done
 *
 * "First column" is what stands in for "not started". A project has no such
 * flag, but a board is ordered and its first column is where work lands before
 * anyone picks it up — see `Column.sequence`. It is a reading of real rows
 * rather than a status nobody sets.
 */
export type IssueBuckets = {
  total: number
  done: number
  overdue: number
  waiting: number
  working: number
  /** The civil date these counts were taken against, for the screen to reuse. */
  today: string
}

export async function issueBuckets(
  ctx: Ctx,
  args: Record<string, unknown>,
  today?: string,
): Promise<IssueBuckets> {
  const { query, timezone } = await issueQuery(ctx, args)
  // The same calendar the query was compiled against, so the overdue count and
  // the list it sits beside cannot disagree about where the day ends.
  const day = String(today ?? '').trim() || (await businessToday(ctx, timezone))
  const I = ctx.table('flow.Issue')
  const { terminal, first } = await boardEdges(ctx)

  // `count` rather than `all`: none of these needs the rows.
  const open = terminal.length ? [not(inArray(I.columnId, terminal))] : []
  const [total, done, overdue, waiting] = await Promise.all([
    ctx.db.count(query),
    terminal.length ? ctx.db.count(query.where(inArray(I.columnId, terminal))) : Promise.resolve(0),
    ctx.db.count(query.where(...open, isNotNull(I.dueDate), lt(I.dueDate, day))),
    first.length
      ? ctx.db.count(
          query.where(...open, inArray(I.columnId, first), or(isNull(I.dueDate), gte(I.dueDate, day))),
        )
      : Promise.resolve(0),
  ])
  return {
    total,
    done,
    overdue,
    waiting,
    working: Math.max(0, total - done - overdue - waiting),
    today: day,
  }
}

export async function issueDetail(ctx: Ctx, id: string): Promise<Row | null> {
  const row = (await ctx.db.select('flow.Issue', { id }))[0]
  if (!row) return null
  const [serialized] = await serializeIssueList(ctx, [row])
  const [tags, outgoing, incoming, comments, children] = await Promise.all([
    ctx.db.select('flow.IssueTag', { issueId: id }),
    ctx.db.select('flow.IssueDependency', { issueId: id }),
    ctx.db.select('flow.IssueDependency', { dependsOnIssueId: id }),
    listTimeline(ctx, String(row.threadId), { limit: 100 }),
    // Sub-tasks. `parentIssueId` has been modelled, validated for project and
    // for cycles since the start, and until now had no screen at all — the
    // detail page is the only place the relationship reads from either end.
    ctx.db.select('flow.Issue', { parentIssueId: id, active: true }),
  ])
  const tagIds = tags.map((row) => row.tagId)
  const tagRows = tagIds.length
    ? await ctx.db.all(from(ctx.table('flow.Tag')).where(inArray(ctx.table('flow.Tag').id, tagIds)))
    : []
  // The far side of each dependency, by id and in one query — the same shape
  // serializeIssueList already uses for column/epic/sprint/assignee. A screen
  // that resolved these itself could only do it by listing the project's
  // issues and filtering, which silently prints a raw id for any dependency
  // outside that page: `issue.options` caps at 100 rows, so a 1000-issue
  // project showed uuids for every dependency older than the newest hundred.
  const relatedIds = [
    ...new Set([...outgoing.map((row) => row.dependsOnIssueId), ...incoming.map((row) => row.issueId)]),
  ].map(String)
  const relatedRows = relatedIds.length
    ? await ctx.db.all(from(ctx.table('flow.Issue')).where(inArray(ctx.table('flow.Issue').id, relatedIds)))
    : []
  const titleOf = new Map(relatedRows.map((row) => [String(row.id), String(row.title)]))
  // Every field this project defines, each carrying whatever this issue holds
  // for it — the definitions, not just the answers, because a field nobody has
  // filled in still has to appear on the form for anyone to fill it in.
  const [defs, held] = await Promise.all([
    ctx.db.select('flow.FieldDef', { projectId: row.projectId, active: true }),
    ctx.db.select('flow.IssueFieldValue', { issueId: id }),
  ])
  const answerOf = new Map(held.map((entry) => [String(entry.fieldId), entry.value]))
  const fields = defs
    .sort((a, b) => n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id)))
    .map((def) => ({ ...def, value: answerOf.get(String(def.id)) ?? null }))
  const parent = row.parentIssueId
    ? ((await ctx.db.select('flow.Issue', { id: row.parentIssueId }))[0] ?? null)
    : null
  return {
    ...serialized!,
    parentTitle: parent ? String(parent.title) : null,
    fields,
    following: await following(ctx, id),
    children: await serializeIssueList(ctx, children),
    tags: tagRows,
    dependencies: outgoing.map((row) => ({
      ...row,
      dependsOnTitle: titleOf.get(String(row.dependsOnIssueId)) ?? row.dependsOnIssueId,
    })),
    dependents: incoming.map((row) => ({
      ...row,
      issueTitle: titleOf.get(String(row.issueId)) ?? row.issueId,
    })),
    comments,
  }
}

/**
 * Blocking dependencies leading into a given set of issues, batched — the map
 * view (flow_backend's dependency atlas, one epic at a time) needs the edges
 * among its own node set, not the per-issue read `issueDetail` already does.
 * No JOIN in this query builder by design, so this is one query against
 * `IssueDependency` alone.
 *
 * Both ends are matched by default: an edge pointing out of the set is not an
 * edge of the set. The map opts into outgoing edges so it can page a large
 * source set in bounded chunks, then filters both ends against the complete
 * epic after aggregation. The id list remains capped because it arrives over
 * HTTP.
 */
export const DEPENDENCY_BATCH = 200

export async function dependenciesFor(
  ctx: Ctx,
  issueIds: readonly string[],
  includeExternalTargets = false,
): Promise<Row[]> {
  const ids = [...new Set(issueIds.map(String))].slice(0, DEPENDENCY_BATCH)
  if (!ids.length) return []
  const D = ctx.table('flow.IssueDependency')
  const held = new Set(ids)
  const rows = await ctx.db.all(from(D).where(inArray(D.issueId, ids), eq(D.relation, 'blocks')))
  return includeExternalTargets ? rows : rows.filter((row) => held.has(String(row.dependsOnIssueId)))
}

export type SaveIssueInput = {
  id: string
  projectId: string
  columnId: string
  typeId?: string | null
  epicId?: string | null
  sprintId?: string | null
  parentIssueId?: string | null
  title: string
  assigneeUserId?: string | null
  priority?: string
  startDate?: string | null
  dueDate?: string | null
  estimate?: unknown
  tagIds?: string[]
  /** Custom field values, keyed by field id or by field code. */
  fields?: Record<string, unknown>
  expectedVersion?: number
  idempotencyKey: string
}

export async function saveIssue(ctx: Ctx, input: SaveIssueInput): Promise<FlowResult> {
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!String(input.title ?? '').trim()) return invalid(issue('title', 'flow.error.required'))
  if (!ISSUE_PRIORITIES.includes(String(input.priority ?? 'normal') as never))
    return invalid(issue('priority', 'flow.error.invalidPriority'))
  if (!(await projectExists(ctx, input.projectId))) return invalid(issue('projectId', 'flow.error.notFound'))
  const column = await columnOf(ctx, input.columnId)
  if (!column || String(column.projectId) !== String(input.projectId))
    return invalid(issue('columnId', 'flow.error.invalidColumn'))
  if (!(await userExists(ctx, input.assigneeUserId)))
    return invalid(issue('assigneeUserId', 'flow.error.notFound'))
  const sprint = await assignableSprint(ctx, input.sprintId)
  if (sprint === undefined) return invalid(issue('sprintId', 'flow.error.sprintClosed'))
  if (sprint && String(sprint.projectId) !== String(input.projectId))
    return invalid(issue('sprintId', 'flow.error.sprintProjectMismatch'))
  const epic = await issueEpic(ctx, input.epicId)
  if (epic === undefined) return invalid(issue('epicId', 'flow.error.notFound'))
  if (epic && String(epic.projectId) !== String(input.projectId))
    return invalid(issue('epicId', 'flow.error.epicProjectMismatch'))
  const kind = await issueType(ctx, input.typeId)
  if (kind === undefined) return invalid(issue('typeId', 'flow.error.notFound'))
  if (kind && String(kind.projectId) !== String(input.projectId))
    return invalid(issue('typeId', 'flow.error.typeProjectMismatch'))
  return ctx.tx(async (tx) => {
    const existing = (await tx.db.select('flow.Issue', { id: input.id }))[0]
    if (existing && String(existing.projectId) !== String(input.projectId))
      return invalid(issue('projectId', 'flow.error.immutableProject'))
    // moveIssue is the only door into a column, because it is the one that
    // checks `blocks` dependencies before letting an issue reach a terminal
    // state. Save used to keep `existing.columnId` and still answer ok, so a
    // caller asking for a different column was told the move had happened.
    if (existing && String(existing.columnId) !== String(input.columnId))
      return invalid(issue('columnId', 'flow.error.columnNeedsMove'))
    const parentError = await parentIssueError(tx, input.id, input.parentIssueId, String(input.projectId))
    if (parentError) return invalid(parentError)
    // Resolved before the issue row is touched: `tx` only rolls back on a
    // thrown exception, not on a plain `return invalid(...)`, so validating
    // tags after the insert/compareAndSet below committed a half-written
    // issue (row present, no tags, caller told `ok: false`) on every bad
    // tagId — found by seeding 1000 issues and finding "failed" ones that
    // existed anyway.
    const tagIds = input.tagIds ? [...new Set(input.tagIds)] : null
    if (tagIds) {
      const tags = tagIds.length
        ? await tx.db.all(
            from(tx.table('flow.Tag')).where(
              inArray(tx.table('flow.Tag').id, tagIds),
              eq(tx.table('flow.Tag').active, true),
            ),
          )
        : []
      if (tags.length !== tagIds.length) return invalid(issue('tagIds', 'flow.error.notFound'))
    }
    // Custom field values, resolved and checked here for the same reason the
    // tags above are: `tx` rolls back on a thrown exception, not on a returned
    // `invalid`, so anything validated after the write below leaves a
    // half-written issue behind and still reports failure.
    const fieldWrites: Array<{ field: Row; value: string }> = []
    if (input.fields) {
      const defs = await fieldsOfProject(tx, input.projectId)
      for (const [key, raw] of Object.entries(input.fields)) {
        const field = defs.get(String(key))
        // A field this project does not have, rather than one that is merely
        // empty: naming it is a mistake worth reporting, the same as an epic
        // from another board.
        if (!field) return invalid(issue(`field:${key}`, 'flow.error.fieldUnknown'))
        const error = fieldValueError(field, raw)
        if (error) return invalid(error)
        fieldWrites.push({ field, value: String(raw ?? '').trim() })
      }
    }
    const timestamp = now()
    const nextVersion = n(existing?.version) + 1
    // A reference the caller did not mention keeps what is stored; an
    // explicit null clears it. `priority` and `estimate` below already read
    // this way, but epic, sprint, parent, assignee and due date did not — so
    // any caller sending a partial record silently cleared the rest. The
    // issue detail screen is exactly that caller: its form carries no sprint
    // and no parent field (both have their own action), so editing a title
    // dropped the issue out of its sprint and orphaned its sub-task link.
    const kept = <T>(given: T | null | undefined, stored: unknown): unknown =>
      given === undefined ? (stored ?? null) : given || null
    const values: Row = {
      projectId: input.projectId,
      columnId: existing ? existing.columnId : input.columnId,
      typeId: input.typeId === undefined ? (existing?.typeId ?? null) : kind ? kind.id : null,
      epicId: input.epicId === undefined ? (existing?.epicId ?? null) : epic ? epic.id : null,
      sprintId: input.sprintId === undefined ? (existing?.sprintId ?? null) : sprint ? sprint.id : null,
      parentIssueId: kept(input.parentIssueId, existing?.parentIssueId),
      title: input.title.trim(),
      assigneeUserId: kept(input.assigneeUserId, existing?.assigneeUserId),
      priority: input.priority ?? existing?.priority ?? 'normal',
      startDate: kept(input.startDate, existing?.startDate),
      dueDate: kept(input.dueDate, existing?.dueDate),
      estimate: input.estimate == null ? (existing?.estimate ?? null) : String(input.estimate),
      active: true,
      version: nextVersion,
      updatedAt: timestamp,
    }
    let threadId: string
    if (existing) {
      const expected = input.expectedVersion ?? n(existing.version)
      const changed = await tx.db.compareAndSet('flow.Issue', { id: input.id }, { version: expected }, values)
      if (!('dryRun' in changed) && !changed.matched)
        return invalid(issue('version', 'flow.error.conflict', { current: existing.version }))
      threadId = String(existing.threadId)
    } else {
      const thread = await ensureIssueThread(tx, input.id, input.title.trim(), timestamp)
      threadId = String(thread.id)
      await tx.db.insert('flow.Issue', {
        id: input.id,
        ...values,
        threadId: thread.id,
        createdByUserId: tx.actor ?? null,
        createdAt: timestamp,
      })
    }
    if (tagIds) {
      const IT = tx.table('flow.IssueTag')
      await tx.db.del(deleteFrom(IT).where(eq(IT.issueId, input.id)))
      for (const tagId of tagIds)
        await tx.db.insertIfAbsent('flow.IssueTag', { id: `${input.id}:${tagId}`, issueId: input.id, tagId })
    }
    // One row per issue and field, so a value is replaced rather than
    // accumulated. Emptying one deletes the row instead of storing "": a field
    // nobody has answered and a field answered with nothing read the same on
    // screen, and only one of them should cost a row.
    for (const { field, value } of fieldWrites) {
      const id = `${input.id}:${String(field.id)}`
      if (!value) {
        const V = tx.table('flow.IssueFieldValue')
        await tx.db.del(deleteFrom(V).where(eq(V.id, id)))
        continue
      }
      // insertIfAbsent then update, rather than branching on whether the row
      // exists: `db.update` answers with a result object either way, so there
      // is nothing truthy to branch on, and the pair is correct in both cases.
      await tx.db.insertIfAbsent('flow.IssueFieldValue', {
        id,
        issueId: input.id,
        fieldId: field.id,
        value,
      })
      await tx.db.update('flow.IssueFieldValue', { id }, { value })
    }

    // Whoever opened it, and whoever it lands on, are subscribed to its
    // thread. Until this existed the thread had no followers at all, so
    // `postMessage` addressed nobody and every comment notified nobody — the
    // discussion feature was wired end to end and silently inert.
    if (!existing) await followIssue(tx, threadId, tx.actor)
    const assignee = values.assigneeUserId
    if (assignee) await followIssue(tx, threadId, assignee)
    // Only what actually moved: a system entry on every title edit is noise,
    // and the timeline is the one place that has to stay readable.
    const handedOver =
      assignee && String(assignee) !== String(existing?.assigneeUserId ?? '')
        ? [
            {
              field: 'assigneeUserId',
              ...(existing?.assigneeUserId ? { oldValue: String(existing.assigneeUserId) } : {}),
              newValue: String(assignee),
            },
          ]
        : []
    const rescheduled = existing
      ? [
          ...moved('dueDate', existing.dueDate, values.dueDate),
          ...moved('priority', existing.priority, values.priority),
        ]
      : []
    if (handedOver.length || rescheduled.length)
      await postMessage(tx, {
        id: `${input.id}:assigned:${nextVersion}`,
        threadId,
        authorUserId: tx.actor ?? undefined,
        kind: 'system',
        // A message key, resolved by whoever renders the timeline — the same
        // arrangement crm_backend's `entryBody` already reads. Handing an issue
        // over keeps its own key, because that is the entry people look for.
        body: rescheduled.length && !handedOver.length ? 'flow.timeline.changed' : 'flow.timeline.assigned',
        tracking: [...handedOver, ...rescheduled],
      })
    return { ok: true, id: input.id, version: nextVersion }
  })
}

/**
 * One system entry per command, carrying every tracked field that moved.
 *
 * The timeline used to record exactly one thing — who an issue was handed to —
 * so "who put this in Done, and when" had no answer anywhere in the system. The
 * fields tracked are the ones a person asks about afterwards: the column, the
 * deadline, the priority and the sprint. Title and description are deliberately
 * out: an entry per keystroke is what makes a timeline unreadable, and both
 * already have their own history in the Live Doc.
 *
 * One message rather than one per field, because a single edit that moved three
 * of them is one thing that happened.
 */
async function trackIssueChange(
  tx: Ctx,
  input: {
    issueId: string
    threadId: unknown
    version: number
    body: string
    changes: Array<{ field: string; oldValue?: string; newValue?: string }>
  },
): Promise<void> {
  if (!input.changes.length || !input.threadId) return
  await postMessage(tx, {
    id: `${input.issueId}:changed:${input.version}`,
    threadId: String(input.threadId),
    authorUserId: tx.actor ?? undefined,
    kind: 'system',
    body: input.body,
    tracking: input.changes,
  })
}

/** A change worth an entry, or nothing when the value did not actually move. */
const moved = (
  field: string,
  before: unknown,
  after: unknown,
): Array<{ field: string; oldValue?: string; newValue?: string }> => {
  const from = before == null || before === '' ? '' : String(before)
  const to = after == null || after === '' ? '' : String(after)
  if (from === to) return []
  return [{ field, ...(from ? { oldValue: from } : {}), ...(to ? { newValue: to } : {}) }]
}

async function ensureIssueThread(ctx: Ctx, issueId: string, title: string, createdAt: string): Promise<Row> {
  return ensureThread(ctx, {
    id: `thread:flow.Issue:${issueId}`,
    resModel: 'flow.Issue',
    resId: issueId,
    displayName: title,
    createdAt,
  })
}

/**
 * A `blocks` dependency that has not itself reached a terminal column keeps the
 * blocked issue out of one too — the one place the fixed dependency vocabulary
 * (see types.ts) drives actual behavior instead of just being a label.
 */
export async function moveIssue(
  ctx: Ctx,
  input: { id: string; columnId: string; expectedVersion: number; idempotencyKey: string },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  return ctx.tx(async (tx) => {
    const held = (await tx.db.select('flow.Issue', { id: input.id }))[0]
    if (!held) return invalid(issue('id', 'flow.error.notFound'))
    const column = await columnOf(tx, input.columnId)
    if (!column || String(column.projectId) !== String(held.projectId))
      return invalid(issue('columnId', 'flow.error.invalidColumn'))
    if (column.terminalState === true) {
      const blockers = (
        await tx.db.select('flow.IssueDependency', { issueId: input.id, relation: 'blocks' })
      ).map((row) => String(row.dependsOnIssueId))
      if (blockers.length) {
        const blockingIssues = await tx.db.all(
          from(tx.table('flow.Issue')).where(inArray(tx.table('flow.Issue').id, blockers)),
        )
        const columnIds = [...new Set(blockingIssues.map((row) => String(row.columnId)))]
        const blockingColumns = columnIds.length
          ? await tx.db.all(
              from(tx.table('flow.Column')).where(inArray(tx.table('flow.Column').id, columnIds)),
            )
          : []
        const terminal = new Set(
          blockingColumns.filter((row) => row.terminalState === true).map((row) => String(row.id)),
        )
        const open = blockingIssues.filter((row) => !terminal.has(String(row.columnId)))
        if (open.length) return invalid(issue('columnId', 'flow.error.blocked'))
      }
    }
    const timestamp = now()
    const changed = await tx.db.compareAndSet(
      'flow.Issue',
      { id: input.id },
      { version: input.expectedVersion },
      { columnId: input.columnId, version: n(held.version) + 1, updatedAt: timestamp },
    )
    if (!('dryRun' in changed) && !changed.matched)
      return invalid(issue('version', 'flow.error.conflict', { current: held.version }))
    await trackIssueChange(tx, {
      issueId: input.id,
      threadId: held.threadId,
      version: n(held.version) + 1,
      body: 'flow.timeline.moved',
      changes: moved('columnId', held.columnId, input.columnId),
    })
    return { ok: true, id: input.id, version: n(held.version) + 1 }
  })
}

export async function assignSprint(
  ctx: Ctx,
  input: { id: string; sprintId: string | null; expectedVersion: number; idempotencyKey: string },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  return ctx.tx(async (tx) => {
    const held = (await tx.db.select('flow.Issue', { id: input.id }))[0]
    if (!held) return invalid(issue('id', 'flow.error.notFound'))
    const sprint = await assignableSprint(tx, input.sprintId)
    if (sprint === undefined) return invalid(issue('sprintId', 'flow.error.sprintClosed'))
    if (sprint && String(sprint.projectId) !== String(held.projectId))
      return invalid(issue('sprintId', 'flow.error.sprintProjectMismatch'))
    const timestamp = now()
    const changed = await tx.db.compareAndSet(
      'flow.Issue',
      { id: input.id },
      { version: input.expectedVersion },
      { sprintId: sprint ? sprint.id : null, version: n(held.version) + 1, updatedAt: timestamp },
    )
    if (!('dryRun' in changed) && !changed.matched)
      return invalid(issue('version', 'flow.error.conflict', { current: held.version }))
    await trackIssueChange(tx, {
      issueId: input.id,
      threadId: held.threadId,
      version: n(held.version) + 1,
      body: 'flow.timeline.sprint',
      changes: moved('sprintId', held.sprintId, sprint ? sprint.id : null),
    })
    return { ok: true, id: input.id, version: n(held.version) + 1 }
  })
}

/**
 * Only `blocks` is checked for cycles.
 *
 * `related` carries no ordering — an issue "related to" another can point back
 * without contradiction — so a cycle there is not a bug. A `blocks` cycle would
 * make every issue in the loop permanently unblockable, which is worth refusing
 * up front rather than discovering at move time.
 */
async function createsBlockCycle(ctx: Ctx, issueId: string, dependsOnIssueId: string): Promise<boolean> {
  const seen = new Set<string>([issueId])
  let frontier = [dependsOnIssueId]
  while (frontier.length) {
    if (frontier.includes(issueId)) return true
    const next: string[] = []
    for (const id of frontier) {
      if (seen.has(id)) continue
      seen.add(id)
      const edges = await ctx.db.select('flow.IssueDependency', { issueId: id, relation: 'blocks' })
      next.push(...edges.map((row) => String(row.dependsOnIssueId)))
    }
    frontier = next
  }
  return false
}

export async function addDependency(
  ctx: Ctx,
  input: { id: string; issueId: string; dependsOnIssueId: string; relation: string; idempotencyKey: string },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  if (!DEPENDENCY_RELATIONS.includes(input.relation as never))
    return invalid(issue('relation', 'flow.error.invalidRelation'))
  if (input.issueId === input.dependsOnIssueId)
    return invalid(issue('dependsOnIssueId', 'flow.error.selfDependency'))
  return ctx.tx(async (tx) => {
    const [held, target] = await Promise.all([
      tx.db.select('flow.Issue', { id: input.issueId }),
      tx.db.select('flow.Issue', { id: input.dependsOnIssueId }),
    ])
    if (!held[0] || !target[0]) return invalid(issue('id', 'flow.error.notFound'))
    if (input.relation === 'blocks' && (await createsBlockCycle(tx, input.issueId, input.dependsOnIssueId)))
      return invalid(issue('dependsOnIssueId', 'flow.error.cycle'))
    const inserted = await tx.db.insertIfAbsent('flow.IssueDependency', {
      id: input.id,
      issueId: input.issueId,
      dependsOnIssueId: input.dependsOnIssueId,
      relation: input.relation,
    })
    if (!('dryRun' in inserted) && !inserted.inserted)
      return invalid(issue('dependsOnIssueId', 'flow.error.duplicateDependency'))
    return { ok: true, id: input.id }
  })
}

export async function addComment(
  ctx: Ctx,
  input: {
    id: string
    issueId: string
    body: string
    kind?: 'comment' | 'note'
    /** Who this comment is addressed to, beyond whoever already follows it. */
    mentionUserIds?: string[]
    idempotencyKey: string
  },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  if (!input.body.trim()) return invalid(issue('body', 'flow.error.required'))
  const held = (await ctx.db.select('flow.Issue', { id: input.issueId }))[0]
  if (!held) return invalid(issue('issueId', 'flow.error.notFound'))
  // Before the message, so the author is subscribed to the replies to it.
  // `postMessage` excludes the author from its own recipients, so this does
  // not notify them about their own comment.
  await followIssue(ctx, held.threadId, ctx.actor)
  // Naming somebody subscribes them, so the answer to what they were asked
  // reaches them too. Being mentioned once is how most people end up following
  // an issue at all, which is also why `stopFollowing` exists below.
  for (const userId of input.mentionUserIds ?? []) await followIssue(ctx, held.threadId, userId)
  const result = await postMessage(ctx, {
    id: input.id,
    threadId: String(held.threadId),
    authorUserId: ctx.actor ?? undefined,
    kind: input.kind ?? 'comment',
    body: input.body.trim(),
    mentionPartnerIds: await mentionPartners(ctx, input.mentionUserIds ?? []),
  })
  return { ok: true, id: String(result.message.id) }
}

/**
 * Leaves an issue's thread.
 *
 * The only way out of a subscription this module hands out freely: being
 * assigned an issue, commenting on one, or being mentioned in one all
 * subscribe you, and every comment afterwards reaches you. Without this the
 * follower set only ever grows, and a single mention in a busy spec is a
 * standing appointment nobody agreed to.
 *
 * Answers ok when there was nothing to remove, because "I do not want these"
 * is satisfied either way.
 */
/**
 * Take an issue off the board without pretending it was finished.
 *
 * `Issue.active` has been in the model and in four indexes since Flow was
 * written, `issue.list` has taken `includeArchived`, and nothing has ever
 * written `false` — so the only way to clear a cancelled task was to drop it in
 * the done column, which made every progress figure lie about it.
 *
 * Under compare-and-set, unlike `page.archive`: an issue carries a version
 * because two people work the same one, and archiving from a stale screen is
 * exactly the kind of mistake that guard exists for.
 *
 * What archiving is *not*: it is not completion and it is not deletion.
 * Dependencies stay, so an archived blocker still blocks — silently unblocking
 * work is the worst way to clear a blocker (FLW-DEC-011). Sub-tasks keep their
 * parent, so restoring a parent restores the branch as it was.
 */
export async function archiveIssue(
  ctx: Ctx,
  input: { id: string; expectedVersion: number; idempotencyKey: string },
): Promise<FlowResult> {
  return setIssueActive(ctx, input, false)
}

/**
 * Put it back, exactly where it was.
 *
 * Unlike `page.restore` this needs no reparenting rule: a sub-task of an
 * archived parent is still listed on every board and list of its own, so it
 * cannot come back invisible the way a page under an archived page would.
 */
export async function restoreIssue(
  ctx: Ctx,
  input: { id: string; expectedVersion: number; idempotencyKey: string },
): Promise<FlowResult> {
  return setIssueActive(ctx, input, true)
}

async function setIssueActive(
  ctx: Ctx,
  input: { id: string; expectedVersion: number; idempotencyKey: string },
  active: boolean,
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  return ctx.tx(async (tx) => {
    const held = (await tx.db.select('flow.Issue', { id: input.id }))[0]
    if (!held) return invalid(issue('id', 'flow.error.notFound'))
    // Already where the caller wants it: say so rather than burning a version.
    if (Boolean(held.active) === active) return { ok: true, id: input.id, version: n(held.version) }
    if (n(held.version) !== input.expectedVersion)
      return invalid(issue('version', 'flow.error.conflict', { current: held.version }))
    const version = n(held.version) + 1
    await tx.db.update('flow.Issue', { id: input.id }, { active, version, updatedAt: now() })
    return { ok: true, id: input.id, version }
  })
}

/**
 * Follow an issue on purpose, rather than by being assigned it, commenting on
 * it or being named in it.
 *
 * Those three are how everybody who follows an issue got there, and `unfollow`
 * was the only door in the other direction. Somebody who wanted to watch
 * another person's work had to comment on it — which is noise in the timeline —
 * or ask to be mentioned.
 */
export async function startFollowing(
  ctx: Ctx,
  input: { issueId: string; idempotencyKey: string },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  const held = (await ctx.db.select('flow.Issue', { id: input.issueId }))[0]
  if (!held) return invalid(issue('issueId', 'flow.error.notFound'))
  await followIssue(ctx, held.threadId, ctx.actor)
  return { ok: true, id: input.issueId }
}

export async function stopFollowing(
  ctx: Ctx,
  input: { issueId: string; idempotencyKey: string },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  const held = (await ctx.db.select('flow.Issue', { id: input.issueId }))[0]
  if (!held) return invalid(issue('issueId', 'flow.error.notFound'))
  const user = (await ctx.db.select('user.User', { id: ctx.actor }))[0]
  if (!user?.partnerId) return { ok: true, removed: 0 }
  const removed = await unfollowThread(ctx, String(held.threadId), String(user.partnerId))
  return { ok: true, removed }
}

/**
 * Whether the reader follows this issue, so a screen can offer the right verb.
 */
export async function following(ctx: Ctx, issueId: string): Promise<boolean> {
  const held = (await ctx.db.select('flow.Issue', { id: issueId }))[0]
  if (!held || !ctx.actor) return false
  const user = (await ctx.db.select('user.User', { id: ctx.actor }))[0]
  if (!user?.partnerId) return false
  const rows = await ctx.db.select('mail.Follower', {
    threadId: held.threadId,
    partnerId: user.partnerId,
  })
  return rows.length > 0
}

export async function startSprint(
  ctx: Ctx,
  input: { id: string; idempotencyKey: string },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  return ctx.tx(async (tx) => {
    const held = (await tx.db.select('flow.Sprint', { id: input.id }))[0]
    if (!held) return invalid(issue('id', 'flow.error.notFound'))
    if (held.state !== 'planned') return invalid(issue('id', 'flow.error.invalidSprintState'))
    // A project runs at most one active sprint at a time, which is what makes
    // "the current sprint" a well-defined thing for the board to show.
    const active = await tx.db.select('flow.Sprint', { projectId: held.projectId, state: 'active' })
    if (active.length) return invalid(issue('id', 'flow.error.sprintAlreadyActive'))
    await tx.db.update('flow.Sprint', { id: input.id }, { state: 'active' })
    return { ok: true, id: input.id }
  })
}

/**
 * What a sprint is carrying, and how much of it is finished — see FLW-021.
 *
 * `estimate` has been stored, shown on the form and shown in the summary since
 * the module was written, and added up nowhere: a sprint had no total and there
 * was no velocity to read. Counted per sprint in two grouped passes rather than
 * one query per sprint.
 */
export async function sprintTotals(
  ctx: Ctx,
  projectId: string,
): Promise<
  Map<string, { total: number; done: number; unfinished: number; estimate: number; estimateDone: number }>
> {
  const tally = new Map<
    string,
    { total: number; done: number; unfinished: number; estimate: number; estimateDone: number }
  >()
  const terminal = new Set(
    (await ctx.db.select('flow.Column', { projectId, terminalState: true, active: true })).map((row) =>
      String(row.id),
    ),
  )
  // One read of the project's live issues that carry a sprint. Estimates are
  // decimals, which no `count` adds up, so the sum happens here — over the
  // sprint members only, not over the project.
  const I = ctx.table('flow.Issue')
  const rows = await ctx.db.all(
    from(I).where(eq(I.projectId, projectId), eq(I.active, true), isNotNull(I.sprintId)),
  )
  for (const row of rows) {
    const key = String(row.sprintId)
    const at = tally.get(key) ?? { total: 0, done: 0, unfinished: 0, estimate: 0, estimateDone: 0 }
    const finished = terminal.has(String(row.columnId))
    at.total += 1
    at.estimate += n(row.estimate)
    if (finished) {
      at.done += 1
      at.estimateDone += n(row.estimate)
    } else at.unfinished += 1
    tally.set(key, at)
  }
  return tally
}

/** The same reading for epics, which have the same missing total. */
export async function epicTotals(
  ctx: Ctx,
  projectId: string,
): Promise<Map<string, { total: number; done: number; estimate: number; estimateDone: number }>> {
  const tally = new Map<string, { total: number; done: number; estimate: number; estimateDone: number }>()
  const terminal = new Set(
    (await ctx.db.select('flow.Column', { projectId, terminalState: true, active: true })).map((row) =>
      String(row.id),
    ),
  )
  const I = ctx.table('flow.Issue')
  const rows = await ctx.db.all(
    from(I).where(eq(I.projectId, projectId), eq(I.active, true), isNotNull(I.epicId)),
  )
  for (const row of rows) {
    const key = String(row.epicId)
    const at = tally.get(key) ?? { total: 0, done: 0, estimate: 0, estimateDone: 0 }
    at.total += 1
    at.estimate += n(row.estimate)
    if (terminal.has(String(row.columnId))) {
      at.done += 1
      at.estimateDone += n(row.estimate)
    }
    tally.set(key, at)
  }
  return tally
}

/**
 * Close a sprint, and say what happens to the work that did not finish.
 *
 * Closing used to change one column and stop. The issues stayed in a sprint
 * nobody would look at again, and moving them was one screen each — the step
 * every sprint process has, done by hand.
 *
 * `carryTo` names where the unfinished work goes: another sprint of the same
 * project that is still open, or `null` to take it out of the sprint entirely.
 * Omitting it leaves the work where it is, which is what closing has always
 * done, so no existing caller changes behaviour.
 *
 * The carry is not compare-and-set. A sprint close is a deliberate act on the
 * whole set, and failing it because one issue was edited a second ago would be
 * the wrong answer; the version still moves, so anyone with that issue open
 * gets the conflict on their own next save.
 */
export async function closeSprint(
  ctx: Ctx,
  input: { id: string; carryTo?: string | null; idempotencyKey: string },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  return ctx.tx(async (tx) => {
    const held = (await tx.db.select('flow.Sprint', { id: input.id }))[0]
    if (!held) return invalid(issue('id', 'flow.error.notFound'))
    if (held.state !== 'active') return invalid(issue('id', 'flow.error.invalidSprintState'))
    let carried = 0
    if (input.carryTo !== undefined) {
      const target = input.carryTo ? (await tx.db.select('flow.Sprint', { id: input.carryTo }))[0] : null
      if (input.carryTo) {
        if (!target || String(target.projectId) !== String(held.projectId))
          return invalid(issue('carryTo', 'flow.error.sprintProjectMismatch'))
        if (target.state === 'closed') return invalid(issue('carryTo', 'flow.error.sprintClosed'))
        if (String(target.id) === String(held.id))
          return invalid(issue('carryTo', 'flow.error.invalidSprintState'))
      }
      const terminal = new Set(
        (
          await tx.db.select('flow.Column', {
            projectId: held.projectId,
            terminalState: true,
            active: true,
          })
        ).map((row) => String(row.id)),
      )
      const members = await tx.db.select('flow.Issue', { sprintId: input.id, active: true })
      const timestamp = now()
      for (const row of members) {
        if (terminal.has(String(row.columnId))) continue
        await tx.db.update(
          'flow.Issue',
          { id: row.id },
          { sprintId: target ? target.id : null, version: n(row.version) + 1, updatedAt: timestamp },
        )
        await trackIssueChange(tx, {
          issueId: String(row.id),
          threadId: row.threadId,
          version: n(row.version) + 1,
          body: 'flow.timeline.sprint',
          changes: moved('sprintId', row.sprintId, target ? target.id : null),
        })
        carried += 1
      }
    }
    await tx.db.update('flow.Sprint', { id: input.id }, { state: 'closed' })
    return { ok: true, id: input.id, carried }
  })
}

export const createFlowId = (): string => randomUUID()
