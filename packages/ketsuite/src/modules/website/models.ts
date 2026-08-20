import type { ModelDef } from 'ketjs'

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
      active: 'bool',
    },
    indexes: { active_name: { fields: ['companyId', 'active', 'name'] } },
  },
  SiteDomain: {
    scope: 'company',
    fields: {
      id: 'id',
      siteId: 'ref:website.Site',
      host: 'text',
      primary: 'bool',
      redirectToPrimary: 'bool',
    },
    indexes: {
      host_company: { fields: ['companyId', 'host'], unique: true },
      site_host: { fields: ['companyId', 'siteId', 'host'], unique: true },
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
    },
    indexes: { digest: { fields: ['companyId', 'digest'], unique: true } },
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
