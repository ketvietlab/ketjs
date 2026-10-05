import { randomUUID } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { canAdministerSite } from '../../website/access.ts'
import { resolveThemeSettings } from '../package.ts'
import type { SelectedTheme, ThemeManifest } from '../types.ts'

const issue = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })

/**
 * Put a site on one of its company's available theme versions, or back on its bundled preset.
 *
 * It writes `studioStyle.theme` under the same revision check as `website.saveStudioStyle`, which
 * merges its own keys and so keeps the theme. Delivery reads site appearance live; page publication
 * freezes content only. A later theme choice therefore applies across existing published pages.
 */
export async function selectThemeHandler(ctx: Ctx, args: Row) {
  const site = (await ctx.db.select('website.Site', { id: args.siteId }))[0]
  if (!site || !(await canAdministerSite(ctx, args.siteId))) return issue('siteId', 'website.error.forbidden')
  let theme: SelectedTheme | null = null
  if (args.versionId != null) {
    // Company scope keeps another company's versions out of reach; status keeps withdrawn ones out.
    const version = (await ctx.db.select('website_theme.ThemeVersion', { id: args.versionId }))[0]
    const owner = version ? (await ctx.db.select('website_theme.Theme', { id: version.themeId }))[0] : null
    if (!version || !owner || version.status !== 'available')
      return issue('versionId', 'website_theme.error.unavailable')
    const manifest = version.manifest as ThemeManifest
    const settings = resolveThemeSettings(manifest.settings ?? {}, args.settings)
    if (!settings.ok) return issue(settings.field, 'website_theme.error.invalidSetting')
    theme = {
      key: String(owner.key),
      versionId: String(version.id),
      version: String(version.version),
      entry: manifest.script?.entry ?? null,
      connect: manifest.script?.connect ?? [],
      frame: manifest.script?.frame ?? [],
      settings: settings.settings,
    }
  } else if (args.settings != null) return issue('settings', 'website_theme.error.invalidSetting')
  if (args.expectedRevisionId !== (site.styleRevision ?? 'initial'))
    return issue('expectedRevisionId', 'website.error.editConflict')
  const { theme: _previous, ...style } = (site.studioStyle as Row | null) ?? {}
  const revisionId = randomUUID()
  const changed = await ctx.db.compareAndSet(
    'website.Site',
    { id: args.siteId },
    { styleRevision: site.styleRevision ?? null },
    { studioStyle: theme ? { ...style, theme } : style, styleRevision: revisionId },
  )
  if (!('dryRun' in changed) && !changed.matched)
    return issue('expectedRevisionId', 'website.error.editConflict')
  return { ok: true, revisionId, theme }
}

export const selectFunctions: Record<string, FnSpec> = {
  selectTheme: defineFn({
    input: { siteId: 'id', expectedRevisionId: 'text', versionId: 'id?', settings: 'json?' },
    output: { ok: 'bool', revisionId: 'text?', theme: 'json?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website.SiteMember',
      'write:website.Site',
      'read:website_theme.Theme',
      'read:website_theme.ThemeVersion',
    ],
    idempotent: true,
    handler: selectThemeHandler,
  }),
}
