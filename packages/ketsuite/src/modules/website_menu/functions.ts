import { asc, defineFn, deleteFrom, eq, from } from 'ketjs'
import type { Ctx, FnSpec } from 'ketjs'
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

export const functions: Record<string, FnSpec> = {
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
        return { ok: false, errors: [{ field: 'siteId', message: 'website.error.forbidden' }] }
      const existing = (await ctx.db.select('website_menu.MenuItem', { id: args.id }))[0]
      if (existing && existing.siteId !== (args.siteId ?? null))
        return { ok: false, errors: [{ field: 'id', message: 'website.error.immutableOwnership' }] }
      if (args.parentId) {
        const parent = (await ctx.db.select('website_menu.MenuItem', { id: args.parentId }))[0]
        if (!parent || parent.siteId !== (args.siteId ?? null) || parent.id === args.id)
          return { ok: false, errors: [{ field: 'parentId', message: 'website.error.invalidParent' }] }
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
      if (!row) return { changes: 0 }
      if (ctx.actor && (!row.siteId || !(await canManageStructure(ctx, row.siteId))))
        return { ok: false, errors: [{ field: 'siteId', message: 'website.error.forbidden' }] }
      const M = ctx.table('website_menu.MenuItem')
      return ctx.db.del(deleteFrom(M).where(eq(M.id, args.id)))
    },
  }),
}
