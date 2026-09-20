import type { FnSpec } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import {
  ledgerListSearch,
  membershipListSearch,
  programListSearch,
  tierListSearch,
  walletListSearch,
} from './search.ts'

/** The bar's functions for every loyalty list; `listKey` says which list. */
export const searchFilterFunctions: Record<string, FnSpec> = listSearchFilterFunctions(
  (
    [
      [programListSearch, '/admin/loyalty/programs'],
      [walletListSearch, '/admin/loyalty/wallets'],
      [ledgerListSearch, '/admin/loyalty/ledger'],
      [membershipListSearch, '/admin/loyalty/memberships'],
      [tierListSearch, '/admin/loyalty/tiers'],
    ] as const
  ).map(([spec, path]) => ({ key: spec.key, path, spec: () => spec })),
)
