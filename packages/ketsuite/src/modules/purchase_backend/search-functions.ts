import type { FnSpec } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import { purchaseOrderListSearch, rfqListSearch, vendorPricelistListSearch } from './search.ts'

/** The bar's functions for every purchasing list; `listKey` says which list. */
export const searchFilterFunctions: Record<string, FnSpec> = listSearchFilterFunctions(
  (
    [
      [rfqListSearch, '/admin/purchase/rfqs'],
      [purchaseOrderListSearch, '/admin/purchase/orders'],
      [vendorPricelistListSearch, '/admin/purchase/vendor-pricelists'],
    ] as const
  ).map(([spec, path]) => ({ key: spec.key, path, spec: () => spec })),
)
