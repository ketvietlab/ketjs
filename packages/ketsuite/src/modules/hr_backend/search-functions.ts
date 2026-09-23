import type { FnSpec } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import { employeeListSearch, leaveListSearch } from './search.ts'

/** The bar's functions for every HR list; `listKey` says which list. */
export const searchFilterFunctions: Record<string, FnSpec> = listSearchFilterFunctions(
  (
    [
      [employeeListSearch, '/admin/hr'],
      [leaveListSearch, '/admin/hr/leaves'],
    ] as const
  ).map(([spec, path]) => ({ key: spec.key, path, spec: () => spec })),
)
