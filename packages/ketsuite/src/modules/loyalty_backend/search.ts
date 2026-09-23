// What the search-filter bar offers on the loyalty lists.
//
// Two shapes meet here. Programs, wallets, the point ledger and memberships are
// paged and filtered by their own domain functions, so their specs declare only
// what those functions can answer — a query and the enumerable states — and
// their routes map the bar's presets onto the call. The relational choices a
// reader makes by name (which program, which wallet, which tier) stay in the
// screen's own selectors beside the bar, the way website content kept its site
// selector, because the bar's presets are a fixed list and those are not.
//
// Tiers are a small complete collection, so they get the full row filter.
import { defineRowList } from '../backend/row-list.ts'
import { LEDGER_OPERATIONS, PROGRAM_TYPES } from '../loyalty/types.ts'
import type { ListSearchShape } from '@ketvietlab/ketjs'

const PROGRAM_STATES = ['draft', 'running', 'upcoming', 'archived', 'ended'] as const

export const programListSearch: ListSearchShape = {
  key: 'loyalty.programs',
  searchable: [{ key: 'name' }],
  sortable: [],
  presets: [
    ...PROGRAM_STATES.map((state) => ({
      key: state,
      label: `loyalty_backend.state.${state}`,
      group: 'state',
    })),
    ...PROGRAM_TYPES.map((type) => ({
      key: type,
      label: `loyalty_backend.programType.${type}`,
      group: 'programType',
    })),
  ],
}

const WALLET_STATES = ['active', 'locked', 'expired'] as const

export const walletListSearch: ListSearchShape = {
  key: 'loyalty.wallets',
  searchable: [{ key: 'code' }],
  sortable: [],
  presets: WALLET_STATES.map((state) => ({
    key: state,
    label: `loyalty_backend.state.${state === 'active' ? 'running' : state}`,
    group: 'state',
  })),
}

const LEDGER_PERIODS = ['month', 'quarter', 'year', 'all'] as const

export const ledgerListSearch: ListSearchShape = {
  key: 'loyalty.ledger',
  searchable: [],
  sortable: [],
  presets: [
    ...LEDGER_PERIODS.map((period) => ({
      key: `period-${period}`,
      label: `loyalty_backend.period.${period}`,
      group: 'period',
    })),
    ...LEDGER_OPERATIONS.map((operation) => ({
      key: operation,
      label: `loyalty_backend.operation.${operation}`,
      group: 'operation',
    })),
  ],
}

export const membershipListSearch: ListSearchShape = {
  key: 'loyalty.memberships',
  searchable: [],
  sortable: [],
  presets: [
    { key: 'active', label: 'loyalty_backend.state.active', group: 'state' },
    { key: 'dormant', label: 'loyalty_backend.state.dormant', group: 'state' },
  ],
}

export const tierListSearch = defineRowList({
  key: 'loyalty.tiers',
  searchable: [{ key: 'name' }, { key: 'code' }],
  filterable: [
    { key: 'name', label: 'loyalty_backend.field.name', type: 'text' },
    { key: 'code', label: 'loyalty_backend.field.code', type: 'text' },
    { key: 'sequence', label: 'loyalty_backend.field.sequence', type: 'number' },
    { key: 'active', label: 'loyalty_backend.field.state', type: 'boolean' },
  ],
  sortable: [
    { key: 'sequence', label: 'loyalty_backend.field.sequence' },
    { key: 'name', label: 'loyalty_backend.field.name' },
  ],
  defaultSort: [{ key: 'sequence', dir: 'asc' }],
})
