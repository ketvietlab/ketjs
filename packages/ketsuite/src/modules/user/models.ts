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
      /** The operational branch a company+branch row is stamped with. */
      defaultBranchId: 'ref:company.Branch?',
      /**
       * Exempt from the permission check entirely.
       *
       * Something has to be, or a deployment that turns roles on can never grant
       * the first one — the functions that manage roles are themselves behind the
       * check. Odoo solves it with a magic user id and a group; a declared column
       * is the same escape hatch with its name written on it, and it shows up in
       * a query rather than in institutional memory.
       */
      superuser: 'bool',
      active: 'bool',
    },
  },

  /**
   * A named set of functions.
   *
   * Not a set of models with CRUD flags, which is what Odoo's ir.model.access is
   * and what makes its permissions unanswerable: granting read on a table grants
   * it in the form, the list, the export, XML-RPC and every search() any module
   * makes. Here the unit is the action, so a role is exactly the list of actions,
   * and `ket permissions` can print what any list reaches because there is nothing
   * to traverse — a function cannot touch a model it did not declare.
   */
  Role: {
    scope: 'shared',
    fields: {
      id: 'id',
      name: 'text',
      description: 'text?',
    },
  },

  /** One row per granted function. Additive, like Salesforce permission sets. */
  Grant: {
    scope: 'shared',
    fields: {
      id: 'id',
      roleId: 'ref:user.Role',
      /** A function key, e.g. "partner.listPartners". */
      fnKey: 'text',
    },
  },

  /** One row per (user, role). A user's permissions are the union of their roles. */
  Assignment: {
    scope: 'shared',
    fields: {
      id: 'id',
      userId: 'ref:user.User',
      roleId: 'ref:user.Role',
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
    indexes: { user_company: { fields: ['userId', 'companyId'], unique: true } },
  },

  /** Branches are granted explicitly, except the root granted with a company. */
  BranchMembership: {
    scope: 'shared',
    fields: {
      id: 'id',
      userId: 'ref:user.User',
      branchId: 'ref:company.Branch',
    },
    indexes: { user_branch: { fields: ['userId', 'branchId'], unique: true } },
  },
}
