// Rendering a page through a theme: templates are KTL, joints are filled by
// whatever modules published fills for them, and the scope is a sealed set of drops.

import { compileKtl } from './ktl/compile.ts'
import type { Compiled, Filter, Scope } from './ktl/compile.ts'
import { renderIsland } from 'ketjs-view'
import type { IslandRegistry } from 'ketjs-view'
import { sealScope } from './viewmodel.ts'
import { KetError } from '../kernel/errors.ts'
import type { KetModule, Manifest } from '../types.ts'

export type ThemeRuntime = {
  renderRegion(name: string, scope: Scope): string
  templates: Record<string, Compiled>
  islands: IslandRegistry
}

export function createTheme(manifest: Manifest, modules: KetModule[], opts: { filters?: Record<string, Filter> } = {}): ThemeRuntime {
  // Islands come from modules; the theme only names them.
  const islands: IslandRegistry = {}
  for (const m of modules) for (const [name, view] of Object.entries(m.islands)) islands[name] = view
  const sources: Record<string, string> = {}
  for (const m of modules) for (const [name, src] of Object.entries(m.templates)) sources[name] = src

  const fillSources: Record<string, string[]> = {}
  for (const fill of manifest.fills) (fillSources[fill.joint] ??= []).push(fill.template)

  const templates: Record<string, Compiled> = {}
  const fills: Record<string, Compiled[]> = {}

  const renderJoint = (joint: string, scope: Scope): string =>
    (fills[joint] ?? []).map(c => c.render(scope)).join('')

  const renderIslandAt = (name: string, scope: Scope): string => {
    const view = islands[name]
    if (!view) {
      throw new KetError({
        code: 'E_UNKNOWN_ISLAND',
        message: `a template places island "${name}", which no installed module provides`,
        hint: `available islands: ${Object.keys(islands).join(', ') || '(none)'}`,
      })
    }
    // Props are whatever the theme's scope already exposes: drops, never live objects.
    return renderIsland(name, view, { ...scope })
  }

  const renderRegion = (name: string, scope: Scope): string => {
    const t = templates[name]
    if (!t) {
      throw new KetError({
        code: 'E_REGION_NOT_RENDERABLE',
        message: `region "${name}" has no template`,
        hint: `available regions: ${Object.keys(templates).join(', ') || '(none)'}`,
      })
    }
    return t.render(sealScope(scope))
  }

  for (const [joint, srcs] of Object.entries(fillSources)) {
    fills[joint] = srcs.map((src, i) => compileKtl(src, { ...opts, name: `${joint}#${i}`, renderJoint, renderRegion, renderIsland: renderIslandAt }))
  }
  for (const [name, src] of Object.entries(sources)) {
    templates[name] = compileKtl(src, { ...opts, name, renderJoint, renderRegion, renderIsland: renderIslandAt })
  }

  // A theme that points at a joint nobody publishes is a build error, not a blank spot.
  for (const [name, t] of Object.entries(templates)) {
    for (const j of t.jointsUsed) {
      if (!manifest.joints[j]) {
        throw new KetError({
          code: 'E_TEMPLATE_UNKNOWN_JOINT',
          message: `template "${name}" renders joint "${j}", which no installed module publishes`,
          hint: `published joints: ${Object.keys(manifest.joints).join(', ') || '(none)'}`,
        })
      }
    }
  }

  // Placing an island nobody provides is a build error, exactly like a missing joint.
  for (const [name, t] of Object.entries(templates)) {
    for (const island of t.islandsUsed) {
      if (!manifest.islands[island]) {
        throw new KetError({
          code: 'E_TEMPLATE_UNKNOWN_ISLAND',
          message: `template "${name}" places island "${island}", which no installed module provides`,
          hint: `provided islands: ${Object.keys(manifest.islands).join(', ') || '(none)'}`,
        })
      }
    }
  }

  return { renderRegion, templates, islands }
}
