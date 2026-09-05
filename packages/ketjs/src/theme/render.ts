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
   * every composed module's tokens flat: with two themes selected the one that
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
  // Islands come from modules; the theme only names them.
  const islands: IslandRegistry = {}
  for (const m of modules) {
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
  })

  /**
   * Which placement is being rendered, so that a `slot` tag inside its template
   * can find its children.
   *
   * A stack rather than a scope key: children are already-rendered markup, and
   * a scope carries values a template may print. Putting markup where `{{ }}`
   * can reach it would either escape it into visible tag soup or open a hole,
   * and reserving a scope name would collide with a section that wanted it.
   * Rendering is synchronous, so a stack is exact.
   */
  const openSlots: Array<{ slots: Record<string, unknown>; page: unknown }> = []

  /**
   * A page's body is its layout: an ordered list of placements, each rendered by
   * the template named after its section type. The theme decides how a section
   * looks; the data decides which sections there are and in what order.
   *
   * A placement may carry children under the slot names its section declares.
   * They render through this same path, so a nested section is rendered by the
   * same template and checked against the same manifest as a top-level one.
   */
  const renderSectionsAt = (scope: Scope): string => {
    const layout = scope['sections']
    if (!Array.isArray(layout)) return ''
    const out: string[] = []
    for (const raw of layout) {
      const placement = raw as {
        type?: string
        settings?: Record<string, unknown>
        slots?: Record<string, unknown>
      }
      if (!placement?.type) continue
      if (!manifest.sections[placement.type]) {
        throw new KetError({
          code: 'E_UNKNOWN_SECTION',
          message: `the page places section "${placement.type}", which no composed module provides`,
          hint: `available sections: ${Object.keys(manifest.sections).join(', ') || '(none)'}`,
        })
      }
      const slots =
        placement.slots && typeof placement.slots === 'object' && !Array.isArray(placement.slots)
          ? placement.slots
          : {}
      openSlots.push({ slots, page: scope['page'] })
      try {
        out.push(
          renderRegion(placement.type, {
            ...sectionSettings(manifest.sections[placement.type]?.settings ?? {}, placement.settings ?? {}),
            // The one key a section gets that is not one of its settings: which page
            // it sits on. Declared nowhere because it is not the author's to declare.
            page: scope['page'],
          }),
        )
      } finally {
        openSlots.pop()
      }
    }
    return out.join('')
  }

  /**
   * The children a placement put in one of its slots.
   *
   * An empty slot renders nothing rather than raising: a container with an
   * empty column is an ordinary state of a page being built, not a fault. A
   * slot the section never declared is caught at the write by validateLayout,
   * which is where an author can still do something about it.
   */
  const renderSlotAt = (name: string, _scope: Scope): string => {
    const open = openSlots[openSlots.length - 1]
    const children = open?.slots?.[name]
    if (!Array.isArray(children) || !children.length) return ''
    return renderSectionsAt({ sections: children, page: open?.page } as Scope)
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
        message: `${from} renders "${name}", which no composed module provides`,
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
    renderSlot: renderSlotAt,
    renderTemplate,
  }

  for (const [joint, sourcesForJoint] of Object.entries(fillSources)) {
    fills[joint] = sourcesForJoint.map((fill, i) => {
      const compiled = compileKtl(fill.template, { ...opts, name: `${joint}#${i}`, ...compileOpts })
      assertFillReach(manifest, { joint, by: fill.by }, compiled)
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
          message: `template "${name}" renders joint "${j}", which no composed module publishes`,
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
          message: `template "${name}" places island "${island}", which no composed module provides`,
          hint: `provided islands: ${Object.keys(manifest.islands).join(', ') || '(none)'}`,
        })
      }
    }
  }

  return { renderRegion, templates, islands, clients, tokensCss }
}
