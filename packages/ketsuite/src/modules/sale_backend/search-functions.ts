import type { FnSpec } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import { invoicingPolicyListSearch, quotationListSearch, saleOrderListSearch } from './search.ts'

/** The bar's functions for every sales list; `listKey` says which list. */
export const searchFilterFunctions: Record<string, FnSpec> = listSearchFilterFunctions(
  (
    [
      [quotationListSearch, '/admin/sales/quotations'],
      [saleOrderListSearch, '/admin/sales/orders'],
      [invoicingPolicyListSearch, '/admin/sales/invoicing-policies'],
    ] as const
  ).map(([spec, path]) => ({ key: spec.key, path, spec: () => spec })),
)
