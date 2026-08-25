import { randomUUID } from 'node:crypto'
import { asc, bucketEq, compileListFilter, deleteFrom, desc, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, ListState, Row } from '@ketvietlab/ketjs'
import { ensureThread, followThread, listTimeline, postMessage } from '../mail/index.ts'
import { DEPENDENCY_RELATIONS, ISSUE_PRIORITIES } from './types.ts'
import { emptyIssueListState, issueListSearch } from './search.ts'

export type FlowIssue = { field: string; code: string; params?: Record<string, unknown> }
export type FlowResult = { ok: boolean; id?: string; errors?: FlowIssue[]; [key: string]: unknown }

export const issue = (field: string, code: string, params?: Record<string, unknown>): FlowIssue => ({
  field,
  code,
  ...(params ? { params } : {}),
})
export const invalid = (...errors: FlowIssue[]): FlowResult => ({ ok: false, errors })
export const now = (): string => new Date().toISOString()
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

export async function serializeIssueList(ctx: Ctx, rows: Row[]): Promise<Row[]> {
  const ids = (values: unknown[]): string[] => [...new Set(values.filter(Boolean).map(String))]
  const columnIds = ids(rows.map((row) => row.columnId))
  const epicIds = ids(rows.map((row) => row.epicId))
  const sprintIds = ids(rows.map((row) => row.sprintId))
  const userIds = ids(rows.map((row) => row.assigneeUserId))
  // The project too, for the one list that spans them: an issue read outside
  // its own board has to say which board it came from.
  const projectIds = ids(rows.map((row) => row.projectId))
  const [columns, epics, sprints, users, projects] = await Promise.all([
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
  ])
  const by = (values: Row[]) => new Map(values.map((row) => [String(row.id), row]))
  const columnBy = by(columns)
  const epicBy = by(epics)
  const sprintBy = by(sprints)
  const userBy = by(users)
  const projectBy = by(projects)
  return rows.map((row) => ({
    ...row,
    projectName: row.projectId ? (projectBy.get(String(row.projectId))?.name ?? row.projectId) : null,
    columnName: row.columnId ? (columnBy.get(String(row.columnId))?.name ?? row.columnId) : null,
    epicTitle: row.epicId ? (epicBy.get(String(row.epicId))?.title ?? row.epicId) : null,
    sprintName: row.sprintId ? (sprintBy.get(String(row.sprintId))?.name ?? row.sprintId) : null,
    assigneeName: row.assigneeUserId
      ? (userBy.get(String(row.assigneeUserId))?.name ?? row.assigneeUserId)
      : null,
  }))
}

const listStateOf = (value: unknown): ListState | null =>
  value && typeof value === 'object' ? (value as ListState) : null

const issueQuery = async (ctx: Ctx, args: Record<string, unknown>) => {
  const I = ctx.table('flow.Issue')
  const state = listStateOf(args.listState) ?? emptyIssueListState()
  const timezone = String(args.timezone ?? 'UTC')
  let query = from(I)
  const spec = issueListSearch(I)
  const compiled = compileListFilter(spec, state, { timezone })
  if (compiled) query = query.where(compiled)
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
  if (!state.includeArchived && args.includeArchived !== true) query = query.where(eq(I.active, true))
  const sorts = state.sort.length ? state.sort : emptyIssueListState().sort
  const sortable = new Map((spec.sortable ?? []).map((field) => [field.key, field.col]))
  for (const sort of sorts) {
    const col = sortable.get(sort.key)
    if (col) query = query.orderBy(sort.dir === 'desc' ? desc(col) : asc(col))
  }
  return { query, state, spec, timezone }
}

export async function listIssues(
  ctx: Ctx,
  args: Record<string, unknown>,
): Promise<{ rows: Row[]; total: number; nextCursor: string | null }> {
  const { query } = await issueQuery(ctx, args)
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

export async function issueDetail(ctx: Ctx, id: string): Promise<Row | null> {
  const row = (await ctx.db.select('flow.Issue', { id }))[0]
  if (!row) return null
  const [serialized] = await serializeIssueList(ctx, [row])
  const [tags, outgoing, incoming, comments] = await Promise.all([
    ctx.db.select('flow.IssueTag', { issueId: id }),
    ctx.db.select('flow.IssueDependency', { issueId: id }),
    ctx.db.select('flow.IssueDependency', { dependsOnIssueId: id }),
    listTimeline(ctx, String(row.threadId), { limit: 100 }),
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
  return {
    ...serialized!,
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
 * Both ends are matched here rather than only `issueId`: an edge pointing out
 * of the set is not an edge of the set, and leaving that to the caller meant
 * `flow.issue.dependencies` — an agent-callable function — answered with
 * edges nobody asked about. The id list is capped for the same reason every
 * other read in this module is: it arrives over HTTP.
 */
export const DEPENDENCY_BATCH = 200

export async function dependenciesFor(ctx: Ctx, issueIds: readonly string[]): Promise<Row[]> {
  const ids = [...new Set(issueIds.map(String))].slice(0, DEPENDENCY_BATCH)
  if (!ids.length) return []
  const D = ctx.table('flow.IssueDependency')
  const held = new Set(ids)
  const rows = await ctx.db.all(from(D).where(inArray(D.issueId, ids), eq(D.relation, 'blocks')))
  return rows.filter((row) => held.has(String(row.dependsOnIssueId)))
}

export type SaveIssueInput = {
  id: string
  projectId: string
  columnId: string
  epicId?: string | null
  sprintId?: string | null
  parentIssueId?: string | null
  title: string
  assigneeUserId?: string | null
  priority?: string
  dueDate?: string | null
  estimate?: unknown
  tagIds?: string[]
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
      epicId: input.epicId === undefined ? (existing?.epicId ?? null) : epic ? epic.id : null,
      sprintId: input.sprintId === undefined ? (existing?.sprintId ?? null) : sprint ? sprint.id : null,
      parentIssueId: kept(input.parentIssueId, existing?.parentIssueId),
      title: input.title.trim(),
      assigneeUserId: kept(input.assigneeUserId, existing?.assigneeUserId),
      priority: input.priority ?? existing?.priority ?? 'normal',
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

    // Whoever opened it, and whoever it lands on, are subscribed to its
    // thread. Until this existed the thread had no followers at all, so
    // `postMessage` addressed nobody and every comment notified nobody — the
    // discussion feature was wired end to end and silently inert.
    if (!existing) await followIssue(tx, threadId, tx.actor)
    const assignee = values.assigneeUserId
    if (assignee) await followIssue(tx, threadId, assignee)
    // Only when it actually changed hands: a system entry on every title edit
    // is noise, and the timeline is the one place that has to stay readable.
    if (assignee && String(assignee) !== String(existing?.assigneeUserId ?? '')) {
      await postMessage(tx, {
        id: `${input.id}:assigned:${nextVersion}`,
        threadId,
        authorUserId: tx.actor ?? undefined,
        kind: 'system',
        // A message key, resolved by whoever renders the timeline — the same
        // arrangement crm_backend's `entryBody` already reads.
        body: 'flow.timeline.assigned',
        tracking: [
          {
            field: 'assigneeUserId',
            ...(existing?.assigneeUserId ? { oldValue: String(existing.assigneeUserId) } : {}),
            newValue: String(assignee),
          },
        ],
      })
    }
    return { ok: true, id: input.id, version: nextVersion }
  })
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
  input: { id: string; issueId: string; body: string; kind?: 'comment' | 'note'; idempotencyKey: string },
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
  const result = await postMessage(ctx, {
    id: input.id,
    threadId: String(held.threadId),
    authorUserId: ctx.actor ?? undefined,
    kind: input.kind ?? 'comment',
    body: input.body.trim(),
  })
  return { ok: true, id: String(result.message.id) }
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

export async function closeSprint(
  ctx: Ctx,
  input: { id: string; idempotencyKey: string },
): Promise<FlowResult> {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  return ctx.tx(async (tx) => {
    const held = (await tx.db.select('flow.Sprint', { id: input.id }))[0]
    if (!held) return invalid(issue('id', 'flow.error.notFound'))
    if (held.state !== 'active') return invalid(issue('id', 'flow.error.invalidSprintState'))
    await tx.db.update('flow.Sprint', { id: input.id }, { state: 'closed' })
    return { ok: true, id: input.id }
  })
}

export const createFlowId = (): string => randomUUID()
