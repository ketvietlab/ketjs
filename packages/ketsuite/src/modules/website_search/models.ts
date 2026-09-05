import type { ModelDef } from '@ketvietlab/ketjs'

/**
 * An index, so a search is a lookup rather than a scan.
 *
 * `website.searchPublished` reads every published entry of a site, fetches each
 * revision and matches in JavaScript. That is correct and it does not scale: the
 * cost of one keystroke grows with the site, and the window that bounds it is
 * also a ceiling on what can be found.
 *
 * The index is derived data. It is never the answer to "what is public" — the
 * publication is — so a stale index degrades a search rather than publishing
 * something it should not.
 */
export const models: Record<string, ModelDef> = {
  SearchDocument: {
    scope: 'company',
    fields: {
      id: 'id',
      siteId: 'ref:website.Site',
      entryId: 'ref:website.Entry',
      type: 'text',
      path: 'text',
      title: 'text',
      excerpt: 'text?',
      /** Lowercased title and excerpt, so a match is one comparison. */
      haystack: 'text',
      publishedAt: 'datetime?',
    },
    indexes: {
      site_entry: { fields: ['companyId', 'siteId', 'entryId'], unique: true },
      site_published: { fields: ['companyId', 'siteId', 'publishedAt'] },
    },
  },

  /**
   * What the index was built from, and how far a rebuild has got.
   *
   * `publicationId` is the whole staleness test: an index built for a
   * publication that is no longer active describes pages that may no longer be
   * the ones being served. `cursor` lets a rebuild stop and resume rather than
   * having to finish inside one request.
   */
  SearchIndexState: {
    scope: 'company',
    timestamps: true,
    fields: {
      id: 'id',
      siteId: 'ref:website.Site',
      /** Null while a site has never published a set; the index then follows entries. */
      publicationId: 'text?',
      state: 'text',
      cursor: 'text?',
      documentCount: 'int',
      startedAt: 'datetime',
      completedAt: 'datetime?',
    },
    indexes: { site: { fields: ['companyId', 'siteId'], unique: true } },
  },
}
