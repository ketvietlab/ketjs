// Validating a page layout against the sections that exist.
//
// This is the payoff for making sections data rather than code: what an agent
// writes can be checked before it is stored, against the same declaration the
// theme renders from. A bad section type, a missing required setting, or a setting
// of the wrong shape are all caught here — as a list, not as an exception, because
// a list is what an agent can act on.

import { isDateText, parseType } from './types.ts'
import type { Manifest } from '../types.ts'

export type Placement = { type: string; settings?: Record<string, unknown> }
export type LayoutError = { at: number; type: string; field?: string; message: string }

const JS_OF: Record<string, string> = {
  id: 'string',
  text: 'string',
  ref: 'string',
  int: 'number',
  float: 'number',
  bool: 'boolean',
  date: 'string',
  datetime: 'string',
  json: 'object',
}

export function validateLayout(manifest: Manifest, layout: unknown): { ok: boolean; errors: LayoutError[] } {
  const errors: LayoutError[] = []
  if (!Array.isArray(layout)) {
    return {
      ok: false,
      errors: [{ at: -1, type: '(layout)', message: 'a layout must be an array of section placements' }],
    }
  }

  layout.forEach((raw, at) => {
    const placement = raw as Placement
    if (!placement || typeof placement.type !== 'string') {
      errors.push({ at, type: '(unknown)', message: 'each placement needs a "type"' })
      return
    }
    const section = manifest.sections[placement.type]
    if (!section) {
      errors.push({
        at,
        type: placement.type,
        message: `no composed module provides this section (available: ${Object.keys(manifest.sections).join(', ') || 'none'})`,
      })
      return
    }
    const schema = section.settings ?? {}
    const settings = placement.settings ?? {}

    for (const [field, spec] of Object.entries(schema)) {
      const t = parseType(spec)
      const value = settings[field]
      if (value == null) {
        if (t.ok && !t.optional)
          errors.push({ at, type: placement.type, field, message: `is required (${spec})` })
        continue
      }
      if (!t.ok) continue
      const want = JS_OF[t.base]
      if (want && typeof value !== want) {
        errors.push({ at, type: placement.type, field, message: `expects ${t.base}, got ${typeof value}` })
      } else if (t.base === 'date' && !isDateText(value)) {
        errors.push({ at, type: placement.type, field, message: 'expects date in YYYY-MM-DD format' })
      }
    }
    for (const field of Object.keys(settings)) {
      if (!(field in schema)) {
        errors.push({
          at,
          type: placement.type,
          field,
          message: `is not a setting of this section (accepted: ${Object.keys(schema).join(', ') || 'none'})`,
        })
      }
    }
  })

  return { ok: errors.length === 0, errors }
}

export const formatLayoutErrors = (errors: LayoutError[]): string =>
  errors.map((e) => `  [${e.at}] ${e.type}${e.field ? '.' + e.field : ''} ${e.message}`).join('\n')

// ---------------------------------------------------------------------------
// Placement identity
//
// A layout used to be an ordered array and nothing else, so a saved revision
// could not say whether a section had moved or had been deleted and a new one
// added in its place. Everything an editor needs downstream - undo, a diff
// between two revisions, a conflict that says what conflicted - rests on being
// able to answer that, and none of it can be recovered from position alone.
//
// The id lives beside `type` rather than inside `settings`: it is not something
// a section declares or a theme renders, and putting it in `settings` would
// make it collide with a real setting and fail validation.

/** How long a derived id is. Long enough not to collide, short enough to read. */
const DERIVED_ID_LENGTH = 16

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}

/** A placement id is opaque, but it has to survive a round trip through JSON. */
export const isPlacementId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value)

export type IdentifiedPlacement = Placement & { id: string }

/**
 * Give every placement an id, deriving one only where none exists.
 *
 * Derived from the content, not the position, and disambiguated by how many
 * identical placements came before it. Deriving from the index instead would
 * mean that the first save after a reorder - the one that turns legacy content
 * into identified content - renamed everything it touched, which is precisely
 * the case the id exists to distinguish.
 *
 * An id already present is never replaced, so identity survives every later
 * save regardless of what this function would have derived.
 */
export const withPlacementIds = (
  layout: readonly Placement[],
  digest: (input: string) => string,
): IdentifiedPlacement[] => {
  const seen = new Map<string, number>()
  return layout.map((placement) => {
    const existing = (placement as { id?: unknown }).id
    if (isPlacementId(existing)) return { ...placement, id: existing }
    const fingerprint = `${placement.type} ${canonical(placement.settings ?? {})}`
    const ordinal = seen.get(fingerprint) ?? 0
    seen.set(fingerprint, ordinal + 1)
    return { ...placement, id: digest(`${fingerprint} ${ordinal}`).slice(0, DERIVED_ID_LENGTH) }
  })
}

/** Ids a layout cannot have: malformed, or the same one twice. */
export const placementIdErrors = (layout: readonly Placement[]): LayoutError[] => {
  const errors: LayoutError[] = []
  const seen = new Set<string>()
  layout.forEach((placement, at) => {
    const id = (placement as { id?: unknown }).id
    if (id === undefined) return
    if (!isPlacementId(id)) {
      errors.push({ at, type: placement?.type ?? '(unknown)', field: 'id', message: 'is not a placement id' })
      return
    }
    if (seen.has(id))
      errors.push({
        at,
        type: placement?.type ?? '(unknown)',
        field: 'id',
        // Two placements sharing an id make every later diff ambiguous, so this
        // is refused at the write rather than resolved by guessing at the read.
        message: 'is already used by another placement in this layout',
      })
    seen.add(id)
  })
  return errors
}

export type PlacementChange =
  | { id: string; type: string; change: 'added'; at: number }
  | { id: string; type: string; change: 'removed'; at: number }
  | { id: string; type: string; change: 'moved'; from: number; at: number }
  | { id: string; type: string; change: 'settings'; at: number; fields: string[] }
  | { id: string; type: string; change: 'retyped'; at: number; from: string }

const changedSettings = (before: unknown, after: unknown): string[] => {
  const a = (before ?? {}) as Record<string, unknown>
  const b = (after ?? {}) as Record<string, unknown>
  const names = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...names].filter((name) => canonical(a[name]) !== canonical(b[name])).sort()
}

/**
 * What changed between two layouts, said per placement rather than per index.
 *
 * Only placements carrying ids can be compared this way. Anything without one
 * is reported as removed and added, which is the truthful answer: with no id
 * there is no evidence the two are the same section.
 */
export const diffPlacements = (
  before: readonly Placement[],
  after: readonly Placement[],
): PlacementChange[] => {
  const index = (layout: readonly Placement[]) => {
    const map = new Map<string, { placement: Placement; at: number }>()
    layout.forEach((placement, at) => {
      const id = (placement as { id?: unknown }).id
      if (isPlacementId(id)) map.set(id, { placement, at })
    })
    return map
  }
  const from = index(before)
  const to = index(after)
  const changes: PlacementChange[] = []

  for (const [id, entry] of from)
    if (!to.has(id)) changes.push({ id, type: entry.placement.type, change: 'removed', at: entry.at })

  for (const [id, entry] of to) {
    const previous = from.get(id)
    if (!previous) {
      changes.push({ id, type: entry.placement.type, change: 'added', at: entry.at })
      continue
    }
    if (previous.placement.type !== entry.placement.type) {
      // A placement that changed type is a different section wearing the same
      // id. Reported on its own so a reviewer never reads it as an edit.
      changes.push({
        id,
        type: entry.placement.type,
        change: 'retyped',
        at: entry.at,
        from: previous.placement.type,
      })
      continue
    }
    const fields = changedSettings(previous.placement.settings, entry.placement.settings)
    if (fields.length)
      changes.push({ id, type: entry.placement.type, change: 'settings', at: entry.at, fields })
    if (previous.at !== entry.at)
      changes.push({ id, type: entry.placement.type, change: 'moved', from: previous.at, at: entry.at })
  }

  return changes.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
