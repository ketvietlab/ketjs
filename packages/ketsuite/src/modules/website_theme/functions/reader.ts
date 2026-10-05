import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { THEME_BOOT_FILE } from '../types.ts'
import type { ThemeManifest } from '../types.ts'

/**
 * What `/_theme/{versionId}/{file}` may serve, or nothing.
 *
 * Theme files are public assets of whichever site uses them, so this reads across companies the way
 * `website.imageForReader` does for published images; the version id is unguessable and the tenant's
 * database holds no other tenant's versions. Only an `available` version answers, which is what makes
 * revocation immediate at the origin.
 */
export async function themeFileForReaderHandler(ctx: Ctx, args: Row) {
  const version = (await ctx.db.select('website_theme.ThemeVersion', { id: args.versionId }))[0]
  if (version?.status !== 'available') return { file: null }
  if (args.file === THEME_BOOT_FILE) {
    const entry = (version.manifest as ThemeManifest).script?.entry
    return entry ? { file: { boot: true, entry } } : { file: null }
  }
  const entry = (version.files as Row[]).find((file) => file.name === args.file)
  if (!entry) return { file: null }
  return {
    file: {
      storeKey: `${version.storagePrefix}${entry.name}`,
      type: entry.type,
      size: entry.size,
      sha256: entry.sha256,
    },
  }
}

export const readerFunctions: Record<string, FnSpec> = {
  themeFileForReader: defineFn({
    exposure: 'internal',
    crossCompany: true,
    input: { versionId: 'id', file: 'text' },
    output: { file: 'json?' },
    effects: ['read:website_theme.ThemeVersion'],
    handler: themeFileForReaderHandler,
  }),
}
