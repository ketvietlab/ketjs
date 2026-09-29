import type { FnSpec } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import { userListSearch, roleListSearch, accessPolicyListSearch } from './search.ts'

/** The bar's functions for every identity list; `listKey` says which list. */
export const searchFilterFunctions: Record<string, FnSpec> = listSearchFilterFunctions(
  (
    [
      [userListSearch, '/admin/users'],
      [roleListSearch, '/admin/roles'],
      [accessPolicyListSearch, '/admin/access-policies'],
    ] as const
  ).map(([spec, path]) => ({
    key: spec.key,
    path,
    spec: () => spec,
  })),
)
