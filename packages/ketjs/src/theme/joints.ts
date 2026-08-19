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

import { compileKtl } from './ktl/compile.ts'
import { sealScope } from './viewmodel.ts'
import { trustedMarkup } from 'ketjs-view'
import type { Markup } from 'ketjs-view'
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

export function createJoints(manifest: Manifest, o: { translate?: (key: string, params?: Record<string, unknown>) => string } = {}): Joints {
  // Compiled once. A fill is KTL source, so compiling per request would parse the
  // same text on every page view.
  const compiled = new Map<string, Array<ReturnType<typeof compileKtl>>>()
  for (const fill of manifest.fills) {
    const list = compiled.get(fill.joint) ?? []
    list.push(compileKtl(fill.template, {
      name: `${fill.joint}#${list.length}`,
      ...(o.translate ? { translate: o.translate } : {}),
    }))
    compiled.set(fill.joint, list)
  }

  const omitted = (key: string): boolean => (manifest.joints[key]?.omittedBy.length ?? 0) > 0

  return {
    shows: (key) => !omitted(key),
    render(key, props = {}) {
      if (omitted(key)) return trustedMarkup('')
      const list = compiled.get(key)
      if (!list?.length) return trustedMarkup('')
      // sealScope is what keeps a function out of a template's reach — the same
      // guard the theme runtime applies, for the same reason.
      const scope = sealScope(props)
      return trustedMarkup(list.map(c => c.render(scope)).join(''))
    },
  }
}
