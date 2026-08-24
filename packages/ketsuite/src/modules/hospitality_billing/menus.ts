import type { MenuDef } from '@ketvietlab/ketjs'

/**
 * Under the hotel app rather than under accounting.
 *
 * The person who bills a folio is at the front desk, not in the finance office,
 * and they arrive here from a checkout — not from a chart of accounts.
 */
export const menus: Record<string, MenuDef> = {
  'hospitality.billing': {
    parent: 'hospitality.operations',
    label: 'menu.billing',
    path: '/admin/hospitality/billing',
    needs: 'hospitality_billing.getFolioBilling',
    sequence: 56,
  },
  'hospitality.billingRules': {
    parent: 'hospitality.configuration',
    label: 'menu.chargeRules',
    path: '/admin/hospitality/billing/rules',
    needs: 'hospitality_billing.listChargeRules',
    sequence: 40,
  },
}
