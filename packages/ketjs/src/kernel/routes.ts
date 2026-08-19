import { KetError } from './errors.ts'

export type RouteParams = Readonly<Record<string, string>>

type Segment = { kind: 'static'; value: string } | { kind: 'param'; name: string }

export type RoutePattern = {
  path: string
  segments: readonly Segment[]
  staticCount: number
}

const PARAM = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/

export function parseRoutePattern(path: string): RoutePattern {
  if (!path.startsWith('/')) {
    throw new KetError({ code: 'E_ROUTE_PATH', message: `route "${path}" must start with "/"` })
  }
  const names = new Set<string>()
  const parts = path === '/' ? [] : path.slice(1).split('/')
  const segments = parts.map((part): Segment => {
    const param = PARAM.exec(part)
    if (param) {
      const name = param[1] as string
      if (names.has(name)) {
        throw new KetError({
          code: 'E_ROUTE_PARAM_DUPLICATE',
          message: `route "${path}" declares parameter "${name}" more than once`,
        })
      }
      names.add(name)
      return { kind: 'param', name }
    }
    if (part.includes('{') || part.includes('}')) {
      throw new KetError({
        code: 'E_ROUTE_PATTERN',
        message: `route "${path}" has an invalid dynamic segment "${part}"`,
        hint: 'a dynamic segment occupies the whole segment, for example /products/{slug}',
      })
    }
    return { kind: 'static', value: decode(part, path) }
  })
  return { path, segments, staticCount: segments.filter((s) => s.kind === 'static').length }
}

const decode = (part: string, path: string): string => {
  try {
    return decodeURIComponent(part)
  } catch {
    throw new KetError({
      code: 'E_ROUTE_ENCODING',
      message: `route path "${path}" contains invalid percent encoding`,
    })
  }
}

/** True when both patterns can match one pathname and neither is more specific. */
export function ambiguousRoutes(a: RoutePattern, b: RoutePattern): boolean {
  if (a.segments.length !== b.segments.length || a.staticCount !== b.staticCount) return false
  return a.segments.every((segment, i) => {
    const other = b.segments[i] as Segment
    return segment.kind === 'param' || other.kind === 'param' || segment.value === other.value
  })
}

export function matchRoutePattern(pattern: RoutePattern, pathname: string): RouteParams | null {
  const raw = pathname === '/' ? [] : pathname.slice(1).split('/')
  if (raw.length !== pattern.segments.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pattern.segments.length; i += 1) {
    const segment = pattern.segments[i] as Segment
    const value = decode(raw[i] as string, pathname)
    if (segment.kind === 'static') {
      if (segment.value !== value) return null
    } else {
      params[segment.name] = value
    }
  }
  return params
}

export function compileRoutes<T>(routes: Record<string, T>): (pathname: string) => {
  path: string
  value: T
  params: RouteParams
} | null {
  const entries = Object.entries(routes).map(([path, value]) => ({ pattern: parseRoutePattern(path), value }))
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i]!.pattern
      const b = entries[j]!.pattern
      if (ambiguousRoutes(a, b)) {
        throw new KetError({
          code: 'E_ROUTE_AMBIGUOUS',
          message: `routes "${a.path}" and "${b.path}" can match the same path with equal priority`,
          hint: 'make one route more specific, or let one handler own both paths',
        })
      }
    }
  }
  entries.sort(
    (a, b) =>
      b.pattern.staticCount - a.pattern.staticCount ||
      b.pattern.segments.length - a.pattern.segments.length ||
      a.pattern.path.localeCompare(b.pattern.path),
  )
  return (pathname) => {
    for (const entry of entries) {
      const params = matchRoutePattern(entry.pattern, pathname)
      if (params) return { path: entry.pattern.path, value: entry.value, params }
    }
    return null
  }
}
