// View models ("drops") are the only data a theme may read.
//
// A drop is a null-prototype, frozen projection of exactly the fields the owning
// module declared in `views`. The ORM, the adapter and every server function stay
// on the other side of this boundary — a theme literally has no reference to reach.

import { KetError } from '../kernel/errors.ts'
import type { Manifest, Row } from '../types.ts'

export type Drop = Record<string, unknown>

/** The projection itself, once the fields have been decided. */
export function projectFields(row: Row, fields: readonly string[]): Drop {
  const drop = Object.create(null) as Drop
  for (const f of fields) drop[f] = row[f] ?? null
  return Object.freeze(drop)
}

export function makeDrop(manifest: Manifest, viewKey: string, row: Row): Drop {
  const view = manifest.views[viewKey]
  if (!view) {
    throw new KetError({
      code: 'E_UNKNOWN_VIEW',
      message: `no view model "${viewKey}"`,
      hint: `declared views: ${Object.keys(manifest.views).join(', ') || '(none)'}`,
    })
  }
  return projectFields(row, view.fields)
}

/**
 * Which fields of a view-typed prop one module may read: the ones the view's owner
 * declared, plus the ones that module declared itself over the same model.
 *
 * Not simply the named view. A module that adds a field with `extend` and then
 * publishes a view over it has declared that field theme-visible, and it is the one
 * module entitled to say so — refusing it here would mean the extension pillar and
 * the view boundary could not both be true, and `inventory` adding `leadTimeDays`
 * to `catalog.Product` and reading it back in a fill is the example the framework
 * leads with. What still cannot cross is a field nobody declared anywhere.
 */
export function visibleFields(manifest: Manifest, viewKey: string, reader?: string): readonly string[] {
  const view = manifest.views[viewKey]
  if (!view) return []
  if (reader === undefined || reader === view.by) return view.fields
  const fields = new Set(view.fields)
  for (const other of Object.values(manifest.views))
    if (other.by === reader && other.of === view.of) for (const f of other.fields) fields.add(f)
  return [...fields]
}

export function makeDrops(manifest: Manifest, viewKey: string, rows: Row[]): Drop[] {
  return rows.map((r) => makeDrop(manifest, viewKey, r))
}

/**
 * Where a function hides inside a value, as a readable path, or null when there is
 * none.
 *
 * One walker, because "a theme receives data only" has to mean the same thing at
 * every door into a theme. It used to be checked one level deep at the region door
 * and recursively at the joint door, so `{ order: { total: () => … } }` was refused
 * by one and waved through by the other.
 */
export function findCallable(value: unknown, path = '', seen = new WeakSet<object>()): string | null {
  if (typeof value === 'function') return path
  if (value == null || typeof value !== 'object') return null
  if (value instanceof Date) return null
  // A cycle cannot hide a function the walk has not already passed through.
  if (seen.has(value)) return null
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const found = findCallable(value[i], `${path}[${i}]`, seen)
        if (found !== null) return found
      }
      return null
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const found = findCallable(item, path ? `${path}.${key}` : key, seen)
      if (found !== null) return found
    }
    return null
  } finally {
    seen.delete(value)
  }
}

// Any value handed to a theme passes through here. Anything that is not plain data
// is refused rather than silently stringified.
export function sealScope(scope: Record<string, unknown>): Record<string, unknown> {
  const out = Object.create(null) as Record<string, unknown>
  for (const [k, v] of Object.entries(scope)) {
    const callable = findCallable(v, k)
    if (callable !== null) {
      throw new KetError({
        code: 'E_SCOPE_CALLABLE',
        message: `scope key "${callable}" is a function`,
        hint: 'themes receive data only; move behaviour into a server function',
      })
    }
    out[k] = v
  }
  return Object.freeze(out)
}
