import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { canAdministerSite } from '../../website/access.ts'
import { studioPresets } from '../../website/studio-style.ts'
import type { ThemeManifest } from '../types.ts'

const issue = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })
const object = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {}

/** The part of a version the Studio shows: never the storage prefix or the file list. */
export const versionSummary = (theme: Row, version: Row) => {
  const manifest = object(version.manifest) as Partial<ThemeManifest>
  return {
    id: String(version.id),
    themeId: String(theme.id),
    key: String(theme.key),
    title: String(theme.title),
    tier: String(theme.tier),
    version: String(version.version),
    status: String(version.status),
    settings: manifest.settings ?? {},
    script: !!manifest.script,
  }
}

/**
 * The themes a site may use: the bundled presets, then the company's own themes at their newest
 * available version. A theme with no available version is not offered.
 */
export async function listThemesHandler(ctx: Ctx, args: Row) {
  const site = (await ctx.db.select('website.Site', { id: args.siteId }))[0]
  if (!site || !(await canAdministerSite(ctx, args.siteId))) return issue('siteId', 'website.error.forbidden')
  const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 100)
  const offset = Math.max(Number(args.offset ?? 0), 0)
  const themes = (await ctx.db.select('website_theme.Theme', {})).sort((a, b) =>
    String(a.title).localeCompare(String(b.title)),
  )
  const available = await ctx.db.select('website_theme.ThemeVersion', { status: 'available' })
  const offered = themes.flatMap((theme) => {
    const newest = available
      .filter((version) => version.themeId === theme.id)
      .sort((a, b) => String(b.installedAt ?? '').localeCompare(String(a.installedAt ?? '')))[0]
    return newest ? [versionSummary(theme, newest)] : []
  })
  const bundled = studioPresets.map((key) => ({ key, title: key, tier: 'bundled', id: null }))
  const all = [...bundled, ...offered]
  return {
    ok: true,
    themes: all.slice(offset, offset + limit),
    total: all.length,
    selected: object(site.studioStyle).theme ?? null,
  }
}

export async function getThemeVersionHandler(ctx: Ctx, args: Row) {
  const version = (await ctx.db.select('website_theme.ThemeVersion', { id: args.id }))[0]
  const theme = version ? (await ctx.db.select('website_theme.Theme', { id: version.themeId }))[0] : null
  if (!version || !theme) return issue('id', 'website_theme.error.versionNotFound')
  return { ok: true, version: versionSummary(theme, version) }
}

export const catalogFunctions: Record<string, FnSpec> = {
  listThemes: defineFn({
    input: { siteId: 'id', limit: 'int?', offset: 'int?' },
    output: { ok: 'bool', themes: 'json?', total: 'int?', selected: 'json?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website.SiteMember',
      'read:website_theme.Theme',
      'read:website_theme.ThemeVersion',
    ],
    handler: listThemesHandler,
  }),
  getThemeVersion: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', version: 'json?', errors: 'json?' },
    effects: ['read:website_theme.Theme', 'read:website_theme.ThemeVersion'],
    handler: getThemeVersionHandler,
  }),
}
