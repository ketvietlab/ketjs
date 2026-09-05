// Pages — the written half of a project.
//
// Deliberately small. A page is a title and a Live Doc, and every operation
// here exists because something on the screen needs it, not to mirror what
// Issue happens to have. There is no assignee, no state and no due date: a
// page that wants those is an issue.
//
// The document itself is not written from here at all. `previewText`,
// `contentAttachmentId` and `contentUpdatedAt` belong to Live Doc's flatten
// routine, which updates them as plain columns outside the CAS path — see
// `commitPageContent` in flow_backend and the note on the model.

import { asc, desc, eq, from, ilike, inArray, isNull, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { actorRequired, commandKey, invalid, issue, n, now } from './operations.ts'
import type { FlowResult } from './operations.ts'
import { restrictToVisible, visibleProjects } from './membership.ts'

export type SavePageInput = {
  id: string
  projectId: string
  title: string
  parentPageId?: string | null
  sequence?: number | null
  expectedVersion?: number
  idempotencyKey: string
}

const SEQUENCE_STEP = 10

/** `%` and `_` are wildcards to LIKE, so a title containing one is escaped before it goes in. */
const wildcard = (value: unknown): string => String(value ?? '').replace(/[\\%_]/g, '\\$&')

/** How deep a page may sit under another. */
const MAX_DEPTH = 8

const pageRow = async (ctx: Ctx, id: unknown): Promise<Row | null> =>
  (await ctx.db.select('flow.Page', { id }))[0] ?? null

/**
 * Refuses a parent that would make the tree eat itself.
 *
 * Walked one row at a time rather than in a single query because the query
 * builder has no recursive CTE — the same reason the screen reads one level at
 * a time. `MAX_DEPTH` bounds the walk, so a cycle that predates this check
 * still terminates rather than hanging the request.
 */
const parentError = async (
  ctx: Ctx,
  id: string,
  parentPageId: unknown,
  projectId: string,
): Promise<{ field: string; code: string } | null> => {
  if (!parentPageId) return null
  if (String(parentPageId) === id) return issue('parentPageId', 'flow.error.pageSelfParent')
  let at: Row | null = await pageRow(ctx, parentPageId)
  if (!at) return issue('parentPageId', 'flow.error.notFound')
  if (String(at.projectId) !== projectId) return issue('parentPageId', 'flow.error.pageProjectMismatch')
  for (let depth = 0; at; depth++) {
    if (String(at.id) === id) return issue('parentPageId', 'flow.error.pageCycle')
    if (depth >= MAX_DEPTH) return issue('parentPageId', 'flow.error.pageTooDeep')
    at = at.parentPageId ? await pageRow(ctx, at.parentPageId) : null
  }
  return null
}

/** Where the last sibling sits, so a new page can be put after it. */
const lastSequence = async (ctx: Ctx, projectId: string, parentPageId: string | null): Promise<number> => {
  const P = ctx.table('flow.Page')
  const siblings = await ctx.db.all(
    from(P).where(
      eq(P.projectId, projectId),
      parentPageId ? eq(P.parentPageId, parentPageId) : isNull(P.parentPageId),
    ),
  )
  return siblings.reduce((highest, row) => Math.max(highest, n(row.sequence)), 0)
}

export async function savePage(ctx: Ctx, input: SavePageInput): Promise<FlowResult> {
  if (!commandKey(input.idempotencyKey))
    return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  const title = String(input.title ?? '').trim()
  if (!title) return invalid(issue('title', 'flow.error.required'))
  if (!(await ctx.db.select('flow.Project', { id: input.projectId, active: true }))[0])
    return invalid(issue('projectId', 'flow.error.notFound'))

  return ctx.tx(async (tx) => {
    const existing = await pageRow(tx, input.id)
    if (existing && String(existing.projectId) !== String(input.projectId))
      return invalid(issue('projectId', 'flow.error.immutableProject'))
    // Everything that can refuse runs before the first write: `tx` rolls back
    // on a thrown exception, not on a returned `invalid`, so a check placed
    // after the insert leaves the row behind and still reports failure.
    const failed = await parentError(tx, input.id, input.parentPageId, String(input.projectId))
    if (failed) return invalid(failed)

    const timestamp = now()
    // A reference the caller did not mention keeps what is stored; an explicit
    // null clears it. The page form carries no parent field — moving a page is
    // its own action — so a partial save must not orphan the page.
    const parent: string | null =
      input.parentPageId === undefined
        ? existing?.parentPageId
          ? String(existing.parentPageId)
          : null
        : input.parentPageId || null
    // A new page goes after the siblings it joins. Every page used to be
    // created at the same sequence, which left the whole tree sorted by title
    // and made the column pointless — a wiki's order is the order somebody put
    // things in, not the alphabet.
    const sequence =
      input.sequence != null
        ? n(input.sequence)
        : existing
          ? n(existing.sequence)
          : (await lastSequence(tx, String(input.projectId), parent)) + SEQUENCE_STEP
    const values: Row = {
      projectId: input.projectId,
      parentPageId: parent,
      title,
      sequence,
      active: true,
      version: n(existing?.version) + 1,
      updatedAt: timestamp,
    }
    if (existing) {
      const expected = input.expectedVersion ?? n(existing.version)
      const changed = await tx.db.compareAndSet('flow.Page', { id: input.id }, { version: expected }, values)
      if (!('dryRun' in changed) && !changed.matched)
        return invalid(issue('version', 'flow.error.conflict', { current: existing.version }))
    } else {
      await tx.db.insert('flow.Page', {
        id: input.id,
        ...values,
        createdByUserId: tx.actor ?? null,
        createdAt: timestamp,
      })
    }
    return { ok: true, id: input.id }
  })
}

/**
 * Moves a page to a different parent, or to the root.
 *
 * Separate from `savePage` because it is a different decision: renaming a page
 * and moving it in the tree are two things a person does for two reasons, and
 * the title form posts a partial record that must not silently reparent
 * anything. The children come along — nothing points at them but this page, so
 * the branch moves as a branch.
 *
 * `null` and `''` both mean the root. A move that would put a page under its
 * own descendant is refused by the same walk `savePage` uses.
 */
export async function movePage(
  ctx: Ctx,
  input: { id: string; parentPageId?: string | null; sequence?: number | null },
): Promise<FlowResult> {
  const existing = await pageRow(ctx, input.id)
  if (!existing) return invalid(issue('id', 'flow.error.notFound'))
  const parent = input.parentPageId ? String(input.parentPageId) : null
  const failed = await parentError(ctx, input.id, parent, String(existing.projectId))
  if (failed) return invalid(failed)
  const before = existing.parentPageId ? String(existing.parentPageId) : null
  // Arriving in a branch it was not in, a page joins the end of it. Keeping the
  // sequence it held somewhere else lands it at an arbitrary point in the new
  // branch — or tied with whatever already holds that number.
  const sequence =
    input.sequence != null
      ? n(input.sequence)
      : parent === before
        ? n(existing.sequence)
        : (await lastSequence(ctx, String(existing.projectId), parent)) + SEQUENCE_STEP
  await ctx.db.update('flow.Page', { id: input.id }, { parentPageId: parent, sequence, updatedAt: now() })
  return { ok: true, id: input.id }
}

/**
 * Moves a page one place up or down among its siblings.
 *
 * Reaching the end is not an error — there is simply nothing to swap with, and
 * the caller is told so rather than being handed a failure for asking.
 *
 * Two rows change in the ordinary case, so two people reordering different
 * branches never touch the same rows. The exception is a branch whose
 * sequences are not yet distinct: every page written before this column meant
 * anything shares one value, and swapping two equal numbers moves nothing. The
 * first attempt to reorder such a branch spreads it out — in the order it is
 * already displayed in, so nothing visibly jumps — and every reorder after
 * that is a plain swap again.
 *
 * Nudging a tie apart by one step was tried first and was wrong: with three
 * pages all at 10, moving the last one up put it below every sequence in the
 * branch rather than one place up, which is exactly the state a migrated wiki
 * starts in.
 */
export async function reorderPage(
  ctx: Ctx,
  input: { id: string; direction: 'up' | 'down' },
): Promise<FlowResult> {
  const existing = await pageRow(ctx, input.id)
  if (!existing) return invalid(issue('id', 'flow.error.notFound'))
  const P = ctx.table('flow.Page')
  const parent = existing.parentPageId ? String(existing.parentPageId) : null
  const siblings = await ctx.db.all(
    from(P)
      .where(
        eq(P.projectId, existing.projectId),
        eq(P.active, true),
        parent ? eq(P.parentPageId, parent) : isNull(P.parentPageId),
      )
      .orderBy(asc(P.sequence), asc(P.title)),
  )
  const at = siblings.findIndex((row) => String(row.id) === input.id)
  if (at < 0) return { ok: true, id: input.id, moved: false }
  const to = at + (input.direction === 'up' ? -1 : 1)
  if (to < 0 || to >= siblings.length) return { ok: true, id: input.id, moved: false }

  const stamp = now()
  const distinct = new Set(siblings.map((row) => n(row.sequence))).size === siblings.length
  if (!distinct) {
    // Spread the branch out along the order it is already shown in, then place
    // the page at its new index. Only this branch is touched.
    const reordered = siblings.slice()
    const [moved] = reordered.splice(at, 1)
    reordered.splice(to, 0, moved as Row)
    for (const [index, row] of reordered.entries())
      await ctx.db.update(
        'flow.Page',
        { id: row.id },
        { sequence: (index + 1) * SEQUENCE_STEP, updatedAt: stamp },
      )
    return { ok: true, id: input.id, moved: true }
  }

  const neighbour = siblings[to] as Row
  await ctx.db.update('flow.Page', { id: input.id }, { sequence: n(neighbour.sequence), updatedAt: stamp })
  await ctx.db.update('flow.Page', { id: neighbour.id }, { sequence: n(existing.sequence), updatedAt: stamp })
  return { ok: true, id: input.id, moved: true }
}

/**
 * Archiving a page keeps its children where they are.
 *
 * They stay pointed at an archived parent rather than being re-parented or
 * archived along with it, so restoring the page restores the branch exactly as
 * it was. The tree screen reads `active` and simply stops descending, which is
 * what makes that safe.
 */
export async function archivePage(ctx: Ctx, id: string): Promise<FlowResult> {
  const existing = await pageRow(ctx, id)
  if (!existing) return invalid(issue('id', 'flow.error.notFound'))
  await ctx.db.update('flow.Page', { id }, { active: false, updatedAt: now() })
  return { ok: true, id }
}

export async function restorePage(ctx: Ctx, id: string): Promise<FlowResult> {
  const existing = await pageRow(ctx, id)
  if (!existing) return invalid(issue('id', 'flow.error.notFound'))
  // A page whose parent is archived would come back invisible — the tree stops
  // descending at the archived parent — so it comes back at the root instead
  // of coming back lost.
  const parent = existing.parentPageId ? await pageRow(ctx, existing.parentPageId) : null
  await ctx.db.update(
    'flow.Page',
    { id },
    { active: true, parentPageId: parent?.active ? parent.id : null, updatedAt: now() },
  )
  return { ok: true, id }
}

export type PageRow = {
  id: string
  projectId: string
  parentPageId: string | null
  title: string
  previewText: string | null
  /**
   * Live Doc reads this to find the stored snapshot — see the `pageDocument`
   * owner in flow_backend. Leaving it out of the serialized row made every
   * page look like it had never been written: hydration found no key, started
   * from a blank document, and the first save overwrote the real one.
   */
  contentAttachmentId: string | null
  contentUpdatedAt: string | null
  sequence: number
  active: boolean
  version: number
  updatedAt: string
  /** How many pages sit directly under this one, so the tree knows what folds. */
  childCount: number
}

const serialize = (row: Row, childCount: number): PageRow => ({
  id: String(row.id),
  projectId: String(row.projectId),
  parentPageId: row.parentPageId ? String(row.parentPageId) : null,
  title: String(row.title ?? ''),
  previewText: row.previewText ? String(row.previewText) : null,
  contentAttachmentId: row.contentAttachmentId ? String(row.contentAttachmentId) : null,
  contentUpdatedAt: row.contentUpdatedAt ? String(row.contentUpdatedAt) : null,
  sequence: n(row.sequence),
  active: row.active !== false,
  version: n(row.version),
  updatedAt: String(row.updatedAt ?? ''),
  childCount,
})

/**
 * Every page in a project, in sibling order — or across every project when no
 * project is named.
 *
 * A project's whole tree comes back in one query and is assembled on the
 * screen. That is the opposite of how the issue list works, and it is the
 * right trade here: a wiki is tens of pages, not thousands, and reading a
 * level at a time would be one round trip per expanded branch — with no JOIN
 * to collapse them into.
 *
 * Without a project the answer is deliberately flat: pages from different
 * projects have no common tree to sit in, so the caller gets a list ordered by
 * what changed most recently.
 *
 * A search runs in the query, not over the rows it returns. Filtering
 * afterwards meant the limit was spent on rows that were then thrown away —
 * across projects, ordered by `updatedAt`, that made anything outside the 300
 * most recently touched pages unfindable, and the screen showed an empty
 * result rather than saying it had stopped looking.
 */
export async function listPages(
  ctx: Ctx,
  args: { projectId?: string | null; search?: string | null; includeArchived?: boolean; limit?: number },
): Promise<PageRow[]> {
  const P = ctx.table('flow.Page')
  const where = [
    ...(args.projectId ? [eq(P.projectId, args.projectId)] : []),
    ...(args.includeArchived === true ? [] : [eq(P.active, true)]),
  ]
  const needle = String(args.search ?? '').trim()
  const matching = needle
    ? [or(ilike(P.title, `%${wildcard(needle)}%`, true), ilike(P.previewText, `%${wildcard(needle)}%`, true))]
    : []
  // With a project named the function key has already checked it; without one
  // this is a search across every project there is, and that is the shape the
  // filter has to catch.
  const visible = await visibleProjects(ctx)
  const rows = await ctx.db.all(
    restrictToVisible(
      from(P)
        .where(...where, ...matching)
        .orderBy(...(args.projectId ? [asc(P.sequence), asc(P.title)] : [desc(P.updatedAt)])),
      P.projectId,
      visible,
    ).limit(Math.max(1, Math.min(500, n(args.limit ?? 300)))),
  )
  // Counted over the branch as it really is, not over the rows that matched: a
  // page with three children has three whether or not the search kept them, and
  // counting the matches would tell a reader a branch had emptied out.
  const children = new Map<string, number>()
  if (rows.length) {
    const parents = await ctx.db.all(
      from(P).where(
        ...where,
        inArray(
          P.parentPageId,
          rows.map((row) => String(row.id)),
        ),
      ),
    )
    for (const row of parents) {
      const key = String(row.parentPageId)
      children.set(key, (children.get(key) ?? 0) + 1)
    }
  }
  return rows.map((row) => serialize(row, children.get(String(row.id)) ?? 0))
}

/**
 * Every project's pages as one paged answer, with the project each belongs to.
 *
 * The route used to ask `page.list` for 500 rows, slice a page out of them and
 * print the slice's length as the total — so a company with more than 500
 * documents was told it had 500. It then resolved project names through
 * `project.list`, which caps at 200, so a page in the 201st project by name
 * showed no project at all.
 *
 * Both figures are read here instead: the count is a count, the page is a page,
 * and the names are looked up for the rows actually returned. That is the same
 * correction `epic.listAll` made, done without pulling every row into memory
 * first — a wiki can be large, and a screen that shows fifty rows should not
 * cost every row in the company.
 */
export async function listAllPages(
  ctx: Ctx,
  args: { search?: string | null; cursor?: number; limit?: number },
): Promise<{ rows: Array<PageRow & { projectName: string }>; total: number }> {
  const P = ctx.table('flow.Page')
  const needle = String(args.search ?? '').trim()
  // Every project's documents means every project this caller may see.
  const visible = await visibleProjects(ctx)
  const query = restrictToVisible(
    from(P)
      .where(
        eq(P.active, true),
        ...(needle
          ? [
              or(
                ilike(P.title, `%${wildcard(needle)}%`, true),
                ilike(P.previewText, `%${wildcard(needle)}%`, true),
              ),
            ]
          : []),
      )
      .orderBy(desc(P.updatedAt), asc(P.id)),
    P.projectId,
    visible,
  )
  const cursor = Math.max(0, n(args.cursor ?? 0))
  const limit = Math.max(1, Math.min(200, n(args.limit ?? 50)))
  const [total, rows] = await Promise.all([
    ctx.db.count(query),
    ctx.db.all(query.limit(limit).offset(cursor)),
  ])
  // Names for the rows on this page only, in one read — not for every project
  // that exists, and not one call per row.
  const projectIds = [...new Set(rows.map((row) => String(row.projectId)))]
  const PR = ctx.table('flow.Project')
  const projects = projectIds.length ? await ctx.db.all(from(PR).where(inArray(PR.id, projectIds))) : []
  const named = new Map(projects.map((project) => [String(project.id), String(project.name ?? '')]))
  // Child counts over the branch as it really is, the same reading listPages makes.
  const children = new Map<string, number>()
  if (rows.length) {
    const parents = await ctx.db.all(
      from(P).where(
        eq(P.active, true),
        inArray(
          P.parentPageId,
          rows.map((row) => String(row.id)),
        ),
      ),
    )
    for (const row of parents) {
      const key = String(row.parentPageId)
      children.set(key, (children.get(key) ?? 0) + 1)
    }
  }
  return {
    rows: rows.map((row) => ({
      ...serialize(row, children.get(String(row.id)) ?? 0),
      projectName: named.get(String(row.projectId)) ?? '',
    })),
    total,
  }
}

export type PageDetail = PageRow & {
  projectName: string
  /** Root to this page, so the screen can draw a breadcrumb without walking again. */
  trail: Array<{ id: string; title: string }>
  children: PageRow[]
}

/** One page, with the two things every page screen needs beside it. */
export async function pageDetail(ctx: Ctx, id: string): Promise<PageDetail | null> {
  const row = await pageRow(ctx, id)
  if (!row) return null
  const P = ctx.table('flow.Page')
  const kids = await ctx.db.all(
    from(P).where(eq(P.parentPageId, id), eq(P.active, true)).orderBy(asc(P.sequence), asc(P.title)),
  )
  // Walked upwards one row at a time — no recursive CTE, and bounded by the
  // same depth the parent check enforces, so a cycle written before that check
  // existed cannot spin here.
  const trail: Array<{ id: string; title: string }> = []
  let at: Row | null = row.parentPageId ? await pageRow(ctx, row.parentPageId) : null
  for (let depth = 0; at && depth <= MAX_DEPTH; depth++) {
    trail.unshift({ id: String(at.id), title: String(at.title ?? '') })
    at = at.parentPageId ? await pageRow(ctx, at.parentPageId) : null
  }
  const project = (await ctx.db.select('flow.Project', { id: row.projectId }))[0]
  const grandchildren = new Map<string, number>()
  if (kids.length) {
    const under = await ctx.db.all(
      from(P).where(
        inArray(
          P.parentPageId,
          kids.map((kid) => String(kid.id)),
        ),
        eq(P.active, true),
      ),
    )
    for (const kid of under) {
      const key = String(kid.parentPageId)
      grandchildren.set(key, (grandchildren.get(key) ?? 0) + 1)
    }
  }
  return {
    ...serialize(row, kids.length),
    projectName: String(project?.name ?? ''),
    trail,
    children: kids.map((kid) => serialize(kid, grandchildren.get(String(kid.id)) ?? 0)),
  }
}
