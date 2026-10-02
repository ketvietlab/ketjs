import type { FnSpec } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import { identityListSearch, providerListSearch } from './search.ts'

/** The bar's functions for both provider lists; `listKey` says which list. */
export const searchFilterFunctions: Record<string, FnSpec> = listSearchFilterFunctions(
  (
    [
      [providerListSearch, '/admin/oauth/providers'],
      [identityListSearch, '/admin/oauth/identities'],
    ] as const
  ).map(([spec, path]) => ({ key: spec.key, path, spec: () => spec })),
)
