import type { ModelDef } from '@ketvietlab/ketjs'

/**
 * Users, and the companies each may act as.
 *
 * A user *has* a party rather than *being* one. the domain contract is alone in making the user a
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
      passwordHash: 'text?',
      /** Optional: an internal operator needs no entry in the address book. */
      partnerId: 'ref:partner.Partner?',
      name: 'text',
      email: 'text?',
      lang: 'text?',
      /** IANA timezone used for datetime filters and grouped list buckets. */
      timezone: 'text?',
      /** The company a new row is stamped with when this user acts (D32). */
      defaultCompanyId: 'ref:company.Company?',
      /** The operational branch a company+branch row is stamped with. */
      defaultBranchId: 'ref:company.Branch?',
      /** Backend and website identities share a table, never a cookie realm. */
      accessKind: 'text',
      /** Incrementing this invalidates every session and outstanding token. */
      securityVersion: 'int',
      lastLoginAt: 'datetime?',
      /**
       * Exempt from the permission check entirely.
       *
       * Something has to be, or a deployment that turns roles on can never grant
       * the first one — the functions that manage roles are themselves behind the
       * check. the domain contract solves it with a magic user id and a group; a declared column
       * is the same escape hatch with its name written on it, and it shows up in
       * a query rather than in institutional memory.
       */
      superuser: 'bool',
      /** Break-glass governance; null expiry remains bootstrap compatibility only. */
      superuserOwner: 'text?',
      superuserReason: 'text?',
      superuserExpiresAt: 'datetime?',
      active: 'bool',
    },
    indexes: { login: { fields: ['login'], unique: true } },
  },

  /**
   * A named set of functions.
   *
   * Not a set of models with CRUD flags, which is what the domain contract's model-level CRUD grants is
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
      /** Nullable only for rows created before the managed-role migration. */
      mode: 'text?',
      templateKey: 'text?',
      templateVersion: 'int?',
      templateDigest: 'text?',
      /** CAS boundary for role and template mutations. */
      revision: 'int?',
    },
    indexes: { name: { fields: ['name'], unique: true } },
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
    indexes: { role_function: { fields: ['roleId', 'fnKey'], unique: true } },
  },

  /** Provenance edges whose union is materialized in Grant for request-time enforcement. */
  GrantSource: {
    scope: 'shared',
    fields: {
      id: 'id',
      roleId: 'ref:user.Role',
      fnKey: 'text',
      sourceKind: 'text',
      sourceKey: 'text',
      sourceVersion: 'int?',
    },
    indexes: {
      role_function_source: {
        fields: ['roleId', 'fnKey', 'sourceKind', 'sourceKey'],
        unique: true,
      },
    },
  },

  /** One row per (user, role). A user's permissions are the union of their roles. */
  Assignment: {
    scope: 'shared',
    fields: {
      id: 'id',
      userId: 'ref:user.User',
      roleId: 'ref:user.Role',
      scopeKind: 'text?',
      companyId: 'ref:company.Company?',
      branchId: 'ref:company.Branch?',
      /** Non-null for all new rows; legacy null is interpreted as tenant during compatibility. */
      scopeKey: 'text?',
    },
    indexes: { user_role_scope: { fields: ['userId', 'roleId', 'scopeKey'], unique: true } },
  },

  /** Monotonic tenant authorization revision used for CAS and future cache invalidation. */
  AuthorizationRevision: {
    scope: 'shared',
    fields: { id: 'id', revision: 'int', updatedAt: 'datetime' },
  },

  /** Durable idempotency record for authorization mutations. */
  AuthorizationOperation: {
    scope: 'shared',
    fields: {
      id: 'id',
      digest: 'text',
      result: 'json?',
      completedAt: 'datetime?',
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

  /** Invitation/reset secrets are never stored; only this SHA-256 digest is. */
  AuthToken: {
    scope: 'shared',
    fields: {
      id: 'id',
      userId: 'ref:user.User',
      kind: 'text',
      realm: 'text',
      digest: 'text',
      securityVersion: 'int',
      expiresAt: 'datetime',
      consumedAt: 'datetime?',
      createdAt: 'datetime',
    },
    indexes: {
      digest: { fields: ['digest'], unique: true },
      user_kind: { fields: ['userId', 'kind'], unique: true },
    },
  },

  /** PostgreSQL-backed counters keep cooldowns consistent across every pod. */
  AuthThrottle: {
    scope: 'shared',
    fields: {
      id: 'id',
      failures: 'int',
      blockedUntil: 'datetime?',
      updatedAt: 'datetime',
    },
  },

  /** Security events are append-only domain rows, never free-form server logs. */
  SecurityAudit: {
    scope: 'shared',
    fields: {
      id: 'id',
      userId: 'ref:user.User?',
      event: 'text',
      occurredAt: 'datetime',
      networkFingerprint: 'text?',
      metadata: 'json?',
      /** Local user id or an explicit system principal; never a raw IdP subject. */
      actorKey: 'text?',
      targetKind: 'text?',
      targetId: 'text?',
      scopeKey: 'text?',
      source: 'text?',
      reason: 'text?',
      beforeDigest: 'text?',
      afterDigest: 'text?',
      authorizationRevision: 'int?',
      outcome: 'text?',
    },
  },

  /** A row lock serializes identity invariants that span more than one User row. */
  SecurityGuard: {
    scope: 'shared',
    fields: {
      id: 'id',
      updatedAt: 'datetime',
    },
  },
}
