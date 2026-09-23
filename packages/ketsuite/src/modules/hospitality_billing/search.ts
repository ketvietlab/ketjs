// What the search-filter bar offers on the two billing lists.
//
// Both are complete collections held in memory, and both are read for one
// reason: what is not billable yet. So the presets say that in the words the
// status column already uses — a rule that is missing, a folio that is blocked,
// unbilled, owing or paid.
import { defineRowList } from '../backend/row-list.ts'
import { CHARGE_TYPES } from '../hospitality_core/types.ts'

export const chargeRuleListSearch = defineRowList({
  key: 'hospitality.charge-rules',
  searchable: [{ key: 'chargeType' }, { key: 'incomeAccountName' }, { key: 'taxName' }],
  filterable: [
    {
      key: 'chargeType',
      label: 'hospitality_billing.chargeRules.chargeType',
      type: 'selection',
      choices: CHARGE_TYPES,
    },
    { key: 'configured', label: 'hospitality_billing.col.state', type: 'boolean' },
    { key: 'incomeAccountName', label: 'hospitality_billing.chargeRules.incomeAccount', type: 'text' },
    { key: 'taxName', label: 'hospitality_billing.chargeRules.tax', type: 'text' },
  ],
  groupable: [{ key: 'configured', label: 'hospitality_billing.col.state' }],
  sortable: [{ key: 'chargeType', label: 'hospitality_billing.chargeRules.chargeType' }],
  presets: [
    {
      key: 'configured',
      label: 'hospitality_billing.chargeRules.configured',
      group: 'state',
      match: (row) => row.configured === true,
    },
    {
      key: 'missing',
      label: 'hospitality_billing.chargeRules.missing',
      group: 'state',
      match: (row) => row.configured !== true,
    },
    {
      key: 'taxExempt',
      label: 'hospitality_billing.chargeRules.taxExempt',
      group: 'tax',
      match: (row) => row.taxExempt === true,
    },
  ],
})

export const folioBillingListSearch = defineRowList({
  key: 'hospitality.billing',
  searchable: [{ key: 'folioCode' }, { key: 'guest' }, { key: 'moveName' }],
  filterable: [
    { key: 'folioCode', label: 'hospitality_billing.col.folio', type: 'text' },
    { key: 'guest', label: 'hospitality_billing.col.guest', type: 'text' },
    { key: 'folioTotal', label: 'hospitality_billing.col.charges', type: 'number' },
    { key: 'moveName', label: 'hospitality_billing.col.invoice', type: 'text' },
    { key: 'amountDue', label: 'hospitality_billing.col.due', type: 'number' },
  ],
  sortable: [
    { key: 'folioCode', label: 'hospitality_billing.col.folio' },
    { key: 'folioTotal', label: 'hospitality_billing.col.charges' },
    { key: 'amountDue', label: 'hospitality_billing.col.due' },
  ],
  presets: [
    {
      // What the state column says, in the order it decides it.
      key: 'blocked',
      label: 'hospitality_billing.filter.blocked',
      group: 'state',
      match: (row) => ((row.blockers as unknown[]) ?? []).length > 0,
    },
    {
      key: 'unbilled',
      label: 'hospitality_billing.state.unbilled',
      group: 'state',
      match: (row) => ((row.blockers as unknown[]) ?? []).length === 0 && !row.moveId,
    },
    {
      key: 'owing',
      label: 'hospitality_billing.state.owing',
      group: 'state',
      match: (row) =>
        ((row.blockers as unknown[]) ?? []).length === 0 &&
        Boolean(row.moveId) &&
        row.paymentState !== 'paid',
    },
    {
      key: 'paid',
      label: 'hospitality_billing.state.paid',
      group: 'state',
      match: (row) => ((row.blockers as unknown[]) ?? []).length === 0 && row.paymentState === 'paid',
    },
  ],
  defaultSort: [{ key: 'folioCode', dir: 'asc' }],
})
