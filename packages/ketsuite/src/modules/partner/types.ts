/** A party is a person or an organisation. Nothing else, and never both. */
export const PARTNER_KINDS = ['person', 'company'] as const
export type PartnerKind = (typeof PARTNER_KINDS)[number]

/**
 * What a party is *to us*, as rows rather than as columns.
 *
 * SAP keeps these in BUT100, one row per role, and a party can hold several at
 * once — a supplier who is also a customer is one party with two rows. the domain contract uses
 * counters on the party itself, which means
 * adding a role means adding a column to a table that already has about 120.
 */
export const PARTNER_ROLES = ['customer', 'supplier', 'employee'] as const
export type PartnerRole = (typeof PARTNER_ROLES)[number]

/** What an address is for. Only meaningful because addresses are their own model. */
export const ADDRESS_USES = ['contact', 'invoice', 'delivery', 'other'] as const
export type AddressUse = (typeof ADDRESS_USES)[number]
