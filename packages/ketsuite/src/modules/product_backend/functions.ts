import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import { productListSearch } from '../product/search.ts'
import { attributeSearchHref } from './attribute-search-state.ts'

export const functions: Record<string, FnSpec> = {
  applyAttributeSearchFilter: defineFn({
    input: {
      query: 'text?',
      returnTo: 'text?',
      facets: 'json?',
      filters: 'json?',
      groupBy: 'json?',
      favoriteId: 'text?',
      customFilters: 'json?',
    },
    output: { href: 'text' },
    effects: ['read:product.Attribute'],
    handler: (_ctx, args) => ({ href: attributeSearchHref(args) }),
  }),

  // The catalogue's search bar, on the shared implementation every list uses.
  ...listSearchFilterFunctions(
    [
      {
        key: 'product.templates',
        path: '/admin/product/templates',
        spec: (ctx) => productListSearch(ctx.table('product.Template')),
      },
    ],
    ['product.Template'],
  ),
}
