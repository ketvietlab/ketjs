import { asc, deleteFrom, desc, eq, from, gt, inArray, isNotNull, ne } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { isReservedPath, reservedPrefixes } from '../website/paths.ts'

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

/** The entries a visitor can open: the gate the reader, the sitemap and the index share. */
const servedEntries = (ctx: Ctx, siteId: unknown) => {
  const Entry = ctx.table('website.Entry')
  return {
    Entry,
    query: from(Entry).where(
      eq(Entry.siteId, siteId),
      isNotNull(Entry.publishedRevisionId),
      ne(Entry.status, 'trash'),
    ),
  }
}

/**
 * What is public on a site, in two cheap reads: how many entries are served and
 * when one of them last changed. Publishing, unpublishing, trashing and moving an
 * entry each change one or the other. A draft saved over a published entry does
 * too, which costs a rebuild and says nothing wrong.
 */
export const publicSignature = async (ctx: Ctx, siteId: unknown): Promise<string> => {
  const { Entry, query } = servedEntries(ctx, siteId)
  const latest = await ctx.db.one(query.select(Entry.updatedAt).orderBy(desc(Entry.updatedAt)).limit(1))
  return `${await ctx.db.count(query)}:${String(latest?.updatedAt ?? '')}`
}

/**
 * An index is current when it finished for the publication now active and
 * nothing public has changed since its build began.
 */
export const isCurrent = async (ctx: Ctx, state: Row | null, site: Row): Promise<boolean> => {
  if (state?.state !== 'ready') return false
  if (String(state.publicationId ?? '') !== String(site.activePublicationId ?? '')) return false
  return String(state.signature ?? '') === (await publicSignature(ctx, site.id))
}

/** Enough body text to find a page by, without one long article outweighing the index. */
const MAX_TEXT = 20_000

/** The words a layout shows: what a visitor reads on a page built from sections. */
const layoutText = (nodes: unknown, skipRichText: boolean, parts: string[]): void => {
  if (!Array.isArray(nodes)) return
  for (const node of nodes as Row[]) {
    if (!node || typeof node !== 'object') continue
    const settings = (node.settings ?? {}) as Row
    if (!(skipRichText && node.type === 'website.rich_text'))
      for (const key of ['heading', 'subheading', 'body', 'caption'])
        if (typeof settings[key] === 'string' && settings[key]) parts.push(settings[key] as string)
    for (const children of Object.values((node.slots ?? {}) as Row)) layoutText(children, skipRichText, parts)
  }
}

const parsed = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const documentOf = (entry: Row, revision: Row): Row => {
  const fields = (parsed(revision.fields) ?? {}) as Row
  const bodyText = typeof fields.bodyText === 'string' ? fields.bodyText : ''
  // An article's LiveDoc already is its rich text; the layout repeats it.
  const parts = bodyText ? [bodyText] : []
  layoutText(parsed(revision.layout), Boolean(bodyText), parts)
  const text = parts.join('\n').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
  const excerpt =
    String(revision.excerpt ?? '').trim() ||
    String(fields.excerpt ?? '').trim() ||
    // Whole words, so a result does not end halfway through one.
    (text.length > 180 ? `${text.slice(0, 180).replace(/\s+\S*$/, '')}…` : text)
  return {
    id: `${String(entry.siteId)}:${String(entry.id)}`,
    siteId: entry.siteId,
    entryId: entry.id,
    type: entry.type,
    path: entry.path,
    title: revision.title,
    excerpt: excerpt || null,
    haystack: `${String(revision.title)}\n${String(revision.excerpt ?? '')}\n${text}`.toLocaleLowerCase(),
    publishedAt: entry.publishedAt ?? null,
  }
}

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
      // Taken before the first read, so a change during the build leaves the index behind.
      signature: await publicSignature(ctx, siteId),
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
  const served = servedEntries(ctx, siteId)
  const Entry = served.Entry
  let query = served.query.orderBy(asc(Entry.path)).limit(BATCH + 1)
  if (cursor) query = query.where(gt(Entry.path, cursor))
  const scanned = await ctx.db.all(query)
  const batch = scanned.slice(0, BATCH)
  const more = scanned.length > BATCH

  // A page under a path a module route answers is never served, so it is not offered either.
  const prefixes = reservedPrefixes(Object.keys(ctx.manifest.routes ?? {}))
  const indexable = batch.filter((entry) => !isReservedPath(String(entry.path), prefixes))
  let indexed = 0
  if (indexable.length) {
    const Revision = ctx.table('website.EntryRevision')
    const revisions = new Map<string, Row>()
    // The body and the layout may each run to half a megabyte, so they are read a few at a time.
    for (let i = 0; i < indexable.length; i += 25) {
      const ids = indexable.slice(i, i + 25).map((entry) => entry.publishedRevisionId)
      for (const revision of await ctx.db.all(
        from(Revision)
          .select(
            Revision.id,
            Revision.entryId,
            Revision.title,
            Revision.excerpt,
            Revision.fields,
            Revision.layout,
          )
          .where(inArray(Revision.id, ids)),
      ))
        revisions.set(String(revision.id), revision)
    }

    for (const entry of indexable) {
      const revision = revisions.get(String(entry.publishedRevisionId))
      if (!revision || revision.entryId !== entry.id) continue
      indexed += 1
      const document = documentOf(entry, revision)
      const inserted = await ctx.db.insertIfAbsent('website_search.SearchDocument', document)
      if (!('dryRun' in inserted) && !inserted.inserted)
        await ctx.db.update('website_search.SearchDocument', { id: document.id }, document)
    }
  }

  const state = await stateFor(ctx, siteId)
  const written = Number(state?.documentCount ?? 0) + indexed
  await ctx.db.update('website_search.SearchIndexState', { id: String(siteId) }, {
    state: more ? 'building' : 'ready',
    cursor: more ? String(batch[batch.length - 1]?.path ?? '') : null,
    documentCount: written,
    completedAt: more ? null : new Date().toISOString(),
  } as Row)
  return { done: !more, written: indexed }
}
