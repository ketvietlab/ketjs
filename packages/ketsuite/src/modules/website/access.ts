import { eq, from } from 'ketjs'
import type { Ctx, Row } from 'ketjs'

export type SiteRole = 'administrator' | 'editor' | 'author' | 'contributor'

const ROLES = new Set<SiteRole>(['administrator', 'editor', 'author', 'contributor'])

/**
 * Internal calls deliberately have no actor and remain unrestricted. HTTP calls
 * always carry the session actor, so site membership becomes a second boundary
 * after the framework's function grants.
 */
export const roleForSite = async (ctx: Ctx, siteId: unknown): Promise<SiteRole | null> => {
  if (!ctx.actor) return 'administrator'
  const Member = ctx.table('website.SiteMember')
  const row = await ctx.db.one(from(Member).where(eq(Member.siteId, siteId), eq(Member.userId, ctx.actor)))
  const role = String(row?.role ?? '') as SiteRole
  return ROLES.has(role) ? role : null
}

export const canAccessSite = async (ctx: Ctx, siteId: unknown): Promise<boolean> =>
  (await roleForSite(ctx, siteId)) !== null

export const canAdministerSite = async (ctx: Ctx, siteId: unknown): Promise<boolean> =>
  (await roleForSite(ctx, siteId)) === 'administrator'

export const canManageStructure = async (ctx: Ctx, siteId: unknown): Promise<boolean> => {
  const role = await roleForSite(ctx, siteId)
  return role === 'administrator' || role === 'editor'
}

export const canEditEntry = async (ctx: Ctx, entry: Row | null): Promise<boolean> => {
  if (!entry) return false
  const role = await roleForSite(ctx, entry.siteId)
  if (role === 'administrator' || role === 'editor') return true
  return (role === 'author' || role === 'contributor') && !!ctx.actor && entry.authorId === ctx.actor
}

export const canCreateEntry = async (ctx: Ctx, siteId: unknown): Promise<boolean> =>
  (await roleForSite(ctx, siteId)) !== null

export const canPublishEntry = async (ctx: Ctx, entry: Row | null): Promise<boolean> => {
  if (!entry) return false
  const role = await roleForSite(ctx, entry.siteId)
  if (role === 'administrator' || role === 'editor') return true
  return role === 'author' && !!ctx.actor && entry.authorId === ctx.actor
}
