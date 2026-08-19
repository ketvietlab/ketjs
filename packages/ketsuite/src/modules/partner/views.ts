import type { ViewDef } from 'ketjs'

/** What a theme may read of a party. Deliberately not vat, not ref, not email. */
export const views: Record<string, ViewDef> = {
  partner: { of: 'partner.Partner', fields: ['id', 'name', 'kind'] },
  address: { of: 'partner.Address', fields: ['id', 'street', 'street2', 'city', 'zip', 'state', 'country'] },
}
