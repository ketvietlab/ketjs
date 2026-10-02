import type { FnSpec } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import { chargeRuleListSearch, folioBillingListSearch } from './search.ts'

/** The bar's functions for both billing lists; `listKey` says which list. */
export const searchFilterFunctions: Record<string, FnSpec> = listSearchFilterFunctions([
  {
    key: folioBillingListSearch.key,
    path: '/admin/hospitality/billing',
    spec: () => folioBillingListSearch,
  },
  {
    key: chargeRuleListSearch.key,
    path: '/admin/hospitality/billing/rules',
    spec: () => chargeRuleListSearch,
  },
])
