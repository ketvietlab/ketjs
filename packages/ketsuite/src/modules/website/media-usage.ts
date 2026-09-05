import { eq, from, ne, walkPlacements } from '@ketvietlab/ketjs'
import type { Ctx, Manifest, Placement, Row } from '@ketvietlab/ketjs'
import { layoutOf } from './renderable.ts'

/**
 * Which pages draw a given media item.
 *
 * `deleteMediaMetadata` removed a row with no question asked, so an image could
 * be deleted out from under every page placing it and the pages went on
 * referring to an id that no longer resolved. `deleteTerm` has refused a term
 * in use since it was written; this is the same guard for the other library.
 *
 * A section says which of its settings is a media reference by declaring the
 * type — `ref:website.MediaMetadata` — so this reads the composed manifest
 * rather than guessing which strings look like ids. A theme that never
 * declares one is simply never scanned.
 */

/** How many entries one usage scan reads. Past it, the answer is "cannot tell". */
export const USAGE_SCAN_LIMIT = 1_000

const MEDIA_REF = 'ref:website.MediaMetadata'

/** Section type to the settings of that section that name a media item. */
export const mediaFieldsOf = (manifest: Manifest): Map<string, string[]> => {
  const fields = new Map<string, string[]>()
  for (const [type, section] of Object.entries(manifest.sections)) {
    const named = Object.entries(section.settings ?? {})
      .filter(([, spec]) => spec === MEDIA_REF || spec === `${MEDIA_REF}?`)
      .map(([field]) => field)
    if (named.length) fields.set(type, named)
  }
  return fields
}

/** Every media id a document refers to, at any depth. */
export const mediaIdsIn = (manifest: Manifest, layout: readonly Placement[]): Set<string> => {
  const fields = mediaFieldsOf(manifest)
  const ids = new Set<string>()
  if (!fields.size) return ids
  for (const { placement } of walkPlacements(layout)) {
    const named = fields.get(String(placement?.type ?? ''))
    if (!named) continue
    for (const field of named) {
      const value = placement?.settings?.[field]
      if (typeof value === 'string' && value) ids.add(value)
    }
  }
  return ids
}

export type MediaUse = { entryId: string; path: string; title: string; published: boolean }

/**
 * The pages placing this media item, and whether the scan saw the whole site.
 *
 * Both the current draft and the published revision count: an image is in use
 * if taking it away would break something a visitor reads *or* something an
 * editor is working on.
 */
export const usageOf = async (ctx: Ctx, media: Row): Promise<{ uses: MediaUse[]; capped: boolean }> => {
  const Entry = ctx.table('website.Entry')
  const found = await ctx.db.all(
    from(Entry)
      .where(eq(Entry.siteId, media.siteId), ne(Entry.status, 'trash'))
      .limit(USAGE_SCAN_LIMIT + 1),
  )
  const capped = found.length > USAGE_SCAN_LIMIT
  const rows = capped ? found.slice(0, USAGE_SCAN_LIMIT) : found

  const wanted = String(media.id)
  const uses: MediaUse[] = []
  for (const entry of rows) {
    const revisionIds = [entry.currentRevisionId, entry.publishedRevisionId]
      .filter((id): id is string => typeof id === 'string' && !!id)
      .filter((id, index, all) => all.indexOf(id) === index)
    let hit = false
    for (const revisionId of revisionIds) {
      if (hit) break
      const revision = (await ctx.db.select('website.EntryRevision', { id: revisionId }))[0]
      if (revision && mediaIdsIn(ctx.manifest, layoutOf(revision)).has(wanted)) hit = true
    }
    if (hit)
      uses.push({
        entryId: String(entry.id),
        path: String(entry.path),
        title: String(entry.title),
        published: entry.status === 'published',
      })
  }
  return { uses, capped }
}
