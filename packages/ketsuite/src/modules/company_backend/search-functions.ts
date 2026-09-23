import type { FnSpec } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import { companyListSearch } from './search.ts'

/** The bar's functions for the company list; `listKey` says which list. */
export const searchFilterFunctions: Record<string, FnSpec> = listSearchFilterFunctions([
  { key: companyListSearch.key, path: '/admin/companies', spec: () => companyListSearch },
])
