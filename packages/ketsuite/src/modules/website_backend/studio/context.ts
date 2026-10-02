import { defineFn, eq, from } from '@ketvietlab/ketjs'
import type { FnSpec, Row } from '@ketvietlab/ketjs'

const object = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {}
export const entryProjection = (entry: Row, revision: Row | undefined, locale = 'vi') => {
  const fields = object(revision?.fields)
  return {
    ...entry,
    ...fields,
    type: String(entry.type).replace(/^website\./, ''),
    revisionId: entry.currentRevisionId,
    layout: revision?.layout ?? [],
    fields,
    locale: fields.locale ?? locale,
    trashed: entry.status === 'trash',
    revision: revision?.version ?? 0,
    state:
      entry.status === 'trash'
        ? 'trash'
        : entry.publishAt && entry.scheduledRevisionId
          ? 'scheduled'
          : entry.publishedRevisionId
            ? entry.currentRevisionId === entry.publishedRevisionId
              ? 'published'
              : 'changed'
            : 'draft',
    updatedBy: revision?.authorId ?? entry.authorId ?? '',
  }
}

/** Content-only projection. Submission payloads and secrets never enter this reader. */
export const studioContext: FnSpec = defineFn({
  input: { siteId: 'id?' },
  output: {
    sites: 'json',
    site: 'json?',
    entries: 'json',
    revisions: 'json',
    publications: 'json',
    domains: 'json',
    sections: 'json',
  },
  effects: [
    'read:website.Site',
    'read:website.Entry',
    'read:website.EntryRevision',
    'read:website.Publication',
    'read:website.SiteDomain',
  ],
  handler: async (ctx, input) =>
    ctx.tx(async (tx) => {
      const sites = tx.scope.company
        ? await tx.db.select('website.Site', { companyId: tx.scope.company })
        : []
      const site = input.siteId == null ? sites[0] : sites.find((row) => row.id === input.siteId)
      if (!site)
        return {
          sites: input.siteId == null ? sites : [],
          site: null,
          entries: [],
          revisions: [],
          publications: [],
          domains: [],
          sections: {},
        }
      const domains = await tx.db.select('website.SiteDomain', { siteId: site.id })
      const entries = await tx.db.select('website.Entry', { siteId: site.id })
      const Revision = tx.table('website.EntryRevision')
      const revisions: Row[] = []
      for (const entry of entries)
        revisions.push(...(await tx.db.all(from(Revision).where(eq(Revision.entryId, entry.id)))))
      const byId = new Map(revisions.map((row) => [row.id, row]))
      return {
        sites,
        site,
        domains,
        entries: entries.map((row) =>
          entryProjection(row, byId.get(row.currentRevisionId), String(site.defaultLocale)),
        ),
        revisions,
        publications: await tx.db.select('website.Publication', { siteId: site.id }),
        sections: tx.manifest.sections,
      }
    }),
})
