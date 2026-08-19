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
  // A theme is written against what the DEPLOYMENT ships, not against what a
  // particular database has switched on. So the strict check belongs to the full
  // manifest — where a typo is a build error — while a restricted manifest, which
  // is a runtime view, degrades to rendering nothing. Uninstalling an app must not
  // take the whole theme down with it.
  const atRuntime = manifest.disabledModules !== undefined
  const off = new Set(manifest.disabledModules ?? [])
  const disabledSections = new Set(manifest.disabledSections ?? [])
  // Islands come from modules; the theme only names them.
  const islands: IslandRegistry = {}
  for (const m of modules) {
    if (off.has(m.name)) continue
    for (const [name, view] of Object.entries(m.islands)) islands[name] = view
  }
  const sources: Record<string, string> = {}
  for (const m of modules) {
    if (off.has(m.name)) continue      // a removed theme contributes no templates
    for (const [name, src] of Object.entries(m.templates)) sources[name] = src
  }

  const fillSources: Record<string, string[]> = {}
  for (const fill of manifest.fills) (fillSources[fill.joint] ??= []).push(fill.template)

  const templates: Record<string, Compiled> = {}
  const fills: Record<string, Compiled[]> = {}

  const renderJoint = (joint: string, scope: Scope): string =>
    (fills[joint] ?? []).map(c => c.render(scope)).join('')

  /**
   * A page's body is its layout: an ordered list of placements, each rendered by
   * the template named after its section type. The theme decides how a section
   * looks; the data decides which sections there are and in what order.
   */
  const renderSectionsAt = (scope: Scope): string => {
    const layout = scope['sections']
    if (!Array.isArray(layout)) return ''
    const out: string[] = []
    for (const raw of layout) {
      const placement = raw as { type?: string; settings?: Record<string, unknown> }
      if (!placement?.type) continue
      if (!manifest.sections[placement.type]) {
        // A page saved while an app was installed still names its sections after it
        // is removed. Skip those; re-installing brings them back with their data.
        if (atRuntime && disabledSections.has(placement.type)) continue
        if (atRuntime) {
          // Named by no app this deployment has ever shipped: leave a mark rather
          // than pretend the page was always this length.
          out.push(`<!-- ket: unknown section "${placement.type}" -->`)
          continue
        }
        throw new KetError({
          code: 'E_UNKNOWN_SECTION',
          message: `the page places section "${placement.type}", which no installed module provides`,
          hint: `available sections: ${Object.keys(manifest.sections).join(', ') || '(none)'}`,
        })
      }
      out.push(renderRegion(placement.type, { ...(placement.settings ?? {}), page: scope['page'] }))
    }
    return out.join('')
  }

  const renderIslandAt = (name: string, scope: Scope): string => {
    const view = islands[name]
    if (!view || (atRuntime && !manifest.islands[name])) {
      if (atRuntime) return ''
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
    fills[joint] = srcs.map((src, i) => compileKtl(src, { ...opts, name: `${joint}#${i}`, renderJoint, renderRegion, renderIsland: renderIslandAt, renderSections: renderSectionsAt }))
  }
  for (const [name, src] of Object.entries(sources)) {
    templates[name] = compileKtl(src, { ...opts, name, renderJoint, renderRegion, renderIsland: renderIslandAt, renderSections: renderSectionsAt })
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
    for (const island of atRuntime ? [] : t.islandsUsed) {
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
