import type { ModelDef } from 'ketjs'

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
      /** Its own party record — name, tax number and addresses live there. */
      partnerId: 'ref:partner.Partner',
      /** A subsidiary keeps its own books; consolidation reads across (D32). */
      parentId: 'ref:company.Company?',
      currency: 'text',
      active: 'bool',
    },
  },
}
