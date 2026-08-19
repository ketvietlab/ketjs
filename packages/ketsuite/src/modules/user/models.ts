import type { ModelDef } from 'ketjs'

/**
 * Users, and the companies each may act as.
 *
 * A user *has* a party rather than *being* one. Odoo is alone in making the user a
 * delegated subclass of the partner (`_inherits`), which puts every user in the
 * address book and leaks the mechanism through archiving, deletion and sudo.
 * Salesforce keeps `User` a separate object and links a Contact only for external
 * users; SAP keeps SU01 separate from the business partner. The link is optional
 * here for the same reason: an operator account is not a person you invoice.
 *
 * The password column is the reason D33 had to land first. Every function that
 * returns a user declares its output, and none of them declares this.
 */
export const models: Record<string, ModelDef> = {
  User: {
    scope: 'shared',
    fields: {
      id: 'id',
      login: 'text',
      /** scrypt, parameters encoded in the value. Never in any declared output. */
      password: 'text',
      /** Optional: an internal operator needs no entry in the address book. */
      partnerId: 'ref:partner.Partner?',
      name: 'text',
      email: 'text?',
      lang: 'text?',
      /** The company a new row is stamped with when this user acts (D32). */
      defaultCompanyId: 'ref:company.Company?',
      active: 'bool',
    },
  },

  /**
   * Which companies a user may read — the set behind `scope.companies`.
   *
   * Rows rather than a list column, so granting one company is an insert and
   * revoking it is a delete, both traceable, neither a read-modify-write of a
   * field two requests can race on.
   */
  Membership: {
    scope: 'shared',
    fields: {
      id: 'id',
      userId: 'ref:user.User',
      companyId: 'ref:company.Company',
    },
  },
}
