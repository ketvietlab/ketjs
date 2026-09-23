import type { FnSpec } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import { catalogListSearch } from './search.ts'

/** The bar's functions for the address catalogue list. */
export const searchFilterFunctions: Record<string, FnSpec> = listSearchFilterFunctions([
  { key: catalogListSearch.key, path: '/admin/addresses', spec: () => catalogListSearch },
])
