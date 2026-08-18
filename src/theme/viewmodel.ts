// View models ("drops") are the only data a theme may read.
//
// A drop is a null-prototype, frozen projection of exactly the fields the owning
// module declared in `views`. The ORM, the adapter and every server function stay
// on the other side of this boundary — a theme literally has no reference to reach.

import { KetError } from '../kernel/errors.ts'
import type { Manifest, Row } from '../types.ts'

export type Drop = Record<string, unknown>

export function makeDrop(manifest: Manifest, viewKey: string, row: Row): Drop {
  const view = manifest.views[viewKey]
  if (!view) {
    throw new KetError({
      code: 'E_UNKNOWN_VIEW', message: `no view model "${viewKey}"`,
      hint: `declared views: ${Object.keys(manifest.views).join(', ') || '(none)'}`,
    })
  }
  const drop = Object.create(null) as Drop
  for (const f of view.fields) drop[f] = row[f] ?? null
  return Object.freeze(drop)
}

export function makeDrops(manifest: Manifest, viewKey: string, rows: Row[]): Drop[] {
  return rows.map(r => makeDrop(manifest, viewKey, r))
}

// Any value handed to a theme passes through here. Anything that is not plain data
// is refused rather than silently stringified.
export function sealScope(scope: Record<string, unknown>): Record<string, unknown> {
  const out = Object.create(null) as Record<string, unknown>
  for (const [k, v] of Object.entries(scope)) {
    if (typeof v === 'function') {
      throw new KetError({ code: 'E_SCOPE_CALLABLE', message: `scope key "${k}" is a function`, hint: 'themes receive data only; move behaviour into a server function' })
    }
    out[k] = v
  }
  return Object.freeze(out)
}
