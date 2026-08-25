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

import { asc, desc, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { actorRequired, commandKey, invalid, issue, n, normalized, now } from './operations.ts'
import type { FlowResult } from './operations.ts'

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
    const parent =
      input.parentPageId === undefined
        ? (existing?.parentPageId ?? null)
        : input.parentPageId || null
    const values: Row = {
      projectId: input.projectId,
      parentPageId: parent,
      title,
      sequence: n(input.sequence ?? existing?.sequence ?? SEQUENCE_STEP),
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
  await ctx.db.update(
    'flow.Page',
    { id: input.id },
    {
      parentPageId: parent,
      sequence: input.sequence == null ? n(existing.sequence) : n(input.sequence),
      updatedAt: now(),
    },
  )
  return { ok: true, id: input.id }
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
 */
export async function listPages(
  ctx: Ctx,
  args: { projectId?: string | null; search?: string | null; includeArchived?: boolean; limit?: number },
): Promise<PageRow[]> {
  const P = ctx.table('flow.Page')
  const scoped = args.projectId ? [eq(P.projectId, args.projectId)] : []
  const rows = await ctx.db.all(
    from(P)
      .where(...scoped, ...(args.includeArchived === true ? [] : [eq(P.active, true)]))
      .orderBy(...(args.projectId ? [asc(P.sequence), asc(P.title)] : [desc(P.updatedAt)]))
      .limit(Math.max(1, Math.min(500, n(args.limit ?? 300)))),
  )
  const children = new Map<string, number>()
  for (const row of rows) {
    if (!row.parentPageId) continue
    const key = String(row.parentPageId)
    children.set(key, (children.get(key) ?? 0) + 1)
  }
  const needle = normalized(args.search)
  return rows
    .filter(
      (row) =>
        !needle ||
        normalized(row.title).includes(needle) ||
        normalized(row.previewText).includes(needle),
    )
    .map((row) => serialize(row, children.get(String(row.id)) ?? 0))
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
    from(P)
      .where(eq(P.parentPageId, id), eq(P.active, true))
      .orderBy(asc(P.sequence), asc(P.title)),
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
