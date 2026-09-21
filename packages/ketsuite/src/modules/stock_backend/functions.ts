import type { FnSpec } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import {
  locationListSearch,
  lotListSearch,
  pickingTypeListSearch,
  replenishmentListSearch,
  stockRouteListSearch,
  transferListSearch,
  warehouseListSearch,
} from './search.ts'

/**
 * The search-filter bar's functions, once for every stock list.
 *
 * The bar names the list it is on through `listKey`, so these four serve all of
 * them. They read nothing but the viewer's own saved searches: a stock list
 * narrows rows it has already been authorised to read.
 */
export const functions: Record<string, FnSpec> = listSearchFilterFunctions(
  (
    [
      [warehouseListSearch, '/admin/stock/warehouses'],
      [transferListSearch, '/admin/stock/transfers'],
      [locationListSearch, '/admin/stock/locations'],
      [pickingTypeListSearch, '/admin/stock/picking-types'],
      [lotListSearch, '/admin/stock/lots'],
      [stockRouteListSearch, '/admin/stock/routes'],
      [replenishmentListSearch, '/admin/stock/replenishment'],
    ] as const
  ).map(([spec, path]) => ({ key: spec.key, path, spec: () => spec })),
)
