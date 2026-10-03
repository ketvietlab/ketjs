import { randomUUID } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { canAdministerSite } from './access.ts'
import { claimSiteImages, imageClaimEffects } from './image-assets.ts'

export const styleKeys = [
  'title',
  'preset',
  'accent',
  'font',
  'spacing',
  'buttons',
  'account',
  'logo',
  'footer',
] as const
const choices: Record<string, string[]> = {
  // The bundled presets; the Studio lists the same ones in website-client's theme/presets.ts.
  preset: ['default', 'cosmetics', 'retail', 'restaurant', 'hotel', 'services'],
  accent: ['green', 'indigo', 'orange'],
  font: ['sans', 'serif'],
  spacing: ['compact', 'comfortable', 'spacious'],
  buttons: ['rounded', 'square'],
  // Whether the header offers a customer sign-in. Every site has a realm, but not every site wants
  // its visitors to see an account they have no use for.
  account: ['hidden', 'shown'],
}
/** What the Builder draws for a site that has saved no style of its own. */
export const studioStyleDefaults = {
  preset: 'default',
  accent: 'green',
  font: 'sans',
  spacing: 'comfortable',
  buttons: 'rounded',
  account: 'hidden',
} as const

/**
 * The style a publication captures.
 *
 * Publishing used to capture `null` for a site nobody had styled, and the storefront answered a
 * null with the legacy theme - so the page an editor had just laid out against the defaults went
 * live in another theme. Where the Studio is installed, the defaults are the style. A storefront
 * without it has no Builder to match and keeps its theme.
 */
export const studioAppearance = (ctx: Ctx, site: Row | undefined): Row | null =>
  site?.studioStyle
    ? (site.studioStyle as Row)
    : site && ctx.manifest.modules.website_backend
      ? { ...studioStyleDefaults }
      : null

const issue = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })
/** Site-wide presentation is ERP configuration, separate from editing page content. */
export const saveStudioStyle = defineFn({
  input: { siteId: 'id', expectedRevisionId: 'text', values: 'json' },
  output: { ok: 'bool', revisionId: 'text?', errors: 'json?' },
  effects: ['read:website.Site', 'read:website.SiteMember', 'write:website.Site', ...imageClaimEffects],
  idempotent: true,
  handler: async (ctx, args) => {
    const site = (await ctx.db.select('website.Site', { id: args.siteId }))[0]
    if (!site || !(await canAdministerSite(ctx, args.siteId)))
      return issue('siteId', 'website.error.forbidden')
    const values = args.values as Row
    if (
      !values ||
      typeof values !== 'object' ||
      Array.isArray(values) ||
      Object.keys(values).some((k) => !styleKeys.includes(k as (typeof styleKeys)[number]))
    )
      return issue('values', 'website.error.invalidTokens')
    for (const [key, value] of Object.entries(values)) {
      if (
        typeof value !== 'string' ||
        value.length > (key === 'footer' ? 4000 : 500) ||
        (choices[key] && !choices[key]!.includes(value))
      )
        return issue(key, 'website.error.invalidTokens')
      if (key === 'logo' && value && !/^(?:https:\/\/|\/(?!\/))/.test(value))
        return issue(key, 'website.error.invalidLogo')
      if (key === 'title' && !value.trim()) return issue(key, 'website.error.invalidTitle')
    }
    if (args.expectedRevisionId !== (site.styleRevision ?? 'initial'))
      return issue('expectedRevisionId', 'website.error.editConflict')
    const revisionId = randomUUID()
    // An uploaded logo is the site's to keep from the moment the style names it, or neither is saved.
    const saved = await ctx.tx(async (tx) => {
      const changed = await tx.db.compareAndSet(
        'website.Site',
        { id: args.siteId },
        { styleRevision: site.styleRevision ?? null },
        { studioStyle: { ...((site.studioStyle as Row) ?? {}), ...values }, styleRevision: revisionId },
      )
      if (!('dryRun' in changed) && !changed.matched) return false
      await claimSiteImages(tx, args.siteId, values.logo)
      return true
    })
    if (!saved) return issue('expectedRevisionId', 'website.error.editConflict')
    return { ok: true, revisionId }
  },
})
