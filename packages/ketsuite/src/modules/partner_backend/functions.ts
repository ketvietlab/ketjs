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
      lang: 'text?',
      cols: 'text?',
    },
    output: { href: 'text' },
    effects: [],
    handler: (_ctx: Ctx, a) => {
      const facets = Array.isArray(a.facets) ? (a.facets as Facet[]) : []
      // The UI holds old and newly selected chips until the navigation below
      // completes. The newest compatible facet is the user's latest intent.
      const latest = (matches: (facet: Facet) => boolean) => [...facets].reverse().find(matches)
      const searchLabel = latest((facet) => facet.type === 'field')?.label
      const roleId = latest(
        (facet) => facet.type === 'filter' && (facet.id === 'customer' || facet.id === 'supplier'),
      )?.id
      const role = roleId === 'customer' || roleId === 'supplier' ? roleId : undefined
      const archived = facets.some((facet) => facet.type === 'filter' && facet.id === 'archived')
      const group = latest((facet) => facet.type === 'groupBy' && GROUP_KEYS.has(facet.id))?.id

      const params = new URLSearchParams()
      if (searchLabel) params.set('q', searchLabel)
      if (role) params.set('role', role)
      if (archived) params.set('archived', '1')
      if (group) params.set('groupBy', group)
      if (a.lang) params.set('lang', String(a.lang))
      if (a.cols) params.set('cols', String(a.cols))
      const query = params.toString()
      return { href: query ? `${LIST_PATH}?${query}` : LIST_PATH }
    },
  }),
}
