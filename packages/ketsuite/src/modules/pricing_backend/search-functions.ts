import type { FnSpec } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import { pricelistListSearch } from './search.ts'

/** The bar's functions for the pricelist list. */
export const searchFilterFunctions: Record<string, FnSpec> = listSearchFilterFunctions([
  {
    key: pricelistListSearch.key,
    path: '/admin/pricing/pricelists',
    spec: () => pricelistListSearch,
  },
])
