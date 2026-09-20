import type { FnSpec } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import { warehouseListSearch } from './search.ts'

/**
 * The search-filter bar's functions, once for every stock list.
 *
 * The bar names the list it is on through `listKey`, so these four serve all of
 * them. They read nothing but the viewer's own saved searches: a stock list
 * narrows rows it has already been authorised to read.
 */
export const functions: Record<string, FnSpec> = listSearchFilterFunctions([
  { key: warehouseListSearch.key, path: '/admin/stock/warehouses', spec: () => warehouseListSearch },
])
