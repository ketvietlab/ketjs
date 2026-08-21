import type { RelationDef } from '@ketvietlab/ketjs'

/** Declared both ways where both are useful. Nothing loads itself (D10). */
export const relations: Record<string, Record<string, RelationDef>> = {
  'partner.Partner': {
    addresses: { hasMany: 'partner.Address', by: 'partnerId' },
    addressDefaults: { hasMany: 'partner.AddressDefault', by: 'partnerId' },
    roles: { hasMany: 'partner.Role', by: 'partnerId' },
    children: { hasMany: 'partner.Partner', by: 'parentId' },
    parent: { belongsTo: 'partner.Partner', by: 'parentId' },
  },
  'partner.Address': {
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
    country: { belongsTo: 'address.Country', by: 'countryId' },
    division: { belongsTo: 'address.Division', by: 'divisionId' },
  },
  'partner.AddressDefault': {
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
    address: { belongsTo: 'partner.Address', by: 'addressId' },
  },
  'partner.Role': {
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
  },
  /**
   * One direction only, and the framework insisted.
   *
   * A `Partner.terms` hasMany was written first and refused at compose with
   * E_RELATION_WIDENS_SCOPE: preloading it from a shared row would hand back every
   * company's terms at once. SAP reads KNB1 by (customer, company code) for exactly
   * the same reason — the segment is reached from the scoped side, never from the
   * shared one.
   */
  'partner.CompanyTerms': {
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
  },
}
