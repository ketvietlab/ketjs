import { asc, deleteFrom, eq, from, gt, inArray, isNotNull, ne } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'

/**
 * Building the index, kept apart from reading it.
 *
 * A job cannot reach a declared function - a JobContext has no `call` - so the
 * passes have to be an ordinary import, the way `website_form` keeps its purge.
 * Separating them says the same thing the model does: the index is derived, and
 * building it is not the same act as answering with it.
 */

/** How many entries one rebuild pass reads. A pass is meant to fit in a request. */
export const BATCH = 200

export const indexEffects = [
  'read:website.Site',
  'read:website.Entry',
  'read:website.EntryRevision',
  'read:website_search.SearchDocument',
  'write:website_search.SearchDocument',
  'read:website_search.SearchIndexState',
  'write:website_search.SearchIndexState',
]

/** The site a visitor is actually being served, and the set it is serving. */
export const servedSite = async (ctx: Ctx, siteId: unknown): Promise<Row | null> => {
  const Site = ctx.table('website.Site')
  return ctx.db.one(from(Site).where(eq(Site.id, siteId), eq(Site.active, true)))
}

export const stateFor = async (ctx: Ctx, siteId: unknown): Promise<Row | null> => {
  const State = ctx.table('website_search.SearchIndexState')
  return ctx.db.one(from(State).where(eq(State.siteId, siteId)))
}

/**
 * An index is current when it was built for the publication now active — or,
 * for a site that publishes one page at a time, when it has completed at all
 * and nothing has been published since it finished.
 */
export const isCurrent = (state: Row | null, site: Row): boolean => {
  if (state?.state !== 'ready') return false
  return String(state.publicationId ?? '') === String(site.activePublicationId ?? '')
}

const documentOf = (entry: Row, revision: Row): Row => ({
  id: `${String(entry.siteId)}:${String(entry.id)}`,
  siteId: entry.siteId,
  entryId: entry.id,
  type: entry.type,
  path: entry.path,
  title: revision.title,
  excerpt: revision.excerpt ?? null,
  haystack: `${String(revision.title)}\n${String(revision.excerpt ?? '')}`.toLocaleLowerCase(),
  publishedAt: entry.publishedAt ?? null,
})

/**
 * One pass of a rebuild.
 *
 * Checkpointed on the entry path, which is stable and unique per site, so a
 * pass that stops halfway resumes where it left off rather than starting again.
 * Returns whether there is more to do.
 */
export const rebuildPass = async (ctx: Ctx, site: Row): Promise<{ done: boolean; written: number }> => {
  const siteId = site.id
  const existing = await stateFor(ctx, siteId)
  const target = String(site.activePublicationId ?? '')
  const fresh = existing?.state !== 'building' || String(existing.publicationId ?? '') !== target

  const cursor = fresh ? '' : String(existing?.cursor ?? '')
  const now = new Date().toISOString()

  if (fresh) {
    // A rebuild for a different publication starts clean: leftovers from the
    // previous one describe pages that may no longer be served.
    const Document = ctx.table('website_search.SearchDocument')
    await ctx.db.del(deleteFrom(Document).where(eq(Document.siteId, siteId)))
    const row = {
      id: String(siteId),
      siteId,
      publicationId: site.activePublicationId ?? null,
      state: 'building',
      cursor: '',
      documentCount: 0,
      startedAt: now,
      completedAt: null,
    }
    if (existing) await ctx.db.update('website_search.SearchIndexState', { id: String(siteId) }, row)
    else await ctx.db.insert('website_search.SearchIndexState', row)
  }

  // The same publication gate the reader and the sitemap apply, so the index
  // can never offer a page the reader would refuse.
  const Entry = ctx.table('website.Entry')
  let query = from(Entry)
    .where(eq(Entry.siteId, siteId), isNotNull(Entry.publishedRevisionId), ne(Entry.status, 'trash'))
    .orderBy(asc(Entry.path))
    .limit(BATCH + 1)
  if (cursor) query = query.where(gt(Entry.path, cursor))
  const scanned = await ctx.db.all(query)
  const batch = scanned.slice(0, BATCH)
  const more = scanned.length > BATCH

  if (batch.length) {
    const Revision = ctx.table('website.EntryRevision')
    const revisions = new Map<string, Row>()
    const ids = batch.map((entry) => entry.publishedRevisionId)
    for (const revision of await ctx.db.all(
      from(Revision)
        .select(Revision.id, Revision.entryId, Revision.title, Revision.excerpt)
        .where(inArray(Revision.id, ids)),
    ))
      revisions.set(String(revision.id), revision)

    for (const entry of batch) {
      const revision = revisions.get(String(entry.publishedRevisionId))
      if (!revision || revision.entryId !== entry.id) continue
      const document = documentOf(entry, revision)
      const inserted = await ctx.db.insertIfAbsent('website_search.SearchDocument', document)
      if (!('dryRun' in inserted) && !inserted.inserted)
        await ctx.db.update('website_search.SearchDocument', { id: document.id }, document)
    }
  }

  const state = await stateFor(ctx, siteId)
  const written = Number(state?.documentCount ?? 0) + batch.length
  await ctx.db.update('website_search.SearchIndexState', { id: String(siteId) }, {
    state: more ? 'building' : 'ready',
    cursor: more ? String(batch[batch.length - 1]?.path ?? '') : null,
    documentCount: written,
    completedAt: more ? null : new Date().toISOString(),
  } as Row)
  return { done: !more, written: batch.length }
}
