import type { ModelDef } from '@ketvietlab/ketjs'

/**
 * Legal entities.
 *
 * A company is backed by a party, as in Odoo and SAP: the organisation you invoice
 * from is an organisation, and it turns up in documents as a counterparty when two
 * of your own companies trade. Keeping one party model rather than a second
 * organisation model is the part of Odoo's design worth copying.
 *
 * `parentId` is a branch in the *organisational* sense — a subsidiary with its own
 * books. It is not the branch dimension on rows: that one lives in the scope
 * machinery and answers "which warehouse", not "which legal entity".
 *
 * Shared, not company-scoped, and deliberately: the list of companies has to be
 * readable to know which company a request could act as. A company-scoped list of
 * companies is a circle.
 */
export const models: Record<string, ModelDef> = {
  Company: {
    scope: 'shared',
    fields: {
      id: 'id',
      /** Stable business code used by provisioning, selectors and documents. */
      code: 'text',
      /** Its own party record — name, tax number and addresses live there. */
      partnerId: 'ref:partner.Partner',
      /** A subsidiary keeps its own books; consolidation reads across (D32). */
      parentId: 'ref:company.Company?',
      currency: 'text',
      active: 'bool',
    },
    indexes: {
      code: { fields: ['code'], unique: true },
      partner: { fields: ['partnerId'], unique: true },
    },
  },

  /**
   * Operational branches inside one legal entity.
   *
   * This is deliberately not Company.parentId: a subsidiary keeps its own books,
   * while a branch chooses where company+branch rows are written. `rootKey` is set
   * only on the root row. A nullable unique column is the database-level invariant
   * that lets every company have one root without limiting ordinary children.
   */
  Branch: {
    scope: 'shared',
    fields: {
      id: 'id',
      companyId: 'ref:company.Company',
      code: 'text',
      name: 'text',
      parentId: 'ref:company.Branch?',
      rootKey: 'text?',
      active: 'bool',
    },
    indexes: {
      company_code: { fields: ['companyId', 'code'], unique: true },
      root: { fields: ['rootKey'], unique: true },
    },
  },
}
