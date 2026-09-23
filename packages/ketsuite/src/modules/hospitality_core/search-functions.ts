import type { FnSpec } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import {
  amenityListSearch,
  folioListSearch,
  policyListSearch,
  propertyListSearch,
  stayListSearch,
} from './search.ts'

/**
 * The search-filter bar's functions, once for every hospitality list.
 *
 * The bar names the list it is on through `listKey`, so these four serve all of
 * them. They read nothing but the viewer's own saved searches; the rows a bar
 * narrows were already read under the list's own permission.
 */
export const searchFilterFunctions: Record<string, FnSpec> = listSearchFilterFunctions(
  (
    [
      [stayListSearch, '/admin/hospitality/stays'],
      [folioListSearch, '/admin/hospitality/folios'],
      [propertyListSearch, '/admin/hospitality/properties'],
      [amenityListSearch, '/admin/hospitality/amenities'],
      [policyListSearch, '/admin/hospitality/policies'],
    ] as const
  ).map(([spec, path]) => ({ key: spec.key, path, spec: () => spec })),
)
