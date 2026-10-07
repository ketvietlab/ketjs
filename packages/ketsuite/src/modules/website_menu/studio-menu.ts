import { randomUUID } from 'node:crypto'
import { asc, defineFn, deleteFrom, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { canAccessSite, canManageStructure } from '../website/access.ts'
import { validHref } from './href.ts'

/** The Studio editor offers no more than this, and a header with more is a site map. */
export const MAX_MENU_ITEMS = 100
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/

const issue = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })

const project = (row: Row) => ({
  id: String(row.id),
  label: String(row.label),
  href: String(row.href),
  ...(row.catalogCategoryId ? { catalogCategoryId: String(row.catalogCategoryId) } : {}),
  position: Number(row.position ?? 0),
  parentId: row.parentId == null ? null : String(row.parentId),
})

type Item = ReturnType<typeof project>

/**
 * Check a whole tree before anything is written. Returns the items in an order
 * where every parent precedes its children, with positions taken from the order
 * the editor sent, or the field that is wrong.
 */
export const planMenu = (value: unknown): { items: Item[] } | { field: string; message: string } => {
  if (!Array.isArray(value) || value.length > MAX_MENU_ITEMS)
    return { field: 'items', message: 'website_menu.error.menuTooLarge' }
  const items: Item[] = []
  const ids = new Set<string>()
  for (const [position, raw] of value.entries()) {
    const row = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Row) : {}
    const id = typeof row.id === 'string' ? row.id : ''
    const label = typeof row.label === 'string' ? row.label.trim() : ''
    const href = typeof row.href === 'string' ? row.href.trim() : ''
    const parentId = row.parentId == null || row.parentId === '' ? null : row.parentId
    if (!ITEM_ID.test(id) || ids.has(id)) return { field: 'items', message: 'website_menu.error.invalidItem' }
    if (!label || label.length > 200) return { field: 'label', message: 'website_menu.error.invalidLabel' }
    if (href.length > 2000 || !validHref(href))
      return { field: 'href', message: 'website_menu.error.invalidLink' }
    if (parentId !== null && typeof parentId !== 'string')
      return { field: 'parentId', message: 'website_menu.error.invalidParent' }
    ids.add(id)
    items.push({ id, label, href, position, parentId })
  }
  const byId = new Map(items.map((item) => [item.id, item]))
  // Every parent is checked before any chain is walked, so a walk never reaches a missing row.
  if (items.some((item) => item.parentId !== null && !byId.has(item.parentId)))
    return { field: 'parentId', message: 'website_menu.error.invalidParent' }
  for (const item of items) {
    const seen = new Set([item.id])
    for (let cursor = item.parentId; cursor !== null; cursor = byId.get(cursor)!.parentId) {
      if (seen.has(cursor)) return { field: 'parentId', message: 'website_menu.error.menuCycle' }
      seen.add(cursor)
    }
  }
  const placed = new Set<string>()
  const ordered: Item[] = []
  while (ordered.length < items.length)
    for (const item of items)
      if (!placed.has(item.id) && (item.parentId === null || placed.has(item.parentId))) {
        placed.add(item.id)
        ordered.push(item)
      }
  return { items: ordered }
}

/**
 * Any other write to a site's items moves the Studio revision too, so a form
 * opened before the change cannot replace it unseen.
 */
export const touchMenu = async (ctx: Ctx, siteId: unknown) => {
  if (siteId == null) return
  const state = (await ctx.db.select('website_menu.Menu', { siteId }))[0]
  if (state) await ctx.db.update('website_menu.Menu', { id: state.id }, { revision: randomUUID() })
}

const siteItems = async (ctx: Ctx, siteId: unknown) => {
  const M = ctx.table('website_menu.MenuItem')
  return ctx.db.all(from(M).where(eq(M.siteId, siteId)).orderBy(asc(M.position), asc(M.id)))
}

/** The navigation the Studio edits, with the revision a save must name. */
export const menuState = defineFn({
  input: { siteId: 'id' },
  output: { ok: 'bool', revisionId: 'text?', title: 'text?', items: 'json?', errors: 'json?' },
  effects: [
    'read:website.Site',
    'read:website.SiteMember',
    'read:website_menu.Menu',
    'read:website_menu.MenuItem',
  ],
  handler: async (ctx: Ctx, args) => {
    if (!(await canAccessSite(ctx, args.siteId))) return issue('siteId', 'website.error.forbidden')
    const state = (await ctx.db.select('website_menu.Menu', { siteId: args.siteId }))[0]
    return {
      ok: true,
      revisionId: String(state?.revision ?? 'initial'),
      title: state?.title == null ? null : String(state.title),
      items: (await siteItems(ctx, args.siteId)).map(project),
    }
  },
})

/**
 * Replace a site's whole navigation in one transaction.
 *
 * Order and nesting are one decision: moving an item under another changes
 * both, and saving them as separate calls left visitors reading a half-moved
 * tree between them. The editor sends the full tree in display order and the
 * revision it started from; anything else saved in between is refused.
 */
export const createSaveMenu = (options: { inTransaction?: boolean } = {}) =>
  defineFn({
    input: { siteId: 'id', expectedRevisionId: 'text', title: 'text?', items: 'json' },
    output: { ok: 'bool', revisionId: 'text?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website.SiteMember',
      'read:website_menu.Menu',
      'write:website_menu.Menu',
      'read:website_menu.MenuItem',
      'write:website_menu.MenuItem',
    ],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const plan = planMenu(args.items)
      if ('field' in plan) return issue(plan.field, plan.message)
      const title = args.title == null ? null : String(args.title).trim() || null
      if (title && title.length > 200) return issue('title', 'website.error.invalidTitle')
      const save = async (tx: Ctx) => {
        if (!(await canManageStructure(tx, args.siteId))) return issue('siteId', 'website.error.forbidden')
        const state = (await tx.db.select('website_menu.Menu', { siteId: args.siteId }))[0]
        const current = String(state?.revision ?? 'initial')
        if (args.expectedRevisionId !== current)
          return issue('expectedRevisionId', 'website.error.editConflict')
        // An id already used by another site's item would move that item here.
        const own = new Set((await siteItems(tx, args.siteId)).map((row) => String(row.id)))
        for (const item of plan.items)
          if (!own.has(item.id) && (await tx.db.select('website_menu.MenuItem', { id: item.id }))[0])
            return issue('items', 'website.error.immutableOwnership')
        // Nothing is written before this point, so every refusal above leaves the menu as it was.
        const revision = randomUUID()
        const claimed = state
          ? await tx.db.compareAndSet(
              'website_menu.Menu',
              { id: state.id },
              { revision: current },
              { revision, title },
            )
          : await tx.db.insertIfAbsent('website_menu.Menu', {
              id: args.siteId,
              siteId: args.siteId,
              title,
              revision,
            })
        if (!('dryRun' in claimed) && !('matched' in claimed ? claimed.matched : claimed.inserted))
          return issue('expectedRevisionId', 'website.error.editConflict')
        const M = tx.table('website_menu.MenuItem')
        await tx.db.del(deleteFrom(M).where(eq(M.siteId, args.siteId)))
        for (const item of plan.items)
          await tx.db.insert('website_menu.MenuItem', { ...item, siteId: args.siteId })
        return { ok: true, revisionId: revision }
      }
      return options.inTransaction ? save(ctx) : ctx.tx(save)
    },
  })

export const saveMenu = createSaveMenu()
