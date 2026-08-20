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
import { contractProps } from './contracts.ts'
import { renderIsland, trustedMarkup } from 'ketjs-view'
import type { IslandRegistry, Markup } from 'ketjs-view'
import type { Manifest } from '../types.ts'
import { KetError } from '../kernel/errors.ts'

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
  const compiled = new Map<string, Array<ReturnType<typeof compileKtl>>>()
  const atRuntime = manifest.disabledModules !== undefined
  const stack: string[] = []
  const omitted = (key: string): boolean => (manifest.joints[key]?.omittedBy.length ?? 0) > 0

  const renderJoint = (key: string, props: Record<string, unknown>): string => {
    const definition = manifest.joints[key]
    if (!definition) {
      throw new KetError({
        code: 'E_UNKNOWN_JOINT',
        message: `no installed module publishes joint "${key}"`,
        hint: `published joints: ${Object.keys(manifest.joints).join(', ') || '(none)'}`,
      })
    }
    if (omitted(key)) return ''
    if (stack.includes(key)) {
      throw new KetError({
        code: 'E_JOINT_CYCLE',
        message: `joint recursion: ${[...stack, key].join(' -> ')}`,
        hint: 'a fill may render another joint, but never itself through any chain',
      })
    }
    if (stack.length >= 16)
      throw new KetError({ code: 'E_JOINT_TOO_DEEP', message: 'joint rendering exceeds 16 levels' })
    stack.push(key)
    try {
      const scope = contractProps(manifest, 'joint', key, definition.props, props)
      return (compiled.get(key) ?? []).map((entry) => entry.render(scope)).join('')
    } finally {
      stack.pop()
    }
  }

  const renderIslandAt = (name: string, scope: Record<string, unknown>): string => {
    const factory = o.islands?.[name]
    const definition = manifest.islands[name]
    if (!factory || !definition) {
      if (atRuntime) return ''
      throw new KetError({
        code: 'E_UNKNOWN_ISLAND',
        message: `a fill places island "${name}", which no installed module provides`,
        hint: `available islands: ${Object.keys(o.islands ?? {}).join(', ') || '(none)'}`,
      })
    }
    return renderIsland(name, factory, contractProps(manifest, 'island', name, definition.props, scope), {
      key: definition.key,
    })
  }

  for (const fill of manifest.fills) {
    const list = compiled.get(fill.joint) ?? []
    const entry = compileKtl(fill.template, {
      name: `${fill.joint}#${list.length}`,
      ...(o.translate ? { translate: o.translate } : {}),
      renderJoint,
      renderIsland: renderIslandAt,
    })
    const module = manifest.modules[fill.by]
    for (const used of entry.jointsUsed) {
      const target = manifest.joints[used]
      if (!target)
        throw new KetError({
          code: 'E_FILL_UNKNOWN_JOINT',
          module: fill.by,
          message: `fill for "${fill.joint}" renders unknown joint "${used}"`,
        })
      if (target.owner !== fill.by && !module?.depends?.includes(target.owner))
        throw new KetError({
          code: 'E_FILL_NOT_DEPENDED',
          module: fill.by,
          message: `fill for "${fill.joint}" renders "${used}" without depending on "${target.owner}"`,
        })
    }
    for (const used of entry.islandsUsed) {
      const target = manifest.islands[used]
      if (!target && !atRuntime)
        throw new KetError({
          code: 'E_FILL_UNKNOWN_ISLAND',
          module: fill.by,
          message: `fill for "${fill.joint}" places unknown island "${used}"`,
        })
      if (target && target.by !== fill.by && !module?.depends?.includes(target.by))
        throw new KetError({
          code: 'E_FILL_NOT_DEPENDED',
          module: fill.by,
          message: `fill for "${fill.joint}" places "${used}" without depending on "${target.by}"`,
        })
    }
    list.push(entry)
    compiled.set(fill.joint, list)
  }

  return {
    shows: (key) => {
      if (!manifest.joints[key]) {
        throw new KetError({
          code: 'E_UNKNOWN_JOINT',
          message: `no installed module publishes joint "${key}"`,
        })
      }
      return !omitted(key)
    },
    render(key, props = {}) {
      return trustedMarkup(renderJoint(key, props))
    },
  }
}
