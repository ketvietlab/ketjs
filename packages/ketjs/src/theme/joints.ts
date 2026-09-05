// Rendering a joint inside a first-party screen.
//
// The screens are `html`` ` — typed, interactive, ours. What fills them is KTL —
// stringly-typed, sandboxed, a stranger's. That split is deliberate and it is the
// same one the storefront already makes: the code that runs is ours, the code that
// extends is theirs and cannot run.
//
// The alternative was a fill that is a function. It would have been typed, and it
// would have been arbitrary JavaScript from another module running in this process
// — which is the thing KTL exists to prevent. It would also have made `fills` the
// first part of the manifest that is not data: unprintable by `ket manifest`,
// undiffable by `ket diff`, unsnapshotable. A fill is text.
//
// What a joint *does* when rendered lives in joint-runtime.ts, shared with the
// storefront: one behaviour, one set of error codes, whichever side asks for it.

import { compileKtl } from './ktl/compile.ts'
import { assertFillReach, createJointWiring } from './joint-runtime.ts'
import type { CompiledFill } from './joint-runtime.ts'
import { trustedMarkup } from '@ketvietlab/ketjs-view'
import type { IslandRegistry, Markup } from '@ketvietlab/ketjs-view'
import type { Manifest } from '../types.ts'

export type Joints = {
  /**
   * Every fill for this joint, rendered and concatenated in dependency order, so
   * a module that extends another appears after it.
   *
   * Empty when nobody fills it, and empty when somebody omitted it — an omitted
   * joint renders nothing at all, including the owner's own default.
   */
  render(key: string, props?: Record<string, unknown>): Markup
  /** Whether the owner's default content should render. False when omitted. */
  shows(key: string): boolean
}

export function createJoints(
  manifest: Manifest,
  o: {
    translate?: (key: string, params?: Record<string, unknown>) => string
    islands?: IslandRegistry
  } = {},
): Joints {
  // Compiled once. A fill is KTL source, so compiling per request would parse the
  // same text on every page view.
  const compiled = new Map<string, CompiledFill[]>()
  const wiring = createJointWiring(manifest, {
    fillsFor: (joint) => compiled.get(joint) ?? [],
    islands: o.islands ?? {},
  })

  for (const fill of manifest.fills) {
    const list = compiled.get(fill.joint) ?? []
    const entry = compileKtl(fill.template, {
      name: `${fill.joint}#${list.length}`,
      ...(o.translate ? { translate: o.translate } : {}),
      renderJoint: wiring.renderJoint,
      renderIsland: wiring.renderIsland,
    })
    assertFillReach(manifest, fill, entry)
    list.push({ by: fill.by, compiled: entry })
    compiled.set(fill.joint, list)
  }

  return {
    shows: (key) => wiring.shows(key),
    render: (key, props = {}) => trustedMarkup(wiring.renderJoint(key, props)),
  }
}
