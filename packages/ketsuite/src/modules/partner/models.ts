import type { ModelDef } from '@ketvietlab/ketjs'

/**
 * Parties, and the three things Odoo folds into them.
 *
 * `res.partner` is one table for customer, supplier, contact, delivery address,
 * invoice address, legal entity and bank account owner. It works, and the cost is
 * visible in the model itself: `is_company` to ask whether this is a legal entity,
 * `type` to ask whether it is an address, and a computed `commercial_partner_id`
 * to answer the only question invoicing actually cares about — who do we bill.
 *
 * That third one is the tell. It exists *because* addresses are parties: when a
 * delivery address is itself a partner, the system has lost the ability to say who
 * the counterparty is, so it walks up the parent chain to recover it.
 *
 * SAP, Tryton and ERPNext all keep addresses separate, and SAP keeps roles as rows.
 * Doing the same here removes `commercial_partner_id` and `type` outright: the
 * party on a document *is* the party, and an address is an address.
 *
 * What is kept from Odoo: parties are shared across companies, one address book
 * for the tenant. That was decided when products were.
 */
export const models: Record<string, ModelDef> = {
  Partner: {
    scope: 'shared',
    fields: {
      id: 'id',
      // 'person' | 'company' — see types.ts. One required enum instead of a
      // boolean and a UI selection that have to agree.
      kind: 'text',
      name: 'text',
      /**
       * The organisation a person belongs to. Optional, and it no longer carries
       * addresses — so this means what it says rather than doubling as a filing
       * mechanism for a company's delivery points.
       */
      parentId: 'ref:partner.Partner?',
      vat: 'text?',
      /** The customer/supplier code a business already uses on paper. */
      ref: 'text?',
      email: 'text?',
      phone: 'text?',
      /** UI language for anything sent to them. Content is not translated (D14). */
      lang: 'text?',
      active: 'bool',
    },
  },

  /**
   * Addresses, separate — the change that pays for itself.
   *
   * A party has several; each says what it is for. A sales order names a party and
   * two addresses, where Odoo names three parties and then computes which of them
   * is the real counterparty.
   */
  Address: {
    scope: 'shared',
    fields: {
      id: 'id',
      partnerId: 'ref:partner.Partner',
      // 'contact' | 'invoice' | 'delivery' | 'other'
      use: 'text',
      street1: 'text',
      street2: 'text?',
      locality: 'text?',
      postalCode: 'text?',
      /** ISO alpha-2 remains available when a country has no installed catalog. */
      countryCode: 'text',
      countryId: 'ref:address.Country?',
      /** Deepest selected node; its parents provide every higher level. */
      divisionId: 'ref:address.Division?',
      /** Explicit fallback for countries without a packaged administrative catalog. */
      divisionText: 'text?',
    },
  },

  /**
   * The selected address for one purpose. A separate unique row makes the
   * invariant enforceable by PostgreSQL; a boolean on Address cannot prevent two
   * concurrent requests from both becoming default.
   */
  AddressDefault: {
    scope: 'shared',
    fields: {
      id: 'id',
      partnerId: 'ref:partner.Partner',
      use: 'text',
      addressId: 'ref:partner.Address',
    },
    indexes: {
      partner_use: { fields: ['partnerId', 'use'], unique: true },
      address: { fields: ['addressId'], unique: true },
    },
  },

  /** One row per role, as in SAP's BUT100. A party may hold several at once. */
  Role: {
    scope: 'shared',
    fields: {
      id: 'id',
      partnerId: 'ref:partner.Partner',
      // 'customer' | 'supplier' | 'employee'
      role: 'text',
    },
    indexes: { partner_role: { fields: ['partnerId', 'role'], unique: true } },
  },

  /**
   * The per-legal-entity segment of a party — SAP's KNB1, and the answer to what
   * Odoo solves with `ir.property`.
   *
   * The party is shared, but its payment terms and credit limit are not: the same
   * customer may be on 30 days with one company and prepayment with another.
   * Odoo stores that in a side table keyed by (field, company, record), which is
   * EAV: invisible to SQL, untyped, and the reason "it is blank in company B" is a
   * recurring support ticket. Here it is an ordinary company-scoped model, so the
   * scope machinery that already exists does the work and the columns are real.
   */
  CompanyTerms: {
    scope: 'company',
    fields: {
      id: 'id',
      partnerId: 'ref:partner.Partner',
      creditLimit: 'decimal?',
      note: 'text?',
    },
    indexes: { company_partner: { fields: ['companyId', 'partnerId'], unique: true } },
  },
}
