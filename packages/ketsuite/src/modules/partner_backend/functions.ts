import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'

type Facet = { id: string; type: string; label: string }

const LIST_PATH = '/admin/partner/partners'
const GROUP_KEYS = new Set(['kind', 'state'])

/**
 * `search-filter`'s `applyFunction` runs over the generic `/_ket/fn/`
 * transport, which only ever hands a handler a data `Ctx` — never the
 * `ServeContext` a route has, so there is no translator and no `ctx.joint`
 * here to re-render the page body with. What this *can* do, with nothing
 * but the facets the browser already holds, is the one thing search-filter
 * actually needs to move a URL-driven list: recompute the href its own
 * query params encode, exactly the same params `routes.ts`'s GET handler
 * already reads (`q`, `role`, `archived`, `groupBy`).
 */
export const functions: Record<string, FnSpec> = {
  applyFilter: defineFn({
    input: {
      query: 'text?',
      facets: 'json?',
      filters: 'json?',
      groupBy: 'json?',
      favoriteId: 'text?',
      customFilters: 'json?',
    },
    output: { href: 'text' },
    effects: [],
    handler: (_ctx: Ctx, a) => {
      const facets = Array.isArray(a.facets) ? (a.facets as Facet[]) : []
      const searchLabel = facets.find((facet) => facet.type === 'field')?.label
      const role = facets.find((facet) => facet.type === 'filter' && facet.id === 'customer')
        ? 'customer'
        : facets.find((facet) => facet.type === 'filter' && facet.id === 'supplier')
          ? 'supplier'
          : undefined
      const archived = facets.some((facet) => facet.type === 'filter' && facet.id === 'archived')
      const group = facets.find((facet) => facet.type === 'groupBy' && GROUP_KEYS.has(facet.id))?.id

      const params = new URLSearchParams()
      if (searchLabel) params.set('q', searchLabel)
      if (role) params.set('role', role)
      if (archived) params.set('archived', '1')
      if (group) params.set('groupBy', group)
      const query = params.toString()
      return { href: query ? `${LIST_PATH}?${query}` : LIST_PATH }
    },
  }),
}
