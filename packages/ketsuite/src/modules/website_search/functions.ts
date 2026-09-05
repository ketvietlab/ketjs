import { asc, defineFn, deleteFrom, desc, eq, from, gt, inArray, isNotNull, ne } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'

/**
 * Building and reading the index.
 *
 * Two rules shape everything here. The index is derived, so it never decides
 * what is public — a document that should not be served is a bug in the
 * builder, not a new source of truth. And a stale index degrades the search
 * rather than answering wrongly: callers are told, and can fall back.
 */

/** How many entries one rebuild pass reads. A pass is meant to fit in a request. */
const BATCH = 200

/** How many passes `searchIndexed` will run itself before answering degraded. */
const INLINE_PASSES = 3

const MAX_TERM = 100
const MIN_TERM = 2

const page = (limit: unknown, offset: unknown) => ({
  limit: Math.min(Math.max(Number.isInteger(limit) ? Number(limit) : 20, 1), 100),
  offset: Math.min(Math.max(Number.isInteger(offset) ? Number(offset) : 0, 0), 100_000),
})

const term = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLocaleLowerCase()
    .slice(0, MAX_TERM)

/** The site a visitor is actually being served, and the set it is serving. */
const servedSite = async (ctx: Ctx, siteId: unknown): Promise<Row | null> => {
  const Site = ctx.table('website.Site')
  return ctx.db.one(from(Site).where(eq(Site.id, siteId), eq(Site.active, true)))
}

const stateFor = async (ctx: Ctx, siteId: unknown): Promise<Row | null> => {
  const State = ctx.table('website_search.SearchIndexState')
  return ctx.db.one(from(State).where(eq(State.siteId, siteId)))
}

/**
 * An index is current when it was built for the publication now active — or,
 * for a site that publishes one page at a time, when it has completed at all
 * and nothing has been published since it finished.
 */
const isCurrent = (state: Row | null, site: Row): boolean => {
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

const indexEffects = [
  'read:website.Site',
  'read:website.Entry',
  'read:website.EntryRevision',
  'read:website_search.SearchDocument',
  'write:website_search.SearchDocument',
  'read:website_search.SearchIndexState',
  'write:website_search.SearchIndexState',
]

/**
 * One pass of a rebuild.
 *
 * Checkpointed on the entry path, which is stable and unique per site, so a
 * pass that stops halfway resumes where it left off rather than starting again.
 * Returns whether there is more to do.
 */
const rebuildPass = async (ctx: Ctx, site: Row): Promise<{ done: boolean; written: number }> => {
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

export const functions: Record<string, FnSpec> = {
  /**
   * Rebuild the index for a site, one pass at a time.
   *
   * Exposed so an operator or a job can drive a long rebuild without holding a
   * request open, and so a test can step through it.
   */
  reindexSite: defineFn({
    input: { siteId: 'id', passes: 'int?' },
    output: { done: 'bool', written: 'int', documentCount: 'int' },
    effects: indexEffects,
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const site = await servedSite(ctx, args.siteId)
      if (!site) return { done: true, written: 0, documentCount: 0 }
      const passes = Math.min(Math.max(Number.isInteger(args.passes) ? Number(args.passes) : 1, 1), 50)
      let written = 0
      let done = false
      for (let i = 0; i < passes && !done; i += 1) {
        const pass = await rebuildPass(ctx, site)
        written += pass.written
        done = pass.done
      }
      const state = await stateFor(ctx, args.siteId)
      return { done, written, documentCount: Number(state?.documentCount ?? 0) }
    },
  }),

  indexStatus: defineFn({
    input: { siteId: 'id' },
    output: {
      state: 'text',
      current: 'bool',
      documentCount: 'int',
      publicationId: 'text?',
      completedAt: 'datetime?',
    },
    effects: ['read:website.Site', 'read:website_search.SearchIndexState'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const site = await servedSite(ctx, args.siteId)
      if (!site) return { state: 'absent', current: false, documentCount: 0 }
      const state = await stateFor(ctx, args.siteId)
      return {
        state: String(state?.state ?? 'absent'),
        current: isCurrent(state, site),
        documentCount: Number(state?.documentCount ?? 0),
        publicationId: state?.publicationId ?? null,
        completedAt: state?.completedAt ?? null,
      }
    },
  }),

  /**
   * Search the index.
   *
   * When the index is behind what is being served, this builds a few passes
   * itself and then answers with whatever it has, saying so. It never blocks a
   * visitor on a full rebuild, and it never answers from an index built for a
   * publication that is no longer active without admitting it.
   */
  searchIndexed: defineFn({
    anonymous: true,
    input: { siteId: 'id', q: 'text', limit: 'int?', offset: 'int?' },
    output: { hits: 'json', total: 'int', stale: 'bool', indexed: 'bool' },
    effects: indexEffects,
    handler: async (ctx: Ctx, args) => {
      const needle = term(args.q)
      const site = await servedSite(ctx, args.siteId)
      if (!site || needle.length < MIN_TERM) return { hits: [], total: 0, stale: false, indexed: false }

      let state = await stateFor(ctx, args.siteId)
      if (!isCurrent(state, site)) {
        for (let i = 0; i < INLINE_PASSES; i += 1) {
          const pass = await rebuildPass(ctx, site)
          if (pass.done) break
        }
        state = await stateFor(ctx, args.siteId)
      }

      const Document = ctx.table('website_search.SearchDocument')
      const paging = page(args.limit, args.offset)
      const rows = await ctx.db.all(
        from(Document).where(eq(Document.siteId, args.siteId)).orderBy(desc(Document.publishedAt)),
      )
      const matches = rows.filter((row) => String(row.haystack).includes(needle))
      return {
        hits: matches.slice(paging.offset, paging.offset + paging.limit).map((row) => ({
          id: row.entryId,
          type: row.type,
          path: row.path,
          title: row.title,
          excerpt: row.excerpt ?? null,
          publishedAt: row.publishedAt ?? null,
        })),
        total: matches.length,
        // The visitor gets an answer either way; the caller gets to say so.
        stale: !isCurrent(state, site),
        indexed: true,
      }
    },
  }),
}
