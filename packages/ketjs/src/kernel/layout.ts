// Validating a page layout against the sections that exist.
//
// This is the payoff for making sections data rather than code: what an agent
// writes can be checked before it is stored, against the same declaration the
// theme renders from. A bad section type, a missing required setting, a setting
// of the wrong shape, a child in a slot that does not accept it - all caught
// here, as a list rather than an exception, because a list is what an agent can
// act on.

import { isDateText, parseType } from './types.ts'
import type { Manifest, SlotDef } from '../types.ts'

export type Placement = {
  type: string
  settings?: Record<string, unknown>
  /**
   * Stable identity, assigned on save. Optional on the way in - a caller may
   * omit it and be given one - and present on everything that has been stored.
   */
  id?: string
  /** Sections this one holds, by the slot name its type declares. */
  slots?: Record<string, Placement[]>
}

export type LayoutError = {
  /** Index within the parent's list. Kept for callers written before nesting. */
  at: number
  type: string
  field?: string
  /** Where in the tree, as `index.slot.index`. Absent at the top level. */
  path?: string
  message: string
}

/** A page is a page, not a filesystem: deep enough for real work, and bounded. */
export const MAX_LAYOUT_DEPTH = 6

/**
 * Nodes in the whole tree, not placements at the top.
 *
 * The old ceiling was a hundred top-level placements. Counting the tree instead
 * keeps the same number honest: without it, a hundred containers each holding a
 * hundred children would pass a check that was written to bound a page.
 */
export const MAX_LAYOUT_NODES = 100

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

const slotsOf = (placement: Placement): Array<[string, Placement[]]> => {
  const slots = placement.slots
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) return []
  return Object.entries(slots).map(([name, children]) => [name, Array.isArray(children) ? children : []])
}

/** Every placement in the tree, parents before children. */
export const walkPlacements = function* (
  layout: readonly Placement[],
  path = '',
): Generator<{ placement: Placement; at: number; path: string }> {
  for (let at = 0; at < layout.length; at += 1) {
    const placement = layout[at] as Placement
    const here = path ? `${path}.${at}` : String(at)
    yield { placement, at, path: here }
    if (!placement || typeof placement !== 'object') continue
    for (const [slot, children] of slotsOf(placement)) yield* walkPlacements(children, `${here}.${slot}`)
  }
}

export const countPlacements = (layout: readonly Placement[]): number => {
  let total = 0
  for (const _ of walkPlacements(layout)) total += 1
  return total
}

export function validateLayout(manifest: Manifest, layout: unknown): { ok: boolean; errors: LayoutError[] } {
  if (!Array.isArray(layout)) {
    return {
      ok: false,
      errors: [{ at: -1, type: '(layout)', message: 'a layout must be an array of section placements' }],
    }
  }
  const errors: LayoutError[] = []
  const nodes = countPlacements(layout as Placement[])
  if (nodes > MAX_LAYOUT_NODES)
    errors.push({
      at: -1,
      type: '(layout)',
      message: `holds ${nodes} sections, and a page may hold ${MAX_LAYOUT_NODES}`,
    })
  validateInto(manifest, layout as Placement[], errors, '', 1)
  return { ok: errors.length === 0, errors }
}

const validateInto = (
  manifest: Manifest,
  layout: readonly Placement[],
  errors: LayoutError[],
  path: string,
  depth: number,
): void => {
  layout.forEach((raw, at) => {
    const here = path ? `${path}.${at}` : String(at)
    const nested = path ? { path: here } : {}
    const placement = raw as Placement
    if (!placement || typeof placement.type !== 'string') {
      errors.push({ at, type: '(unknown)', ...nested, message: 'each placement needs a "type"' })
      return
    }
    const section = manifest.sections[placement.type]
    if (!section) {
      errors.push({
        at,
        type: placement.type,
        ...nested,
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
          errors.push({ at, type: placement.type, field, ...nested, message: `is required (${spec})` })
        continue
      }
      if (!t.ok) continue
      const want = JS_OF[t.base]
      if (want && typeof value !== want) {
        errors.push({
          at,
          type: placement.type,
          field,
          ...nested,
          message: `expects ${t.base}, got ${typeof value}`,
        })
      } else if (t.base === 'date' && !isDateText(value)) {
        errors.push({
          at,
          type: placement.type,
          field,
          ...nested,
          message: 'expects date in YYYY-MM-DD format',
        })
      }
    }
    for (const field of Object.keys(settings)) {
      if (!(field in schema)) {
        errors.push({
          at,
          type: placement.type,
          field,
          ...nested,
          message: `is not a setting of this section (accepted: ${Object.keys(schema).join(', ') || 'none'})`,
        })
      }
    }

    validateSlots(manifest, placement, section.slots ?? {}, errors, at, here, depth)
  })
}

const validateSlots = (
  manifest: Manifest,
  placement: Placement,
  declared: Record<string, SlotDef>,
  errors: LayoutError[],
  at: number,
  here: string,
  depth: number,
): void => {
  for (const [slot, children] of slotsOf(placement)) {
    const rule = declared[slot]
    if (!rule) {
      // A section that declares no slot for this name cannot hold anything
      // under it. Silently dropping the children would lose an author's work
      // between the save and the render.
      errors.push({
        at,
        type: placement.type,
        field: slot,
        path: `${here}.${slot}`,
        message: `is not a slot of this section (accepted: ${Object.keys(declared).join(', ') || 'none'})`,
      })
      continue
    }
    if (depth >= MAX_LAYOUT_DEPTH && children.length) {
      errors.push({
        at,
        type: placement.type,
        field: slot,
        path: `${here}.${slot}`,
        message: `nests deeper than ${MAX_LAYOUT_DEPTH} levels`,
      })
      continue
    }
    if (rule.max != null && children.length > rule.max) {
      errors.push({
        at,
        type: placement.type,
        field: slot,
        path: `${here}.${slot}`,
        message: `holds ${children.length} sections, and this slot takes ${rule.max}`,
      })
    }
    if (rule.accepts) {
      const allowed = new Set(rule.accepts)
      children.forEach((child, childAt) => {
        const type = (child as Placement)?.type
        if (typeof type === 'string' && !allowed.has(type))
          errors.push({
            at: childAt,
            type,
            path: `${here}.${slot}.${childAt}`,
            message: `is not accepted by slot "${slot}" (accepted: ${rule.accepts?.join(', ')})`,
          })
      })
    }
    validateInto(manifest, children, errors, `${here}.${slot}`, depth + 1)
  }
}

export const formatLayoutErrors = (errors: LayoutError[]): string =>
  errors.map((e) => `  [${e.path ?? e.at}] ${e.type}${e.field ? '.' + e.field : ''} ${e.message}`).join('\n')

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
 * Give every placement in the tree an id, deriving one only where none exists.
 *
 * Derived from the content, not the position, and disambiguated by how many
 * identical placements came before it. Deriving from the index instead would
 * mean that the first save after a reorder - the one that turns legacy content
 * into identified content - renamed everything it touched, which is precisely
 * the case the id exists to distinguish.
 *
 * A subtree is part of what a container says, so the derivation walks children
 * first and folds their ids in: two containers holding different things are
 * different containers, even when their own settings match.
 *
 * An id already present is never replaced, so identity survives every later
 * save regardless of what this function would have derived.
 */
export const withPlacementIds = (
  layout: readonly Placement[],
  digest: (input: string) => string,
  seen: Map<string, number> = new Map(),
): IdentifiedPlacement[] =>
  layout.map((placement) => {
    const slots = slotsOf(placement)
    const identified: Record<string, Placement[]> = {}
    for (const [slot, children] of slots) identified[slot] = withPlacementIds(children, digest, seen)
    const withSlots = slots.length ? { ...placement, slots: identified } : { ...placement }

    const existing = (placement as { id?: unknown }).id
    if (isPlacementId(existing)) return { ...withSlots, id: existing }
    const childIds = slots.flatMap(([slot, _]) =>
      (identified[slot] ?? []).map((child) => `${slot}:${(child as IdentifiedPlacement).id}`),
    )
    const fingerprint = `${placement.type} ${canonical(placement.settings ?? {})} ${childIds.join(',')}`
    const ordinal = seen.get(fingerprint) ?? 0
    seen.set(fingerprint, ordinal + 1)
    return { ...withSlots, id: digest(`${fingerprint} ${ordinal}`).slice(0, DERIVED_ID_LENGTH) }
  })

/** Ids a layout cannot have: malformed, or the same one twice anywhere in it. */
export const placementIdErrors = (layout: readonly Placement[]): LayoutError[] => {
  const errors: LayoutError[] = []
  const seen = new Set<string>()
  for (const { placement, at, path } of walkPlacements(layout)) {
    const id = (placement as { id?: unknown })?.id
    if (id === undefined) continue
    const where = path.includes('.') ? { path } : {}
    if (!isPlacementId(id)) {
      errors.push({
        at,
        type: placement?.type ?? '(unknown)',
        field: 'id',
        ...where,
        message: 'is not a placement id',
      })
      continue
    }
    if (seen.has(id))
      errors.push({
        at,
        type: placement?.type ?? '(unknown)',
        field: 'id',
        ...where,
        // Two placements sharing an id make every later diff ambiguous, so this
        // is refused at the write rather than resolved by guessing at the read.
        // Uniqueness is across the whole tree, not per level: a diff keyed on
        // id has no level to disambiguate with.
        message: 'is already used by another placement in this layout',
      })
    seen.add(id)
  }
  return errors
}

export type PlacementChange =
  | { id: string; type: string; change: 'added'; at: number; path: string }
  | { id: string; type: string; change: 'removed'; at: number; path: string }
  | { id: string; type: string; change: 'moved'; from: string; at: number; path: string }
  | { id: string; type: string; change: 'settings'; at: number; path: string; fields: string[] }
  | { id: string; type: string; change: 'retyped'; at: number; path: string; from: string }

const changedSettings = (before: unknown, after: unknown): string[] => {
  const a = (before ?? {}) as Record<string, unknown>
  const b = (after ?? {}) as Record<string, unknown>
  const names = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...names].filter((name) => canonical(a[name]) !== canonical(b[name])).sort()
}

/**
 * What changed between two layouts, said per placement rather than per index.
 *
 * The walk is the whole tree, so a setting changed six levels down is reported
 * on the node that changed. Comparing only the top level would have folded a
 * subtree edit into "the container's settings are the same" and said nothing.
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
    const map = new Map<string, { placement: Placement; at: number; path: string }>()
    for (const entry of walkPlacements(layout)) {
      const id = (entry.placement as { id?: unknown })?.id
      if (isPlacementId(id)) map.set(id, entry)
    }
    return map
  }
  const from = index(before)
  const to = index(after)
  const changes: PlacementChange[] = []

  for (const [id, entry] of from)
    if (!to.has(id))
      changes.push({ id, type: entry.placement.type, change: 'removed', at: entry.at, path: entry.path })

  for (const [id, entry] of to) {
    const previous = from.get(id)
    if (!previous) {
      changes.push({ id, type: entry.placement.type, change: 'added', at: entry.at, path: entry.path })
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
        path: entry.path,
        from: previous.placement.type,
      })
      continue
    }
    const fields = changedSettings(previous.placement.settings, entry.placement.settings)
    if (fields.length)
      changes.push({
        id,
        type: entry.placement.type,
        change: 'settings',
        at: entry.at,
        path: entry.path,
        fields,
      })
    // The path carries the slot and every ancestor, so a section dragged into
    // a different container reads as one move rather than as a removal from
    // one place and an arrival somewhere else.
    if (previous.path !== entry.path)
      changes.push({
        id,
        type: entry.placement.type,
        change: 'moved',
        at: entry.at,
        path: entry.path,
        from: previous.path,
      })
  }

  return changes.sort(
    (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}
