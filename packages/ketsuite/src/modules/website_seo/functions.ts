import { asc, defineFn, eq, from, isNotNull, ne } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { canAccessSite, canManageStructure } from '../website/access.ts'
import { isReservedPath, reservedPrefixes, safeOgImage, sameSiteCanonical } from './projection.ts'

const MAX_DESCRIPTION = 320
const MAX_SITEMAP_URLS = 5_000

const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })

/** The hosts a canonical is allowed to name: this site's own domains. */
const hostsForSite = async (ctx: Ctx, siteId: unknown): Promise<string[]> => {
  const Domain = ctx.table('website.SiteDomain')
  const rows = await ctx.db.all(from(Domain).where(eq(Domain.siteId, siteId)))
  return rows.map((row) => String(row.host))
}

const entryById = async (ctx: Ctx, id: unknown): Promise<Row | null> => {
  const Entry = ctx.table('website.Entry')
  return ctx.db.one(from(Entry).where(eq(Entry.id, id)))
}

export const functions: Record<string, FnSpec> = {
  /**
   * The write path the extended fields never had.
   *
   * `website_seo` adds metaDescription, canonical, noindex and ogImage to an
   * Entry it does not own. Editing them through the owning module's saveEntry
   * would put SEO validation in the content module, so the module that declared
   * the fields owns writing them, and checks them on the way in.
   *
   * `noindex` is consumed today, by the sitemap below. The other three are
   * stored and read back but not yet rendered: the storefront page scope in
   * `packages/ketjs/src/server/boot.ts` hands the theme an empty `meta`, so the
   * `website:page.head` fill has nothing to interpolate. Closing that is a
   * framework change and belongs in its own review.
   *
   * Every field is a partial update. Writing all four on every call meant that
   * setting `noindex` erased the description, and — worse — that editing a
   * description silently cleared `noindex` and re-listed a deliberately
   * delisted page in the sitemap.
   */
  saveEntrySeo: defineFn({
    input: {
      entryId: 'id',
      metaDescription: 'text?',
      canonical: 'text?',
      noindex: 'bool?',
      ogImage: 'text?',
    },
    output: { ok: 'bool', entryId: 'id?', errors: 'json?' },
    effects: [
      'read:website.Entry',
      'read:website.SiteDomain',
      'read:website.SiteMember',
      'write:website.Entry',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const entry = await entryById(ctx, args.entryId)
      if (!entry) return invalid('entryId', 'website_seo.error.entryNotFound')
      if (!(await canManageStructure(ctx, entry.siteId))) return invalid('entryId', 'website.error.forbidden')

      const patch: Row = {}

      if (args.metaDescription !== undefined) {
        const description = args.metaDescription == null ? '' : String(args.metaDescription).trim()
        if (description.length > MAX_DESCRIPTION)
          return invalid('metaDescription', 'website_seo.error.descriptionTooLong')
        patch.metaDescription = description || null
      }

      if (args.canonical !== undefined) {
        const raw = args.canonical == null ? '' : String(args.canonical).trim()
        if (!raw) patch.canonical = null
        else {
          const canonical = sameSiteCanonical(raw, await hostsForSite(ctx, entry.siteId))
          if (!canonical) return invalid('canonical', 'website_seo.error.foreignCanonical')
          patch.canonical = canonical
        }
      }

      if (args.ogImage !== undefined) {
        const raw = args.ogImage == null ? '' : String(args.ogImage).trim()
        if (!raw) patch.ogImage = null
        else {
          const ogImage = safeOgImage(raw)
          if (!ogImage) return invalid('ogImage', 'website_seo.error.invalidOgImage')
          patch.ogImage = ogImage
        }
      }

      if (args.noindex !== undefined) patch.noindex = args.noindex === true

      if (Object.keys(patch).length) await ctx.db.update('website.Entry', { id: args.entryId }, patch)
      return { ok: true, entryId: args.entryId }
    },
  }),

  getEntrySeo: defineFn({
    input: { entryId: 'id' },
    output: {
      entryId: 'id',
      metaDescription: 'text?',
      canonical: 'text?',
      noindex: 'bool?',
      ogImage: 'text?',
    },
    effects: ['read:website.Entry', 'read:website.SiteMember'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const entry = await entryById(ctx, args.entryId)
      if (!entry || !(await canAccessSite(ctx, entry.siteId))) return null
      return {
        entryId: entry.id,
        metaDescription: entry.metaDescription ?? null,
        canonical: entry.canonical ?? null,
        noindex: entry.noindex === true,
        ogImage: entry.ogImage ?? null,
      }
    },
  }),

  /**
   * What the sitemap is allowed to contain.
   *
   * The filter is the publication itself: an entry appears only when its site is
   * active, it has a published revision, it is not in trash, it is not marked
   * noindex and it does not sit under a namespace the deployment serves.
   * Unpublishing a page therefore removes it here without a second bookkeeping
   * step that could disagree with the first.
   *
   * `exposure: 'internal'` on purpose: the two public files are the entry point,
   * and they resolve the site from the request host. Left callable, an anonymous
   * caller could name any siteId in the company and read the published paths of
   * a site that is not being served yet.
   */
  sitemapEntries: defineFn({
    input: { siteId: 'id' },
    output: { path: 'text', lastModified: 'datetime?' },
    effects: ['read:website.Site', 'read:website.Entry'],
    exposure: 'internal',
    handler: async (ctx: Ctx, args) => {
      const Site = ctx.table('website.Site')
      const site = await ctx.db.one(from(Site).where(eq(Site.id, args.siteId), eq(Site.active, true)))
      if (!site) return []

      // The publication filter belongs in the query, not after it. Applied as a
      // plain LIMIT over a path ordering, a site with enough drafts sorting
      // first returned an empty sitemap while its published pages existed.
      //
      // The condition is "has a published revision and is not in trash", not
      // status === 'published': scheduling a later republish moves an entry to
      // 'scheduled' while the revision already out there stays live, and a
      // status filter would delist a page a visitor can still open.
      const Entry = ctx.table('website.Entry')
      const rows = await ctx.db.all(
        from(Entry)
          .where(
            eq(Entry.siteId, args.siteId),
            isNotNull(Entry.publishedRevisionId),
            ne(Entry.status, 'trash'),
          )
          .orderBy(asc(Entry.path))
          .limit(MAX_SITEMAP_URLS),
      )
      const prefixes = reservedPrefixes(Object.keys(ctx.manifest.routes ?? {}))
      return rows
        .filter((row) => row.noindex !== true && !isReservedPath(String(row.path), prefixes))
        .map((row) => ({ path: String(row.path), lastModified: row.publishedAt ?? null }))
    },
  }),
}
