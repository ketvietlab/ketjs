import type { ModelDef } from '@ketvietlab/ketjs'

/**
 * A page's body is not markup and not code: `layout` holds an ordered list of
 * section placements. That is what lets an agent edit a page by writing validated
 * data, and a theme render it without either side writing the other's half.
 */
export const models: Record<string, ModelDef> = {
  Site: {
    scope: 'company',
    timestamps: true,
    fields: {
      id: 'id',
      name: 'text',
      title: 'text',
      defaultLocale: 'text',
      theme: 'text',
      tokens: 'json?',
      siteGroup: 'text?',
      /**
       * Which publication a visitor is currently reading.
       *
       * Optional because a site that has only ever used publishEntry has none,
       * and must keep working: the per-entry pointer stays the fallback.
       */
      activePublicationId: 'ref:website.Publication?',
      active: 'bool',
    },
    indexes: { active_name: { fields: ['companyId', 'active', 'name'] } },
  },

  /**
   * One publish, one record.
   *
   * Publishing was per entry: a page went live the moment someone pressed the
   * button on it, so a set of related changes reached visitors piecemeal — a
   * page whose menu link did not exist yet, or a link to a page that was not
   * published. A publication freezes which revision of which entry goes out,
   * and activating it moves all of them or none.
   *
   * The frozen set lives in `entries` rather than in rows of its own: it is an
   * immutable snapshot read as a whole, and never queried by its parts.
   */
  Publication: {
    scope: 'company',
    timestamps: true,
    fields: {
      id: 'id',
      siteId: 'ref:website.Site',
      /** prepared → active → superseded. A superseded publication is history. */
      state: 'text',
      entries: 'json',
      entryCount: 'int',
      contentHash: 'text',
      /**
       * What other modules froze alongside the entries, keyed by module name.
       *
       * `website` does not read it. A publication has to be able to carry the
       * navigation and the metadata that go with a set of pages — otherwise a
       * menu change reaches visitors on its own schedule and a link appears
       * before the page it points at. But `website_menu` depends on `website`,
       * not the other way round, so the slot is opaque here and the module that
       * owns a key is the only thing that reads it.
       */
      attachments: 'json?',
      preparedBy: 'text?',
      preparedAt: 'datetime',
      activatedAt: 'datetime?',
      supersededAt: 'datetime?',
      /** Which publication this one replaced, so a rollback can name its base. */
      previousId: 'ref:website.Publication?',
    },
    indexes: {
      site_state: { fields: ['companyId', 'siteId', 'state'] },
      site_prepared: { fields: ['companyId', 'siteId', 'preparedAt'] },
    },
  },
  SiteDomain: {
    scope: 'company',
    fields: {
      id: 'id',
      siteId: 'ref:website.Site',
      host: 'text',
      primary: 'bool',
      primaryKey: 'text?',
      redirectToPrimary: 'bool',
    },
    indexes: {
      host_company: { fields: ['companyId', 'host'], unique: true },
      site_host: { fields: ['companyId', 'siteId', 'host'], unique: true },
      one_primary: { fields: ['companyId', 'primaryKey'], unique: true },
    },
  },
  SiteMember: {
    scope: 'company',
    fields: { id: 'id', siteId: 'ref:website.Site', userId: 'text', role: 'text' },
    indexes: { site_user: { fields: ['companyId', 'siteId', 'userId'], unique: true } },
  },
  Entry: {
    scope: 'company',
    timestamps: true,
    fields: {
      id: 'id',
      siteId: 'ref:website.Site',
      type: 'text',
      slug: 'text',
      path: 'text',
      title: 'text',
      excerpt: 'text?',
      status: 'text',
      currentRevisionId: 'ref:website.EntryRevision?',
      publishedRevisionId: 'ref:website.EntryRevision?',
      scheduledRevisionId: 'ref:website.EntryRevision?',
      authorId: 'text?',
      publishAt: 'datetime?',
      publishedAt: 'datetime?',
    },
    indexes: {
      site_path: { fields: ['companyId', 'siteId', 'path'], unique: true },
      site_type_slug: { fields: ['companyId', 'siteId', 'type', 'slug'], unique: true },
      site_status: { fields: ['companyId', 'siteId', 'status', 'updatedAt'] },
    },
  },
  EntryRevision: {
    scope: 'company',
    fields: {
      id: 'id',
      entryId: 'ref:website.Entry',
      version: 'int',
      kind: 'text',
      title: 'text',
      excerpt: 'text?',
      layout: 'json',
      fields: 'json',
      authorId: 'text?',
      createdAt: 'datetime',
    },
    indexes: {
      entry_version: { fields: ['companyId', 'entryId', 'version'], unique: true },
      entry_created: { fields: ['companyId', 'entryId', 'createdAt'] },
    },
  },
  TaxonomyTerm: {
    scope: 'company',
    fields: {
      id: 'id',
      siteId: 'ref:website.Site',
      taxonomy: 'text',
      slug: 'text',
      name: 'text',
      description: 'text?',
      parentId: 'ref:website.TaxonomyTerm?',
    },
    indexes: {
      site_taxonomy_slug: { fields: ['companyId', 'siteId', 'taxonomy', 'slug'], unique: true },
    },
  },
  EntryTerm: {
    scope: 'company',
    fields: { id: 'id', entryId: 'ref:website.Entry', termId: 'ref:website.TaxonomyTerm' },
    indexes: { entry_term: { fields: ['companyId', 'entryId', 'termId'], unique: true } },
  },
  MediaMetadata: {
    scope: 'company',
    fields: {
      id: 'id',
      siteId: 'ref:website.Site',
      attachmentId: 'text',
      alt: 'text?',
      caption: 'text?',
      width: 'int?',
      height: 'int?',
    },
    indexes: { attachment_site: { fields: ['companyId', 'siteId', 'attachmentId'], unique: true } },
  },
  Redirect: {
    scope: 'company',
    fields: {
      id: 'id',
      siteId: 'ref:website.Site',
      fromPath: 'text',
      toPath: 'text',
      permanent: 'bool',
      active: 'bool',
    },
    indexes: { site_from: { fields: ['companyId', 'siteId', 'fromPath'], unique: true } },
  },
  PreviewToken: {
    scope: 'company',
    fields: {
      id: 'id',
      entryId: 'ref:website.Entry',
      revisionId: 'ref:website.EntryRevision',
      digest: 'text',
      expiresAt: 'datetime',
      createdBy: 'text?',
      oneTime: 'bool',
      usedAt: 'datetime?',
      revokedAt: 'datetime?',
    },
    indexes: { digest: { fields: ['companyId', 'digest'], unique: true } },
  },
  /**
   * Customer identity is deliberately separate from user.User. A realm is the
   * customer account boundary for one or more sites (usually one brand), while
   * the linked Partner remains the business identity used by orders/bookings.
   *
   * Realm/account rows are shared because a brand site may sell properties
   * belonging to several legal companies. The site link itself is company-scoped,
   * so two companies may safely use the same local site id.
   */
  CustomerRealm: {
    scope: 'shared',
    timestamps: true,
    fields: {
      id: 'id',
      key: 'text',
      name: 'text',
      active: 'bool',
      sessionIdleSeconds: 'int',
      sessionAbsoluteSeconds: 'int',
    },
    indexes: { key: { fields: ['key'], unique: true } },
  },
  CustomerRealmSite: {
    scope: 'company',
    fields: {
      id: 'id',
      realmId: 'ref:website.CustomerRealm',
      siteId: 'ref:website.Site',
      primary: 'bool',
      active: 'bool',
    },
    indexes: {
      site: { fields: ['companyId', 'siteId'], unique: true },
      realm_site: { fields: ['companyId', 'realmId', 'siteId'], unique: true },
    },
  },
  CustomerAccount: {
    scope: 'shared',
    timestamps: true,
    fields: {
      id: 'id',
      realmId: 'ref:website.CustomerRealm',
      partnerId: 'ref:partner.Partner',
      email: 'text',
      emailNormalized: 'text',
      displayName: 'text',
      status: 'text',
      emailVerifiedAt: 'datetime?',
      securityVersion: 'int',
      failedLoginCount: 'int',
      lockedUntil: 'datetime?',
      lastLoginAt: 'datetime?',
    },
    indexes: {
      realm_email: { fields: ['realmId', 'emailNormalized'], unique: true },
      partner: { fields: ['partnerId'], unique: true },
    },
  },
  CustomerCredential: {
    scope: 'shared',
    fields: {
      id: 'id',
      accountId: 'ref:website.CustomerAccount',
      passwordHash: 'text',
      changedAt: 'datetime',
    },
    indexes: { account: { fields: ['accountId'], unique: true } },
  },
  CustomerSession: {
    scope: 'shared',
    fields: {
      id: 'id',
      realmId: 'ref:website.CustomerRealm',
      accountId: 'ref:website.CustomerAccount',
      tokenDigest: 'text',
      securityVersion: 'int',
      createdAt: 'datetime',
      lastSeenAt: 'datetime',
      idleExpiresAt: 'datetime',
      absoluteExpiresAt: 'datetime',
      revokedAt: 'datetime?',
      revokeReason: 'text?',
      networkFingerprint: 'text?',
    },
    indexes: {
      token: { fields: ['tokenDigest'], unique: true },
      account_expiry: { fields: ['accountId', 'absoluteExpiresAt'] },
    },
  },
  /** Rotating bearer credentials for headless and native customer clients. */
  CustomerTokenGrant: {
    scope: 'shared',
    fields: {
      id: 'id',
      realmId: 'ref:website.CustomerRealm',
      accountId: 'ref:website.CustomerAccount',
      accessDigest: 'text',
      refreshDigest: 'text',
      /**
       * The entropy a rotation cannot be predicted without.
       *
       * Rotation has to be replayable — a client whose response was lost must be
       * able to retry and get the same pair back — which is why it is derived
       * rather than random. Derived from the old token alone it was also
       * derivable by whoever held that token, so one leak exposed the whole
       * future chain. This is the part they do not have.
       */
      rotationSecret: 'text',
      /** The digest this grant last rotated away from, so replaying it is visible. */
      previousRefreshDigest: 'text?',
      securityVersion: 'int',
      version: 'int',
      createdAt: 'datetime',
      accessExpiresAt: 'datetime',
      refreshExpiresAt: 'datetime',
      lastRotatedAt: 'datetime',
      revokedAt: 'datetime?',
      revokeReason: 'text?',
    },
    indexes: {
      access: { fields: ['accessDigest'], unique: true },
      refresh: { fields: ['refreshDigest'], unique: true },
      previous_refresh: { fields: ['previousRefreshDigest'] },
      account_expiry: { fields: ['accountId', 'refreshExpiresAt'] },
    },
  },
  CustomerAuthRateLimit: {
    scope: 'shared',
    fields: {
      id: 'id',
      realmId: 'ref:website.CustomerRealm',
      action: 'text',
      key: 'text',
      windowStartedAt: 'datetime',
      count: 'int',
    },
    indexes: { realm_action_key: { fields: ['realmId', 'action', 'key'], unique: true } },
  },
  Page: {
    // Website content belongs to a legal entity, not to a branch: two branches of
    // one company share a site.
    scope: 'company',
    fields: {
      id: 'id',
      path: 'text',
      title: 'text',
      layout: 'json',
      published: 'bool',
      updatedAt: 'datetime',
    },
  },
}
