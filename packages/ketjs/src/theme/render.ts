// Rendering a page through a theme: templates are KTL, joints are filled by
// whatever modules published fills for them, and the scope is a sealed set of drops.

import { compileKtl } from './ktl/compile.ts'
import type { Compiled, Filter, Scope } from './ktl/compile.ts'
import type { IslandRegistry } from '@ketvietlab/ketjs-view'
import { sealScope } from './viewmodel.ts'
import { sectionSettings } from './contracts.ts'
import { assertFillReach, createJointWiring } from './joint-runtime.ts'
import type { CompiledFill } from './joint-runtime.ts'
import { tokensToCss } from './tokens.ts'
import { KetError } from '../kernel/errors.ts'
import type { KetModule, Manifest } from '../types.ts'

export type ThemeRuntime = {
  renderRegion(name: string, scope: Scope): string
  templates: Record<string, Compiled>
  islands: IslandRegistry
  clients: Record<string, { src: string; export: string }>
  /**
   * The declared tokens of everything this theme actually renders with, as CSS.
   *
   * Composed here rather than from `manifest.tokens` because the manifest merges
   * every installed module's tokens flat: with two themes installed the one that
   * happens to sort later would win over the one the site selected.
   */
  tokensCss: string
}

export function createTheme(
  manifest: Manifest,
  modules: KetModule[],
  opts: {
    filters?: Record<string, Filter>
    translate?: (key: string, params?: Record<string, unknown>) => string
    /** Select one theme when the deployment ships several. Non-theme module templates remain available. */
    theme?: string
  } = {},
): ThemeRuntime {
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
    for (const [name, def] of Object.entries(m.islands)) islands[name] = def.view
  }
  const clients = Object.fromEntries(
    Object.entries(manifest.islands)
      .filter(([, island]) => island.client !== undefined)
      .map(([name, island]) => [name, island.client as { src: string; export: string }]),
  )
  const sources: Record<string, string> = {}
  const templateOwner: Record<string, KetModule> = {}
  // Tokens follow the templates exactly: whatever renders this page is what gets to
  // name a colour. Reading manifest.tokens instead would hand a deployment with two
  // themes installed the tokens of whichever one composed last.
  const tokens: Record<string, string> = {}
  for (const m of modules) {
    if (off.has(m.name)) continue // a removed theme contributes no templates
    if (m.kind === 'theme' && opts.theme && m.name !== opts.theme) continue
    Object.assign(tokens, m.tokens)
    for (const [name, src] of Object.entries(m.templates)) {
      const previous = templateOwner[name]
      // A theme overriding a module's template is the whole point of a theme. Two
      // modules claiming one name is not an override, it is a collision, and it used
      // to resolve silently by composition order — so which markup rendered depended
      // on the dependency graph rather than on anybody's decision.
      if (previous && previous.kind !== 'theme' && m.kind !== 'theme') {
        throw new KetError({
          code: 'E_TEMPLATE_DUPLICATE',
          module: m.name,
          message: `template "${name}" is already provided by "${previous.name}"`,
          hint: 'rename one of them, or move the shared markup into a template both render',
        })
      }
      templateOwner[name] = m
      sources[name] = src
    }
  }
  const tokensCss = Object.keys(tokens).length ? tokensToCss(tokens) : ''

  const fillSources: Record<string, Array<{ by: string; template: string }>> = {}
  for (const fill of manifest.fills) {
    const owner = manifest.modules[fill.by]
    if (owner?.kind === 'theme' && opts.theme && fill.by !== opts.theme) continue
    ;(fillSources[fill.joint] ??= []).push(fill)
  }

  const templates: Record<string, Compiled> = {}
  const fills: Record<string, CompiledFill[]> = {}

  const wiring = createJointWiring(manifest, {
    fillsFor: (joint) => fills[joint] ?? [],
    islands,
    atRuntime,
  })

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
      out.push(
        renderRegion(placement.type, {
          ...sectionSettings(manifest.sections[placement.type]?.settings ?? {}, placement.settings ?? {}),
          // The one key a section gets that is not one of its settings: which page
          // it sits on. Declared nowhere because it is not the author's to declare.
          page: scope['page'],
        }),
      )
    }
    return out.join('')
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

  /**
   * {% render %}. The depth cap exists because a template naming itself is a
   * stack overflow, and a stack overflow in a stranger's theme is a 500 with no
   * explanation. The error says which template and where instead.
   */
  const MAX_RENDER_DEPTH = 16
  let depth = 0
  const renderTemplate = (name: string, scope: Scope, from: string): string => {
    const t = templates[name]
    if (!t) {
      throw new KetError({
        code: 'E_TEMPLATE_NOT_FOUND',
        message: `${from} renders "${name}", which no installed module provides`,
        hint: `available templates: ${Object.keys(templates).sort().join(', ') || '(none)'}`,
      })
    }
    if (depth >= MAX_RENDER_DEPTH) {
      throw new KetError({
        code: 'E_RENDER_TOO_DEEP',
        message: `${from} renders "${name}" more than ${MAX_RENDER_DEPTH} levels deep`,
        hint: 'a template that renders itself, directly or through another, will not terminate',
      })
    }
    depth++
    try {
      return t.render(scope)
    } finally {
      depth--
    }
  }

  const compileOpts = {
    renderJoint: wiring.renderJoint,
    renderIsland: wiring.renderIsland,
    renderRegion,
    renderSections: renderSectionsAt,
    renderTemplate,
  }

  for (const [joint, sourcesForJoint] of Object.entries(fillSources)) {
    fills[joint] = sourcesForJoint.map((fill, i) => {
      const compiled = compileKtl(fill.template, { ...opts, name: `${joint}#${i}`, ...compileOpts })
      assertFillReach(manifest, { joint, by: fill.by }, compiled, { atRuntime })
      return { by: fill.by, compiled }
    })
  }
  for (const [name, src] of Object.entries(sources)) {
    templates[name] = compileKtl(src, { ...opts, name, ...compileOpts })
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

  return { renderRegion, templates, islands, clients, tokensCss }
}
