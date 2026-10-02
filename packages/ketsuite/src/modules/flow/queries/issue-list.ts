import type { Ctx, ListState, Row } from '@ketvietlab/ketjs'
import {
  asc,
  bucketEq,
  compileListFilter,
  desc,
  eq,
  from,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  not,
  or,
} from '@ketvietlab/ketjs'
import { FIELD_FILTER_PREFIX, emptyIssueListState, issueListSearch } from '../search.ts'
import { n } from '../domain/command.ts'
import { restrictToVisible, visibleProjects } from '../membership.ts'
import { businessTimezone, businessToday } from './calendar.ts'
import { listTimeline } from '../../mail/index.ts'
import { following } from './issue-followers.ts'

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
export async function progressOf(
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

export type FieldFilterOutcome = { state: ListState; ids: string[] | null; truncated: boolean }

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
export async function resolveFieldFilters(
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

export const listStateOf = (value: unknown): ListState | null =>
  value && typeof value === 'object' ? (value as ListState) : null

/**
 * The columns a board treats as finished, and the one it starts from.
 *
 * Read once and shared, because "late" and "not started" both need them and
 * two readings could disagree. A finished issue is never late, however long
 * ago its date was — the work is done, and a red date on it would be asking
 * for something that has already happened.
 */
export const boardEdges = async (ctx: Ctx): Promise<{ terminal: string[]; first: string[] }> => {
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

export const issueQuery = async (ctx: Ctx, args: Record<string, unknown>) => {
  const I = ctx.table('flow.Issue')
  // Every issue read — list, group, buckets, options — comes through here, so
  // this is where a caller stops seeing projects they are not on. One gate
  // rather than four, because the fourth is the one somebody forgets.
  const visible = await visibleProjects(ctx)
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
  query = restrictToVisible(query, I.projectId, visible)
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
