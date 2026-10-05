import { createHash, randomUUID } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { compileThemeFrame } from '../frame.ts'
import { THEME_FRAME_FILES } from '../types.ts'
import type { ThemeFrameTemplates } from '../types.ts'
import { checkThemeManifest } from '../package.ts'
import type { ThemeFileEntry, ThemeIssue } from '../package.ts'
import { THEME_FILE, THEME_LIMITS, themeFileType, themeStoragePrefix } from '../types.ts'
import type { ThemeStatus } from '../types.ts'

const issue = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })
const registryEffects = [
  'read:website_theme.Theme',
  'write:website_theme.Theme',
  'read:website_theme.ThemeVersion',
  'write:website_theme.ThemeVersion',
]

/** The file list an installer recorded, re-checked: the row is what the route trusts afterwards. */
const fileEntries = (value: unknown): ThemeFileEntry[] | null => {
  if (!Array.isArray(value) || !value.length || value.length > THEME_LIMITS.files) return null
  const names = new Set<string>()
  for (const item of value as Row[]) {
    const name = String(item?.name ?? '')
    if (
      !THEME_FILE.test(name) ||
      names.has(name) ||
      item.type !== themeFileType(name) ||
      !Number.isInteger(item.size) ||
      (item.size as number) < 0 ||
      (item.size as number) > THEME_LIMITS.fileBytes ||
      !/^[0-9a-f]{64}$/.test(String(item.sha256))
    )
      return null
    names.add(name)
  }
  return value as ThemeFileEntry[]
}

/**
 * Record a version before its files are written, so the storage prefix is known and a second run of
 * the same package finds the first. The same key and version with other bytes is refused: a version
 * once installed never changes.
 */
export async function stageThemeVersionHandler(ctx: Ctx, args: Row) {
  if (!ctx.scope.company) return issue('company', 'website_theme.error.companyRequired')
  const files = fileEntries(args.files)
  if (!files) return issue('files', 'website_theme.error.invalidPackage')
  const problems: ThemeIssue[] = []
  const manifest = checkThemeManifest(args.manifest, new Set(files.map((file) => file.name)), problems)
  if (!manifest)
    return {
      ok: false,
      errors: problems.map((p) => ({ field: p.detail, message: `website_theme.error.${p.code}` })),
    }
  const frameTemplates: ThemeFrameTemplates = {}
  const sources = args.frameTemplates ?? {}
  if (
    !sources ||
    typeof sources !== 'object' ||
    Array.isArray(sources) ||
    Object.keys(sources).some((slot) => !manifest.frame.includes(slot as keyof typeof THEME_FRAME_FILES))
  )
    return issue('frameTemplates', 'website_theme.error.invalidPackage')
  for (const slot of manifest.frame) {
    const source = (sources as Row)[slot]
    const file = files.find((entry) => entry.name === THEME_FRAME_FILES[slot])!
    if (
      typeof source !== 'string' ||
      Buffer.byteLength(source) !== file.size ||
      createHash('sha256').update(source).digest('hex') !== file.sha256
    )
      return issue('frameTemplates', 'website_theme.error.invalidPackage')
    try {
      compileThemeFrame(source, slot)
    } catch {
      return issue('frameTemplates', 'website_theme.error.invalidPackage')
    }
    frameTemplates[slot] = source
  }
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : 1))
  const hash = createHash('sha256')
    .update(sorted.map((file) => `${file.name}\0${file.size}\0${file.sha256}\n`).join(''))
    .digest('hex')
  if (hash !== args.hash) return issue('hash', 'website_theme.error.invalidPackage')
  return ctx.tx(async (tx) => {
    let theme = (await tx.db.select('website_theme.Theme', { key: manifest.key }))[0]
    if (!theme) {
      theme = { id: randomUUID(), key: manifest.key, tier: manifest.tier, title: manifest.title }
      await tx.db.insert('website_theme.Theme', theme)
    } else if (theme.title !== manifest.title)
      await tx.db.update('website_theme.Theme', { id: theme.id }, { title: manifest.title })
    const existing = (
      await tx.db.select('website_theme.ThemeVersion', { themeId: theme.id, version: manifest.version })
    )[0]
    if (existing) {
      if (existing.hash !== hash) return issue('version', 'website_theme.error.versionConflict')
      return { ok: true, id: existing.id, storagePrefix: existing.storagePrefix, status: existing.status }
    }
    const id = randomUUID()
    const storagePrefix = themeStoragePrefix(manifest.key, id)
    await tx.db.insert('website_theme.ThemeVersion', {
      id,
      themeId: theme.id,
      version: manifest.version,
      hash,
      manifest,
      files: sorted,
      frameTemplates,
      storagePrefix,
      status: 'staged',
      statusReason: null,
      installedAt: null,
      installedBy: null,
    })
    return { ok: true, id, storagePrefix, status: 'staged' }
  })
}

/** The installer wrote every file; from here the version may be offered. */
export async function completeThemeVersionHandler(ctx: Ctx, args: Row) {
  const version = (await ctx.db.select('website_theme.ThemeVersion', { id: args.id }))[0]
  if (!version) return issue('id', 'website_theme.error.versionNotFound')
  if (version.status === 'revoked') return issue('id', 'website_theme.error.revoked')
  if (version.status !== 'staged') return { ok: true, id: version.id, status: version.status }
  const changed = await ctx.db.compareAndSet(
    'website_theme.ThemeVersion',
    { id: args.id },
    { status: 'staged' },
    { status: 'installed', installedAt: new Date().toISOString(), installedBy: ctx.actor ?? null },
  )
  if (!('dryRun' in changed) && !changed.matched) return issue('id', 'website_theme.error.editConflict')
  return { ok: true, id: version.id, status: 'installed' }
}

const TRANSITIONS: Record<string, ThemeStatus[]> = {
  installed: ['available', 'revoked'],
  available: ['revoked'],
}

/**
 * Offer a version to its company's sites, or withdraw it. Revocation takes effect at the origin on the
 * next request for a file; pages that still name the version render without it.
 */
export async function setThemeVersionStatusHandler(ctx: Ctx, args: Row) {
  const version = (await ctx.db.select('website_theme.ThemeVersion', { id: args.id }))[0]
  if (!version) return issue('id', 'website_theme.error.versionNotFound')
  if (version.status === args.status) return { ok: true, id: version.id, status: version.status }
  if (!TRANSITIONS[String(version.status)]?.includes(args.status as ThemeStatus))
    return issue('status', 'website_theme.error.invalidTransition')
  const changed = await ctx.db.compareAndSet(
    'website_theme.ThemeVersion',
    { id: args.id },
    { status: version.status },
    { status: args.status, statusReason: args.reason ?? null },
  )
  if (!('dryRun' in changed) && !changed.matched) return issue('id', 'website_theme.error.editConflict')
  return { ok: true, id: version.id, status: args.status }
}

export const registryFunctions: Record<string, FnSpec> = {
  stageThemeVersion: defineFn({
    exposure: 'internal',
    input: { manifest: 'json', hash: 'text', files: 'json', frameTemplates: 'json?' },
    output: { ok: 'bool', id: 'id?', storagePrefix: 'text?', status: 'text?', errors: 'json?' },
    effects: registryEffects,
    handler: stageThemeVersionHandler,
  }),
  completeThemeVersion: defineFn({
    exposure: 'internal',
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', status: 'text?', errors: 'json?' },
    effects: registryEffects,
    handler: completeThemeVersionHandler,
  }),
  // `ket provision website_theme.setThemeVersionStatus --input -` runs without a company, so the
  // version is found by id across companies.
  setThemeVersionStatus: defineFn({
    exposure: 'internal',
    provision: true,
    crossCompany: true,
    input: { id: 'id', status: 'text', reason: 'text?' },
    output: { ok: 'bool', id: 'id?', status: 'text?', errors: 'json?' },
    effects: registryEffects,
    handler: setThemeVersionStatusHandler,
  }),
}
