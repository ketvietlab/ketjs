import { validateLayout, walkPlacements } from '@ketvietlab/ketjs'
import type { Ctx, LayoutError, Manifest, Placement, Row } from '@ketvietlab/ketjs'

/**
 * Whether the deployment can still draw what is about to go live.
 *
 * `saveEntry` checks a layout against the sections that exist, and nothing else
 * did. Publishing, restoring an old revision, and freezing a publication all
 * took the stored layout as given - so a page that used a section from a module
 * the deployment has since dropped could be made live, and the renderer would
 * raise `E_UNKNOWN_SECTION` at a visitor rather than at the editor who could
 * have fixed it. A five hundred on the storefront is the worst place to learn
 * that a module was removed.
 */
export const layoutOf = (revision: Row | null | undefined): Placement[] => {
  const raw = revision?.layout
  const parsed = typeof raw === 'string' ? safeJson(raw) : raw
  return Array.isArray(parsed) ? (parsed as Placement[]) : []
}

const safeJson = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/** Every section type the document places, at any depth, without duplicates. */
export const sectionTypesIn = (layout: readonly Placement[]): string[] => {
  const types = new Set<string>()
  for (const { placement } of walkPlacements(layout))
    if (placement && typeof placement.type === 'string') types.add(placement.type)
  return [...types].sort()
}

/**
 * The types this deployment no longer provides.
 *
 * Cheap on purpose: a publication records the distinct types it froze, so the
 * final gate before content goes live costs one pass over a handful of names
 * rather than a re-read of every revision in the set.
 */
export const missingSectionTypes = (manifest: Manifest, types: unknown): string[] => {
  const declared = Array.isArray(types) ? types : []
  return declared
    .filter((type): type is string => typeof type === 'string')
    .filter((type) => !manifest.sections[type])
    .sort()
}

export type EntryPreflight = {
  entryId: string
  path: string
  revisionId: string | null
  errors: LayoutError[]
}

/** What is wrong with one entry's current revision, if anything. */
export const preflightEntry = async (ctx: Ctx, entry: Row): Promise<EntryPreflight> => {
  const revisionId = entry.currentRevisionId == null ? null : String(entry.currentRevisionId)
  const base = { entryId: String(entry.id), path: String(entry.path), revisionId }
  if (!revisionId) return { ...base, errors: [] }
  const revision = (await ctx.db.select('website.EntryRevision', { id: revisionId }))[0]
  if (!revision) return { ...base, errors: [] }
  return { ...base, errors: validateLayout(ctx.manifest, layoutOf(revision)).errors }
}
