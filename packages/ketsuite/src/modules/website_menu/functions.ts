import { asc, defineFn, deleteFrom, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { canAccessSite, canManageStructure } from '../website/access.ts'

const validHref = (value: unknown): boolean => {
  const href = String(value ?? '').trim()
  const hasControl = [...href].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
  if (href.startsWith('/') && !href.startsWith('//') && !href.includes('\\') && !hasControl) return true
  try {
    const url = new URL(href)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch {
    return false
  }
}

/**
 * How many ancestors an item may have. A menu deeper than this is a site map,
 * and the limit is also what bounds the ancestor walk below.
 */
const MAX_MENU_ANCESTORS = 100

const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })

export const functions: Record<string, FnSpec> = {
  /**
   * The navigation a visitor sees.
   *
   * Separate from listMenu rather than loosening it: listMenu is the editor's
   * view, scoped by site membership, and an anonymous caller has no membership
   * to scope by. This one answers for a site that is actually being served, the
   * same gate the sitemap and public search apply, and returns only what a
   * theme needs to draw a link.
   */
  /**
   * Freeze the navigation so it can go out with the pages it points at.
   *
   * The answer is handed to `website.preparePublication` as an attachment. Left
   * out, a menu change reaches visitors on its own schedule: a link appears
   * before the page it points at, or a page arrives with no way to reach it.
   */
  snapshotMenu: defineFn({
    input: { siteId: 'id' },
    output: { items: 'json' },
    effects: ['read:website.SiteMember', 'read:website_menu.MenuItem'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!(await canAccessSite(ctx, args.siteId))) return { items: [] }
      const M = ctx.table('website_menu.MenuItem')
      const rows = await ctx.db.all(
        from(M).where(eq(M.siteId, args.siteId)).orderBy(asc(M.position)).limit(200),
      )
      return {
        items: rows.map((row) => ({
          id: row.id,
          label: row.label,
          href: row.href,
          position: row.position,
          parentId: row.parentId ?? null,
        })),
      }
    },
  }),

  publicMenu: defineFn({
    anonymous: true,
    input: { siteId: 'id' },
    output: { id: 'id', label: 'text', href: 'text', position: 'int', parentId: 'id?' },
    effects: ['read:website.Site', 'read:website.Publication', 'read:website_menu.MenuItem'],
    handler: async (ctx: Ctx, args) => {
      const Site = ctx.table('website.Site')
      const site = await ctx.db.one(from(Site).where(eq(Site.id, args.siteId), eq(Site.active, true)))
      if (!site) return []

      // A site that publishes as a set reads the navigation that went out with
      // the pages, not whatever the editor has saved since. A site that has
      // never prepared a publication reads live rows, which is what every site
      // did before publications existed.
      if (site.activePublicationId) {
        const P = ctx.table('website.Publication')
        const publication = await ctx.db.one(
          from(P).where(eq(P.id, site.activePublicationId), eq(P.state, 'active')),
        )
        const frozen = (publication?.attachments as { website_menu?: { items?: unknown } } | null)
          ?.website_menu?.items
        if (Array.isArray(frozen)) return frozen as Array<Record<string, unknown>>
      }

      const M = ctx.table('website_menu.MenuItem')
      const rows = await ctx.db.all(
        from(M).where(eq(M.siteId, args.siteId)).orderBy(asc(M.position)).limit(200),
      )
      return rows.map((row) => ({
        id: row.id,
        label: row.label,
        href: row.href,
        position: row.position,
        parentId: row.parentId ?? null,
      }))
    },
  }),

  listMenu: defineFn({
    input: { siteId: 'id?' },
    effects: ['read:website_menu.MenuItem', 'read:website.SiteMember'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (ctx.actor && (!args.siteId || !(await canAccessSite(ctx, args.siteId)))) return []
      const M = ctx.table('website_menu.MenuItem')
      let query = from(M).orderBy(asc(M.position))
      if (args.siteId) query = query.where(eq(M.siteId, args.siteId))
      return ctx.db.all(query)
    },
  }),

  addMenuItem: defineFn({
    input: { id: 'id', siteId: 'id?', label: 'text', href: 'text', position: 'int?', parentId: 'id?' },
    effects: ['read:website.SiteMember', 'read:website_menu.MenuItem', 'write:website_menu.MenuItem'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (ctx.actor && (!args.siteId || !(await canManageStructure(ctx, args.siteId))))
        return invalid('siteId', 'website.error.forbidden')
      const existing = (await ctx.db.select('website_menu.MenuItem', { id: args.id }))[0]
      if (existing && existing.siteId !== (args.siteId ?? null))
        return invalid('id', 'website.error.immutableOwnership')
      if (args.parentId != null) {
        // The parent the caller named is the only one this edit is answerable
        // for: it must exist and belong to the same site.
        const parent = (await ctx.db.select('website_menu.MenuItem', { id: args.parentId }))[0]
        if (!parent || parent.siteId !== (args.siteId ?? null))
          return invalid('parentId', 'website.error.invalidParent')
        if (parent.id === args.id) return invalid('parentId', 'website_menu.error.menuCycle')

        // The rest of the chain is walked for one reason only: to see whether
        // this edit would close a loop back to this item. Making A a child of B
        // and then B a child of A used to produce a cycle that only the renderer
        // would discover.
        //
        // Damage further up is deliberately not this edit's problem. Menus can
        // hold chains broken by the orphaning delete this module used to allow,
        // and rejecting an edit because of a missing row two levels above would
        // report `parentId` as invalid while naming a parent that is fine — with
        // nothing pointing at the row that actually needs repair. A chain that is
        // already broken, or already looping above, cannot close a loop through
        // this item either, so the walk stops instead of refusing.
        const seen = new Set<string>()
        let cursor: unknown = parent.parentId ?? null
        for (let ancestors = 2; cursor != null; ancestors += 1) {
          const key = String(cursor)
          if (key === String(args.id)) return invalid('parentId', 'website_menu.error.menuCycle')
          if (seen.has(key)) break
          seen.add(key)
          if (ancestors > MAX_MENU_ANCESTORS) return invalid('parentId', 'website_menu.error.menuTooDeep')
          const ancestor = (await ctx.db.select('website_menu.MenuItem', { id: cursor }))[0]
          if (!ancestor) break
          cursor = ancestor.parentId ?? null
        }
      }
      let cs = ctx
        .change('website_menu.MenuItem', args, existing)
        .cast(['id', 'siteId', 'label', 'href', 'position', 'parentId'])
        .required(['label', 'href'])
        .validate('href', (v) => validHref(v) || 'website.error.invalidPath')
      if (args.position == null) cs = cs.put('position', 0)
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),

  removeMenuItem: defineFn({
    input: { id: 'id' },
    effects: ['read:website.SiteMember', 'read:website_menu.MenuItem', 'write:website_menu.MenuItem'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const row = (await ctx.db.select('website_menu.MenuItem', { id: args.id }))[0]
      if (!row) return { ok: true, id: args.id }
      if (ctx.actor && (!row.siteId || !(await canManageStructure(ctx, row.siteId))))
        return invalid('siteId', 'website.error.forbidden')
      // Deleting a parent used to leave its children pointing at a row that no
      // longer exists. website.deleteTerm refuses the same way rather than
      // silently rehoming a subtree the editor cannot see.
      const children = await ctx.db.select('website_menu.MenuItem', { parentId: args.id })
      if (children.length) return invalid('id', 'website_menu.error.menuInUse')
      const M = ctx.table('website_menu.MenuItem')
      await ctx.db.del(deleteFrom(M).where(eq(M.id, args.id)))
      return { ok: true, id: args.id }
    },
  }),
}
