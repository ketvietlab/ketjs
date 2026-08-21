import type { ViewDef } from '@ketvietlab/ketjs'

/** What a theme may read of a party. Deliberately not vat, not ref, not email. */
export const views: Record<string, ViewDef> = {
  partner: { of: 'partner.Partner', fields: ['id', 'name', 'kind'] },
  address: {
    of: 'partner.Address',
    fields: [
      'id',
      'street1',
      'street2',
      'locality',
      'postalCode',
      'countryCode',
      'countryId',
      'divisionId',
      'divisionText',
    ],
  },
}
