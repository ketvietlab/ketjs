import type { FnSpec } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import { posOrderListSearch } from './search.ts'

/** The bar's functions for the POS order list. */
export const searchFilterFunctions: Record<string, FnSpec> = listSearchFilterFunctions([
  { key: posOrderListSearch.key, path: '/admin/pos/orders', spec: () => posOrderListSearch },
])
