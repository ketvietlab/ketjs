// Rendering a joint, and placing an island, wherever that happens.
//
// It happens in two places: a storefront theme (theme/render.ts) and a first-party
// screen (theme/joints.ts). They are different callers with different template
// sources, but "what a joint does when it is rendered" is one behaviour, and it was
// written out twice. The copies had already drifted — the same missing joint
// reported two different error codes depending on which side of the product you
// were standing on, and one of them took a whole tenant down when an island's
// module was switched off while the other degraded to nothing.

import { contractProps } from './contracts.ts'
import { renderIsland } from '@ketvietlab/ketjs-view'
import type { IslandRegistry } from '@ketvietlab/ketjs-view'
import type { Compiled, Scope } from './ktl/compile.ts'
import { KetError } from '../kernel/errors.ts'
import type { Manifest } from '../types.ts'

/** A fill may render another joint, but the chain has to end somewhere. */
export const MAX_JOINT_DEPTH = 16

/** One compiled fill, and the module that wrote it — which decides what it may read. */
export type CompiledFill = { by: string; compiled: Compiled }

export type JointWiring = {
  renderJoint(joint: string, scope: Scope): string
  renderIsland(name: string, scope: Scope): string
  /** False when an installed module asked for this joint to be gone. */
  shows(joint: string): boolean
}

export function createJointWiring(
  manifest: Manifest,
  o: {
    /** Read late: the fills are compiled with this wiring, so they cannot exist yet. */
    fillsFor: (joint: string) => readonly CompiledFill[]
    islands: IslandRegistry
    /**
     * True for a manifest restricted to what one database has switched on. A name
     * that is merely uninstalled degrades to nothing there; at build time the same
     * name is a typo and says so.
     */
    atRuntime: boolean
  },
): JointWiring {
  const stack: string[] = []
  const omitted = (joint: string): boolean => (manifest.joints[joint]?.omittedBy.length ?? 0) > 0

  const known = (joint: string) => {
    const definition = manifest.joints[joint]
    if (definition) return definition
    throw new KetError({
      code: 'E_UNKNOWN_JOINT',
      message: `no installed module publishes joint "${joint}"`,
      hint: `published joints: ${Object.keys(manifest.joints).join(', ') || '(none)'}`,
    })
  }

  return {
    shows(joint) {
      known(joint)
      return !omitted(joint)
    },
    renderJoint(joint, scope) {
      const definition = known(joint)
      if (omitted(joint)) return ''
      if (stack.includes(joint)) {
        throw new KetError({
          code: 'E_JOINT_CYCLE',
          message: `joint recursion: ${[...stack, joint].join(' -> ')}`,
          hint: 'a fill may render another joint, but never itself through any chain',
        })
      }
      if (stack.length >= MAX_JOINT_DEPTH) {
        throw new KetError({
          code: 'E_JOINT_TOO_DEEP',
          message: `joint rendering exceeds ${MAX_JOINT_DEPTH} levels`,
        })
      }
      stack.push(joint)
      try {
        // Contracted per fill rather than once for the joint: what crosses depends
        // on who is reading, because a module that extended the model declared its
        // own view over it and is entitled to the fields in it.
        return o
          .fillsFor(joint)
          .map((fill) =>
            fill.compiled.render(contractProps(manifest, 'joint', joint, definition.props, scope, fill.by)),
          )
          .join('')
      } finally {
        stack.pop()
      }
    },
    renderIsland(name, scope) {
      const factory = o.islands[name]
      const definition = manifest.islands[name]
      if (!factory || !definition) {
        if (o.atRuntime) return ''
        throw new KetError({
          code: 'E_UNKNOWN_ISLAND',
          message: `a template places island "${name}", which no installed module provides`,
          hint: `available islands: ${Object.keys(o.islands).join(', ') || '(none)'}`,
        })
      }
      return renderIsland(
        name,
        factory,
        contractProps(manifest, 'island', name, definition.props, scope, definition.by),
        { key: definition.key },
      )
    },
  }
}

/**
 * What a fill is allowed to reach for.
 *
 * A fill naming another module's joint or island without depending on it is a
 * decision about somebody else's screen made by a module that may not be installed
 * beside it — the same rule `omits` follows, checked at the same place for both.
 */
export function assertFillReach(
  manifest: Manifest,
  fill: { joint: string; by: string },
  compiled: Compiled,
  o: { atRuntime: boolean },
): void {
  const owner = manifest.modules[fill.by]
  for (const used of compiled.jointsUsed) {
    const target = manifest.joints[used]
    if (!target) {
      throw new KetError({
        code: 'E_FILL_UNKNOWN_JOINT',
        module: fill.by,
        message: `fill for "${fill.joint}" renders unknown joint "${used}"`,
      })
    }
    if (target.owner !== fill.by && !owner?.depends?.includes(target.owner)) {
      throw new KetError({
        code: 'E_FILL_NOT_DEPENDED',
        module: fill.by,
        message: `fill for "${fill.joint}" renders "${used}" without depending on "${target.owner}"`,
      })
    }
  }
  for (const used of compiled.islandsUsed) {
    const target = manifest.islands[used]
    if (!target) {
      // Switching an app off must not take the tenant's pages down with it. At
      // build time the same name has no module behind it at all, and that is a typo.
      if (o.atRuntime) continue
      throw new KetError({
        code: 'E_FILL_UNKNOWN_ISLAND',
        module: fill.by,
        message: `fill for "${fill.joint}" places unknown island "${used}"`,
      })
    }
    if (target.by !== fill.by && !owner?.depends?.includes(target.by)) {
      throw new KetError({
        code: 'E_FILL_NOT_DEPENDED',
        module: fill.by,
        message: `fill for "${fill.joint}" places "${used}" without depending on "${target.by}"`,
      })
    }
  }
}
