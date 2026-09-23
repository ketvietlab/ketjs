/** URL state shared by the attribute list's real and fixture search transports. */
export const ATTRIBUTE_SEARCH_VALUES = {
  displayType: ['radio', 'pills', 'select', 'color', 'multi'],
  createVariant: ['always', 'no_variant'],
} as const
export type AttributeSearchPayload = {
  query?: unknown
  returnTo?: unknown
  facets?: unknown
  filters?: unknown
  groupBy?: unknown
  favoriteId?: unknown
  customFilters?: unknown
}
const COLLECTION_PATH = '/admin/product/attributes'
const MOCK_PATH = '/__atlas/product/screen'
const ORIGIN = 'http://ket.local'

const safeLocation = (returnTo: unknown, path: string): URL => {
  if (
    typeof returnTo !== 'string' ||
    !returnTo.startsWith('/') ||
    returnTo.startsWith('//') ||
    [...returnTo].some(
      (character) => character === '\\' || character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  )
    return new URL(path, ORIGIN)
  try {
    const candidate = new URL(returnTo, ORIGIN)
    if (candidate.origin === ORIGIN && candidate.pathname === path) return candidate
  } catch {
    // An invalid return target falls back to the collection, never another origin.
  }
  return new URL(path, ORIGIN)
}

/** Multiple presets in one group are OR'd; display type and variant policy are AND'd. */
export const attributeSearchHref = (
  payload: AttributeSearchPayload,
  options: { basePath?: typeof COLLECTION_PATH | typeof MOCK_PATH } = {},
): string => {
  const path = options.basePath === MOCK_PATH ? MOCK_PATH : COLLECTION_PATH
  const target = safeLocation(payload.returnTo, path)
  if (path === MOCK_PATH) target.searchParams.set('screen', 'attributes')
  for (const key of ['page', 'record', 'tab']) target.searchParams.delete(key)
  target.hash = ''
  const facets = Array.isArray(payload.facets)
    ? payload.facets.filter((facet): facet is { id?: unknown; type?: unknown; label?: unknown } =>
        Boolean(facet && typeof facet === 'object' && !Array.isArray(facet)),
      )
    : null
  const filters = facets
    ? facets.filter((facet) => facet.type === 'filter').map((facet) => facet.id)
    : Array.isArray(payload.filters)
      ? payload.filters
      : null
  if (filters) {
    for (const [key, allowed] of Object.entries(ATTRIBUTE_SEARCH_VALUES)) {
      const selected = allowed.filter((value) => filters.includes(`${key}:${value}`))
      if (selected.length) target.searchParams.set(key, selected.join(','))
      else target.searchParams.delete(key)
    }
  }
  if (typeof payload.query === 'string' || facets) {
    const query =
      (typeof payload.query === 'string' ? payload.query.trim() : '') ||
      [...(facets ?? [])].reverse().find((facet) => facet.type === 'field' && typeof facet.label === 'string')
        ?.label
    if (typeof query === 'string' && query.trim()) target.searchParams.set('q', query.trim())
    else target.searchParams.delete('q')
  }
  return target.pathname + target.search
}
