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
/** Optional lifecycle around a mounted island. A plain IslandView remains valid. */
export type IslandController = {
  view: IslandView
  update?(props: Readonly<IslandProps>): void
  dispose?(): void
}
/** Create one isolated instance from serializable server props. */
export type IslandFactory = (props: IslandProps) => IslandView | IslandController
export type IslandDefinition = {
  view: IslandFactory
  /** The only surrounding scope keys that may cross into the island. */
  props?: Record<string, string>
  /** Props that identify one persistent instance. Empty means one global instance. */
  key?: readonly string[]
  /** Browser module, relative to the declaring module's assets directory. */
  client?: string
  /** Named browser export; defaults to `default`. */
  export?: string
}
export type IslandRegistry = Record<string, IslandFactory>

const controllerOf = (created: IslandView | IslandController): IslandController =>
  typeof created === 'function' ? { view: created } : created

const jsonProps = (name: string, props: IslandProps): { raw: string; revived: IslandProps } => {
  const seen = new WeakSet<object>()
  const visit = (value: unknown): unknown => {
    if (value == null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('non-finite number')
      return value
    }
    if (typeof value !== 'object') throw new TypeError(typeof value)
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) throw new TypeError('invalid date')
      return value.toJSON()
    }
    if (seen.has(value)) throw new TypeError('cyclic value')
    seen.add(value)
    let out: unknown
    if (Array.isArray(value)) {
      out = value.map(visit)
    } else {
      const prototype = Object.getPrototypeOf(value)
      if (prototype !== null && prototype !== Object.prototype) throw new TypeError('non-plain object')
      const object = Object.create(null) as Record<string, unknown>
      for (const key of Object.keys(value as Record<string, unknown>).sort())
        object[key] = visit((value as Record<string, unknown>)[key])
      out = object
    }
    seen.delete(value)
    return out
  }

  try {
    const canonical = visit(props)
    const raw = JSON.stringify(canonical)
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

const islandKey = (name: string, props: IslandProps, fields?: readonly string[]): string => {
  if (fields === undefined) return jsonProps(name, props).raw
  const values = fields.map((field) => {
    if (!(field in props))
      throw new IslandError({
        code: 'E_ISLAND_KEY',
        message: `island "${name}" key prop "${field}" is missing`,
      })
    return props[field]
  })
  return JSON.stringify(values)
}

/**
 * Render an island to markup, carrying its props alongside so the client can
 * revive it with exactly the same input the server used. A different input would
 * mean a different tree, and hydration would rightly refuse it.
 */
export function renderIsland(
  name: string,
  factory: IslandFactory,
  props: IslandProps,
  options: { key?: readonly string[] } = {},
): string {
  const { raw, revived } = jsonProps(name, props)
  const key = islandKey(name, revived, options.key)
  const controller = controllerOf(factory(revived))
  try {
    return (
      `<${ISLAND_TAG} data-island="${escapeHtml(name)}" data-key="${escapeHtml(key)}" data-props="${escapeHtml(raw)}">` +
      renderToString(controller.view()) +
      `</${ISLAND_TAG}>`
    )
  } finally {
    controller.dispose?.()
  }
}

export type IslandElement = HostNode & {
  getAttribute(name: string): string | null
  setAttribute?(name: string, value: string): void
  querySelectorAll(sel: string): Iterable<IslandElement>
  childNodes?: Iterable<IslandElement>
  parentNode?: IslandElement | null
}

export type HydratedIsland = {
  name: string
  key: string
  props: Readonly<IslandProps>
  element: IslandElement
  dispose(): void
}

export type IslandManager = {
  hydrate(root: IslandElement): HydratedIsland[]
  reconcile(slot: IslandElement, nextContent: IslandElement): HydratedIsland[]
  dispose(root: IslandElement): void
}

type ManagedIsland = {
  live: HydratedIsland
  controller: IslandController
  rawProps: string
}

const elementsOf = (root: IslandElement): IslandElement[] => {
  const out: IslandElement[] = []
  const nodeName =
    (root as unknown as { nodeName?: string; tagName?: string }).nodeName ??
    (root as unknown as { tagName?: string }).tagName
  if (nodeName?.toLowerCase() === ISLAND_TAG) out.push(root)
  out.push(...root.querySelectorAll(ISLAND_TAG))
  return out
}

const childrenOf = (root: IslandElement): IslandElement[] => [
  ...(root.childNodes ?? (root.children as Iterable<IslandElement> | undefined) ?? []),
]

const parsedProps = (name: string, element: IslandElement): { props: IslandProps; raw: string } => {
  const raw = element.getAttribute('data-props')
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : {}
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new TypeError()
    const normalized = jsonProps(name, parsed as IslandProps)
    return { props: normalized.revived, raw: normalized.raw }
  } catch {
    throw new IslandError({ code: 'E_ISLAND_PROPS', message: `island "${name}" has unreadable props` })
  }
}

const identityOf = (element: IslandElement): { name: string; key: string; id: string } | null => {
  const name = element.getAttribute('data-island')
  if (!name) return null
  const parsed = parsedProps(name, element)
  const key = element.getAttribute('data-key') ?? parsed.raw
  element.setAttribute?.('data-key', key)
  return { name, key, id: JSON.stringify([name, key]) }
}

const uniqueByIdentity = (elements: IslandElement[]): Map<string, IslandElement> => {
  const unique = new Map<string, IslandElement>()
  const duplicates = new Set<string>()
  for (const element of elements) {
    const identity = identityOf(element)
    if (!identity) continue
    if (unique.has(identity.id)) {
      duplicates.add(identity.id)
      unique.delete(identity.id)
    } else if (!duplicates.has(identity.id)) unique.set(identity.id, element)
  }
  return unique
}

export function createIslandManager(
  host: Host,
  registry: IslandRegistry,
  options: { strict?: boolean } = {},
): IslandManager {
  const instances = new WeakMap<IslandElement, ManagedIsland>()

  const disposeElement = (element: IslandElement): void => {
    const managed = instances.get(element)
    if (!managed) return
    instances.delete(element)
    managed.live.dispose()
  }

  const hydrate = (root: IslandElement): HydratedIsland[] => {
    const out: HydratedIsland[] = []
    for (const element of elementsOf(root)) {
      const existing = instances.get(element)
      if (existing) {
        out.push(existing.live)
        continue
      }
      const identity = identityOf(element)
      if (!identity) continue
      const factory = registry[identity.name]
      if (!factory) {
        if (options.strict === false) continue
        throw new IslandError({
          code: 'E_UNKNOWN_ISLAND',
          message: `the page places island "${identity.name}", which no installed module provides`,
          hint: `registered islands: ${Object.keys(registry).join(', ') || '(none)'}`,
        })
      }
      const parsed = parsedProps(identity.name, element)
      const controller = controllerOf(factory(parsed.props))
      const mounted = mountHydrated(host, element, controller.view)
      let disposed = false
      const live: HydratedIsland = {
        name: identity.name,
        key: identity.key,
        props: parsed.props,
        element,
        dispose: () => {
          if (disposed) return
          disposed = true
          mounted.dispose()
          controller.dispose?.()
        },
      }
      instances.set(element, { live, controller, rawProps: parsed.raw })
      out.push(live)
    }
    return out
  }

  const reconcile = (slot: IslandElement, nextContent: IslandElement): HydratedIsland[] => {
    const current = elementsOf(slot)
    const next = elementsOf(nextContent)
    const currentById = uniqueByIdentity(current)
    const nextById = uniqueByIdentity(next)
    const preserved = new Set<IslandElement>()

    for (const [id, nextElement] of nextById) {
      const currentElement = currentById.get(id)
      const managed = currentElement ? instances.get(currentElement) : undefined
      if (!currentElement || !managed) continue
      const identity = identityOf(nextElement) as { name: string; key: string; id: string }
      const parsed = parsedProps(identity.name, nextElement)
      if (managed.rawProps !== parsed.raw) {
        if (!managed.controller.update) continue
        managed.controller.update(parsed.props)
        managed.rawProps = parsed.raw
        managed.live.props = parsed.props
        currentElement.setAttribute?.('data-props', parsed.raw)
        currentElement.setAttribute?.('data-key', identity.key)
      }
      const parent = nextElement.parentNode ?? (nextElement.parent as IslandElement | null)
      if (!parent) continue
      host.insert(parent, currentElement, nextElement)
      host.remove(nextElement)
      preserved.add(currentElement)
    }

    for (const element of current) if (!preserved.has(element)) disposeElement(element)
    for (const child of childrenOf(slot)) host.remove(child)
    for (const child of childrenOf(nextContent)) host.insert(slot, child, null)
    return hydrate(slot)
  }

  return {
    hydrate,
    reconcile,
    dispose: (root) => {
      for (const element of elementsOf(root)) disposeElement(element)
    },
  }
}

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
  return createIslandManager(host, registry, options).hydrate(root)
}
