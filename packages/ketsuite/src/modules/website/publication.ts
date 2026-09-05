import { createHash } from 'node:crypto'
import { defineFn, desc, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { canPublishEntry } from './access.ts'

/**
 * Publishing a set, rather than publishing one page at a time.
 *
 * `publishEntry` flips one entry's pointer the moment someone presses the
 * button on it, so a set of related changes reaches visitors piecemeal — a page
 * whose menu link is not there yet, or a link to a page that is not published.
 * A publication freezes which revision of which entry goes out, and activating
 * it moves all of them or none.
 *
 * Both paths stay: a site that publishes one page at a time is not doing
 * anything wrong, and this does not take that away.
 */

const MAX_PUBLICATION_ENTRIES = 1_000

const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })

/**
 * What a publication is, independent of when it was made.
 *
 * Two prepares over the same revisions hash the same, which is what lets a
 * caller notice it is about to publish nothing.
 */
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}

const hashOf = (
  entries: ReadonlyArray<{ entryId: string; revisionId: string }>,
  attachments: unknown = null,
): string =>
  createHash('sha256')
    .update(
      [...entries]
        .sort((a, b) => (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0))
        .map((e) => `${e.entryId}:${e.revisionId}`)
        .join('\n'),
    )
    // Attachments are part of what the caller proposed: the same pages with a
    // different menu is a different publication.
    .update(`\n--\n${canonical(attachments ?? null)}`)
    .digest('hex')

const publicationById = (ctx: Ctx, id: unknown): Promise<Row | null> => {
  const P = ctx.table('website.Publication')
  return ctx.db.one(from(P).where(eq(P.id, id)))
}

export const publicationFunctions: Record<string, FnSpec> = {
  /**
   * Freeze the current draft of each named entry into one set.
   *
   * Nothing is public yet. A prepared publication is a proposal: it names
   * exact revisions, so what a reviewer approves is what activates, even if
   * someone keeps editing afterwards.
   */
  preparePublication: defineFn({
    input: { id: 'id', siteId: 'id', entryIds: 'json', attachments: 'json?' },
    output: { ok: 'bool', id: 'id?', entryCount: 'int?', contentHash: 'text?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website.Entry',
      'read:website.SiteMember',
      'read:website.Publication',
      'write:website.Publication',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const ids = Array.isArray(args.entryIds) ? args.entryIds.map(String) : null
      if (!ids || ids.length === 0) return invalid('entryIds', 'website.error.publicationEmpty')
      if (ids.length > MAX_PUBLICATION_ENTRIES)
        return invalid('entryIds', 'website.error.publicationTooLarge')
      if (new Set(ids).size !== ids.length) return invalid('entryIds', 'website.error.publicationDuplicate')

      const Site = ctx.table('website.Site')
      const site = await ctx.db.one(from(Site).where(eq(Site.id, args.siteId)))
      if (!site) return invalid('siteId', 'website.error.siteNotFound')

      const Entry = ctx.table('website.Entry')
      const rows = await ctx.db.all(from(Entry).where(inArray(Entry.id, ids)))
      const found = new Map(rows.map((row) => [String(row.id), row]))

      const entries: Array<{ entryId: string; revisionId: string; path: string }> = []
      for (const entryId of ids) {
        const entry = found.get(entryId)
        // Every reason to refuse names the entry, because a caller publishing
        // twenty pages needs to know which one is the problem.
        if (!entry || entry.siteId !== args.siteId)
          return invalid(entryId, 'website.error.publicationEntryOutsideSite')
        if (entry.status === 'trash') return invalid(entryId, 'website.error.publicationEntryTrashed')
        if (!entry.currentRevisionId) return invalid(entryId, 'website.error.revisionNotFound')
        if (!(await canPublishEntry(ctx, entry))) return invalid(entryId, 'website.error.forbidden')
        entries.push({
          entryId,
          revisionId: String(entry.currentRevisionId),
          path: String(entry.path),
        })
      }

      const attachments =
        args.attachments && typeof args.attachments === 'object' && !Array.isArray(args.attachments)
          ? (args.attachments as Record<string, unknown>)
          : null

      const existing = await publicationById(ctx, args.id)
      if (existing) {
        // Same key, same set: hand back what was prepared. Same key, different
        // set: the caller is reusing an id for a different intent.
        if (existing.contentHash !== hashOf(entries, attachments))
          return invalid('id', 'website.error.publicationConflict')
        return {
          ok: true,
          id: existing.id,
          entryCount: Number(existing.entryCount),
          contentHash: String(existing.contentHash),
        }
      }

      const contentHash = hashOf(entries, attachments)
      await ctx.db.insert('website.Publication', {
        id: args.id,
        siteId: args.siteId,
        state: 'prepared',
        entries,
        entryCount: entries.length,
        contentHash,
        attachments,
        preparedBy: ctx.actor ?? null,
        preparedAt: new Date().toISOString(),
      })
      return { ok: true, id: args.id, entryCount: entries.length, contentHash }
    },
  }),

  /**
   * Make a prepared publication the one visitors read.
   *
   * The site's pointer is the concurrency token: two activations that both
   * started from the same base would otherwise each believe they replaced the
   * other, and the entry pointers would end up a mix of the two.
   */
  activatePublication: defineFn({
    input: { id: 'id', expectedPublicationId: 'id?' },
    output: { ok: 'bool', id: 'id?', supersededId: 'id?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website.Entry',
      'read:website.SiteMember',
      'read:website.Publication',
      'write:website.Site',
      'write:website.Entry',
      'write:website.Publication',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const publication = await publicationById(ctx, args.id)
      if (!publication) return invalid('id', 'website.error.publicationNotFound')
      // Replaying an activation is not an error; it already happened.
      if (publication.state === 'active') return { ok: true, id: publication.id }
      if (publication.state !== 'prepared') return invalid('id', 'website.error.publicationSuperseded')

      const Site = ctx.table('website.Site')
      const site = await ctx.db.one(from(Site).where(eq(Site.id, publication.siteId)))
      if (!site) return invalid('id', 'website.error.siteNotFound')

      const base = site.activePublicationId ?? null
      if (args.expectedPublicationId != null && String(args.expectedPublicationId) !== String(base ?? ''))
        return invalid('expectedPublicationId', 'website.error.publicationStaleBase')

      const entries = (publication.entries ?? []) as Array<{ entryId: string; revisionId: string }>
      const activatedAt = new Date().toISOString()

      const won = await ctx.tx(async (tx) => {
        // The pointer moves first and under compare-and-set. Losing here means
        // another activation got there, and nothing below has run yet.
        const moved = await tx.db.compareAndSet(
          'website.Site',
          { id: site.id },
          { activePublicationId: base },
          { activePublicationId: publication.id } as Row,
        )
        if (!('dryRun' in moved) && !moved.matched) return false

        for (const entry of entries) {
          await tx.db.update('website.Entry', { id: entry.entryId }, {
            status: 'published',
            publishedRevisionId: entry.revisionId,
            publishedAt: activatedAt,
          } as Row)
        }
        await tx.db.update('website.Publication', { id: publication.id }, {
          state: 'active',
          activatedAt,
          previousId: base,
        } as Row)
        if (base)
          await tx.db.update('website.Publication', { id: base }, {
            state: 'superseded',
            supersededAt: activatedAt,
          } as Row)
        return true
      })

      if (!won) return invalid('id', 'website.error.publicationStaleBase')
      return { ok: true, id: publication.id, supersededId: base ?? null }
    },
  }),

  /**
   * What is public right now, for a module that froze something alongside it.
   *
   * Anonymous because the navigation a visitor reads is decided by it, and a
   * visitor has no session. It carries the attachment bag and nothing else
   * about the entries: which pages are public is already answerable.
   */
  activePublication: defineFn({
    anonymous: true,
    input: { siteId: 'id' },
    output: { id: 'id', attachments: 'json?', activatedAt: 'datetime?' },
    effects: ['read:website.Site', 'read:website.Publication'],
    handler: async (ctx: Ctx, args) => {
      const Site = ctx.table('website.Site')
      const site = await ctx.db.one(from(Site).where(eq(Site.id, args.siteId), eq(Site.active, true)))
      if (!site?.activePublicationId) return null
      const publication = await publicationById(ctx, site.activePublicationId)
      if (publication?.state !== 'active') return null
      return {
        id: publication.id,
        attachments: publication.attachments ?? null,
        activatedAt: publication.activatedAt ?? null,
      }
    },
  }),

  listPublications: defineFn({
    input: { siteId: 'id', state: 'text?', limit: 'int?' },
    output: {
      id: 'id',
      siteId: 'id',
      state: 'text',
      entryCount: 'int',
      contentHash: 'text',
      preparedAt: 'datetime',
      activatedAt: 'datetime?',
    },
    effects: ['read:website.Publication', 'read:website.SiteMember'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const P = ctx.table('website.Publication')
      let query = from(P).where(eq(P.siteId, args.siteId)).orderBy(desc(P.preparedAt))
      if (args.state) query = query.where(eq(P.state, args.state))
      const limit = Number.isInteger(args.limit) ? Math.min(Math.max(Number(args.limit), 1), 100) : 50
      return ctx.db.all(query.limit(limit))
    },
  }),

  /**
   * Go back to what was public before, by publishing it again.
   *
   * Rollback is a publication rather than an undo: the history stays, and the
   * entries go through the same activation the forward direction does, so a
   * page that has since been trashed does not come back by the side door.
   */
  rollbackPublication: defineFn({
    input: { id: 'id', siteId: 'id' },
    output: { ok: 'bool', id: 'id?', restoredFromId: 'id?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website.Entry',
      'read:website.SiteMember',
      'read:website.Publication',
      'write:website.Publication',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const Site = ctx.table('website.Site')
      const site = await ctx.db.one(from(Site).where(eq(Site.id, args.siteId)))
      if (!site) return invalid('siteId', 'website.error.siteNotFound')
      const current = site.activePublicationId ? await publicationById(ctx, site.activePublicationId) : null
      if (!current?.previousId) return invalid('siteId', 'website.error.publicationNoBase')

      const target = await publicationById(ctx, current.previousId)
      if (!target || target.siteId !== args.siteId)
        return invalid('siteId', 'website.error.publicationNotFound')

      const entries = (target.entries ?? []) as Array<{ entryId: string; revisionId: string; path: string }>
      const Entry = ctx.table('website.Entry')
      const rows = await ctx.db.all(
        from(Entry).where(
          inArray(
            Entry.id,
            entries.map((e) => e.entryId),
          ),
        ),
      )
      const live = new Map(rows.map((row) => [String(row.id), row]))
      for (const entry of entries) {
        const row = live.get(entry.entryId)
        // A rollback restores a layout, not a permission decision that has since
        // been taken: a trashed page stays gone.
        if (!row || row.status === 'trash')
          return invalid(entry.entryId, 'website.error.publicationEntryTrashed')
      }

      const existing = await publicationById(ctx, args.id)
      if (existing) return { ok: true, id: existing.id, restoredFromId: String(target.id) }

      await ctx.db.insert('website.Publication', {
        id: args.id,
        siteId: args.siteId,
        state: 'prepared',
        entries,
        entryCount: entries.length,
        contentHash: hashOf(entries, target.attachments ?? null),
        attachments: target.attachments ?? null,
        preparedBy: ctx.actor ?? null,
        preparedAt: new Date().toISOString(),
      })
      return { ok: true, id: args.id, restoredFromId: String(target.id) }
    },
  }),
}
