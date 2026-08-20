// Islands: the seam where a theme meets behaviour.
//
// The rule this implements is the one that keeps a third-party theme safe: a theme
// PLACES an island and never writes one. Placement is a KTL tag, which cannot carry
// code; the island itself is a module's `html` view, which is trusted. So the theme
// decides where interactivity goes and the module decides what it does, and neither
// can reach into the other.

import { renderToString } from './ssr.ts'
import { escapeHtml } from './host.ts'
import type { Host, HostNode } from './host.ts'
import type { TemplateResult } from './render.ts'
import { mountHydrated } from './mount.ts'

export const ISLAND_TAG = 'ket-island'

// The view layer carries its own errors rather than reaching into the kernel for
// them. That single import was the only thing pointing out of this layer, and it
// is what would have made the view and the kernel mutually dependent once they
// became separate packages.
export class IslandError extends Error {
  code: string
  hint: string | null
  constructor(d: { code: string; message: string; hint?: string }) {
    super(d.message)
    this.name = 'IslandError'
    this.code = d.code
    this.hint = d.hint ?? null
  }
}

export type IslandProps = Record<string, unknown>
/** One mounted island instance. Signals and other local state live in this closure. */
export type IslandView = () => TemplateResult
/** Create one isolated instance from serializable server props. */
export type IslandFactory = (props: IslandProps) => IslandView
export type IslandDefinition = {
  view: IslandFactory
  /** The only surrounding scope keys that may cross into the island. */
  props?: Record<string, string>
  /** Browser module, relative to the declaring module's assets directory. */
  client?: string
  /** Named browser export; defaults to `default`. */
  export?: string
}
export type IslandRegistry = Record<string, IslandFactory>

const jsonProps = (name: string, props: IslandProps): { raw: string; revived: IslandProps } => {
  const seen = new WeakSet<object>()
  const visit = (value: unknown): void => {
    if (value == null || typeof value === 'string' || typeof value === 'boolean') return
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('non-finite number')
      return
    }
    if (typeof value !== 'object') throw new TypeError(typeof value)
    if (value instanceof Date) return
    if (seen.has(value)) throw new TypeError('cyclic value')
    seen.add(value)
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
    } else {
      const prototype = Object.getPrototypeOf(value)
      if (prototype !== null && prototype !== Object.prototype) throw new TypeError('non-plain object')
      for (const item of Object.values(value as Record<string, unknown>)) visit(item)
    }
    seen.delete(value)
  }

  try {
    visit(props)
    const raw = JSON.stringify(props)
    const revived = JSON.parse(raw) as unknown
    if (typeof revived !== 'object' || revived === null || Array.isArray(revived))
      throw new TypeError('not an object')
    return { raw, revived: revived as IslandProps }
  } catch {
    throw new IslandError({
      code: 'E_ISLAND_PROPS',
      message: `island "${name}" received props that are not JSON-serializable`,
      hint: 'island props cross the server/browser boundary; pass plain JSON data only',
    })
  }
}

/**
 * Render an island to markup, carrying its props alongside so the client can
 * revive it with exactly the same input the server used. A different input would
 * mean a different tree, and hydration would rightly refuse it.
 */
export function renderIsland(name: string, factory: IslandFactory, props: IslandProps): string {
  const { raw, revived } = jsonProps(name, props)
  return (
    `<${ISLAND_TAG} data-island="${escapeHtml(name)}" data-props="${escapeHtml(raw)}">` +
    renderToString(factory(revived)()) +
    `</${ISLAND_TAG}>`
  )
}

type IslandElement = HostNode & {
  getAttribute(name: string): string | null
  querySelectorAll(sel: string): Iterable<IslandElement>
}

export type HydratedIsland = { name: string; element: IslandElement; dispose(): void }

/**
 * Find every island in a server-rendered page and bring it to life. Only the
 * islands are hydrated — the rest of the page stays inert markup, which is the
 * whole point of rendering a theme to a string in the first place.
 */
/*
 * Note the missing parameter: an earlier version took the mount function, and the
 * first caller passed the one that BUILDS rather than the one that ADOPTS — so the
 * island quietly rendered a second copy of itself beside the server's. An API that
 * makes the wrong choice expressible will eventually have it chosen.
 */
export function hydrateIslands(
  host: Host,
  root: IslandElement,
  registry: IslandRegistry,
  options: { strict?: boolean } = {},
): HydratedIsland[] {
  const out: HydratedIsland[] = []
  for (const element of root.querySelectorAll(ISLAND_TAG)) {
    const name = element.getAttribute('data-island')
    if (!name) continue
    const factory = registry[name]
    if (!factory) {
      if (options.strict === false) continue
      throw new IslandError({
        code: 'E_UNKNOWN_ISLAND',
        message: `the page places island "${name}", which no installed module provides`,
        hint: `registered islands: ${Object.keys(registry).join(', ') || '(none)'}`,
      })
    }
    let props: IslandProps = {}
    const raw = element.getAttribute('data-props')
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new TypeError()
        props = parsed as IslandProps
      } catch {
        throw new IslandError({ code: 'E_ISLAND_PROPS', message: `island "${name}" has unreadable props` })
      }
    }
    const mounted = mountHydrated(host, element, factory(props))
    out.push({ name, element, dispose: mounted.dispose })
  }
  return out
}
