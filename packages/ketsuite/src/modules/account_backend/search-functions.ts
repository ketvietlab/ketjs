import type { FnSpec } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import { accountListSpecs } from './search.ts'

/** The bar's functions for every accounting list; `listKey` says which list. */
export const searchFilterFunctions: Record<string, FnSpec> = listSearchFilterFunctions(
  accountListSpecs.map(({ spec, path }) => ({ key: spec.key, path, spec: () => spec })),
)
