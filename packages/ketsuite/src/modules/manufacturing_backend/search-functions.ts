import type { FnSpec } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import { bomListSearch, productionListSearch, workCenterListSearch } from './search.ts'

/** The bar's functions for every manufacturing list; `listKey` says which list. */
export const searchFilterFunctions: Record<string, FnSpec> = listSearchFilterFunctions(
  (
    [
      [productionListSearch, '/admin/manufacturing'],
      [bomListSearch, '/admin/manufacturing/boms'],
      [workCenterListSearch, '/admin/manufacturing/work-centers'],
    ] as const
  ).map(([spec, path]) => ({ key: spec.key, path, spec: () => spec })),
)
