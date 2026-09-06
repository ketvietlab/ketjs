import { defineFn, desc, eq, from, like, likeLiteral } from '@ketvietlab/ketjs'
import { indexEffects, isCurrent, rebuildPass, servedSite, stateFor } from './rebuild.ts'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'

/**
 * Building and reading the index.
 *
 * Two rules shape everything here. The index is derived, so it never decides
 * what is public — a document that should not be served is a bug in the
 * builder, not a new source of truth. And a stale index degrades the search
 * rather than answering wrongly: callers are told, and can fall back.
 */

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
      // Both sides are already lowercased, so a case-sensitive LIKE is the
      // cheaper operator and means the same thing.
      const matching = from(Document)
        .where(eq(Document.siteId, args.siteId))
        .where(like(Document.haystack, `%${likeLiteral(needle)}%`, true))
      const rows = await ctx.db.all(
        matching.orderBy(desc(Document.publishedAt)).limit(paging.limit).offset(paging.offset),
      )
      return {
        hits: rows.map((row) => ({
          id: row.entryId,
          type: row.type,
          path: row.path,
          title: row.title,
          excerpt: row.excerpt ?? null,
          publishedAt: row.publishedAt ?? null,
        })),
        total: await ctx.db.count(matching),
        // The visitor gets an answer either way; the caller gets to say so.
        stale: !isCurrent(state, site),
        indexed: true,
      }
    },
  }),
}
