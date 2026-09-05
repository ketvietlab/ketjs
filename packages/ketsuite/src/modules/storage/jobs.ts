import { asc, defineJob, deleteFrom, eq, from, gt, inArray, isNull } from '@ketvietlab/ketjs'
import type { JobContext, JobSpec } from '@ketvietlab/ketjs'
import { inlineTypes, publicationKey } from './policy.ts'

export const jobs: Record<string, JobSpec> = {
  publish: defineJob({
    queue: 'maintenance',
    input: { id: 'id' },
    effects: [
      'read:storage.Attachment',
      'write:storage.Attachment',
      'storage:read',
      'storage:write',
      'storage:remove',
    ],
    idempotent: true,
    handler: async (ctx: JobContext, args) => {
      const published = ctx.storage.public
      if (!published) return // Existing single-backend deployments need no projection.
      const company = ctx.scope.company
      if (!company) throw new Error('storage.publish requires a company scope')
      const A = ctx.table('storage.Attachment')
      const row = await ctx.db.one(from(A).where(eq(A.id, args.id), eq(A.companyId, company)))
      if (row?.public !== true || row.kind !== 'stored' || !inlineTypes.has(String(row.mimetype))) return
      const source = await ctx.storage.get(String(row.storeKey))
      if (!source) throw new Error('publication source is missing')
      const key = publicationKey(company, String(row.id), String(row.checksum))
      await published.put(key, source.body, { type: String(row.mimetype), size: Number(row.size) })
      // A remove/revoke during the copy must not resurrect the attachment.
      const retained = await ctx.tx(async (tx) => {
        const current = await tx.db.one(from(A).where(eq(A.id, args.id), eq(A.companyId, company)))
        if (
          current?.public !== true ||
          current.kind !== 'stored' ||
          current.mimetype !== row.mimetype ||
          current.storeKey !== row.storeKey ||
          current.checksum !== row.checksum
        )
          return false
        const result = await tx.db.update(
          'storage.Attachment',
          {
            id: args.id,
            companyId: company,
            public: true,
            kind: 'stored',
            mimetype: row.mimetype,
            storeKey: row.storeKey,
            checksum: row.checksum,
          },
          { publicStoreKey: key },
        )
        return !('dryRun' in result) && result.changes === 1
      })
      if (!retained) await published.remove(key)
    },
  }),
  sweep: defineJob({
    queue: 'maintenance',
    input: { minAgeMs: 'int?' },
    effects: ['read:storage.Attachment', 'storage:read', 'storage:remove', 'enqueue:storage.publish'],
    idempotent: true,
    handler: async (ctx: JobContext, args) => {
      const company = ctx.scope.company
      if (!company) throw new Error('storage.sweep requires a company scope')
      const A = ctx.table('storage.Attachment')
      // A caller may shorten the grace period but never erase it: upload writes the
      // bytes before it records the row, so a zero floor collects objects an
      // in-flight request is about to reference.
      const cutoff = Date.now() - Math.max(5 * 60_000, Number(args.minAgeMs ?? 60 * 60 * 1_000))
      const prefix = `blobs/${company}/`
      let after: string | undefined
      do {
        const page = await ctx.storage.list(prefix, { ...(after ? { after } : {}), limit: 250 })
        const referenced = new Set(
          (await ctx.db.all(from(A).select(A.storeKey).where(inArray(A.storeKey, page.keys)))).map(
            (row) => row.storeKey,
          ),
        )
        for (const key of page.keys) {
          if (ctx.signal.aborted) throw ctx.signal.reason
          if (referenced.has(key)) continue
          const meta = await ctx.storage.head(key)
          if (!meta?.modifiedAt || new Date(meta.modifiedAt).getTime() > cutoff) continue
          await ctx.storage.remove(key)
        }
        after = page.next
      } while (after)
      const published = ctx.storage.public
      if (!published) return
      // Publication keys are distinct per attachment; a private duplicate does
      // not retain a removed public projection (nor become public itself).
      after = undefined
      do {
        const page = await published.list(`published/${company}/`, {
          ...(after ? { after } : {}),
          limit: 250,
        })
        const referenced = new Set(
          (
            await ctx.db.all(
              from(A)
                .select(A.publicStoreKey)
                .where(eq(A.public, true), inArray(A.publicStoreKey, page.keys)),
            )
          ).map((row) => row.publicStoreKey),
        )
        for (const key of page.keys) {
          if (ctx.signal.aborted) throw ctx.signal.reason
          if (referenced.has(key)) continue
          const meta = await published.head(key)
          if (!meta?.modifiedAt || new Date(meta.modifiedAt).getTime() > cutoff) continue
          await published.remove(key)
        }
        after = page.next
      } while (after)
      // Explicitly requesting a sweep after enabling split storage also
      // reconciles legacy public attachments. Nothing migrates on process boot.
      // Keyset paging remains stable when other workers finish publications
      // (and remove rows from this missing-projection result) between pages.
      let lastId: string | undefined
      for (;;) {
        if (ctx.signal.aborted) throw ctx.signal.reason
        const query = from(A)
          .select(A.id)
          .where(
            eq(A.companyId, company),
            eq(A.public, true),
            eq(A.kind, 'stored'),
            isNull(A.publicStoreKey),
            inArray(A.mimetype, [...inlineTypes]),
          )
        const rows = await ctx.db.all(
          (lastId ? query.where(gt(A.id, lastId)) : query).orderBy(asc(A.id)).limit(250),
        )
        for (const row of rows)
          await ctx.jobs.enqueue('storage.publish', { id: row.id }, { uniqueKey: `attachment:${row.id}` })
        if (rows.length < 250) break
        lastId = String(rows[rows.length - 1]!.id)
      }
    },
  }),
}

/** Every effect a purge writes, including the bytes themselves. */
export const purgeAttachmentEffects = [
  'read:storage.Attachment',
  'write:storage.Attachment',
  'storage:remove',
] as const

/**
 * Remove the attachments on a set of records, bytes and all.
 *
 * `sweep` already collects objects nothing references, but it waits out a
 * grace period on purpose — an upload writes the bytes before it records the
 * row, so collecting eagerly would take an object an in-flight request is
 * about to point at. A caller deleting the records themselves is in a
 * different position: the rows are going in the same breath, and somebody has
 * asked for the data to be gone rather than to become unreachable.
 *
 * A `JobContext` because only a job reaches the blob store, which is the same
 * reason a deletion this size is a job at all.
 *
 * Written to be run again. Removing an object that is already gone is not an
 * error worth stopping for — a purge that crashed halfway has to be able to
 * finish, and it finishes by repeating itself.
 */
export async function purgeAttachments(
  ctx: JobContext,
  resModel: string,
  resIds: readonly string[],
): Promise<number> {
  const ids = [...new Set(resIds.map(String).filter(Boolean))]
  if (!ids.length) return 0
  const A = ctx.table('storage.Attachment')
  const rows = await ctx.db.all(from(A).where(eq(A.resModel, resModel), inArray(A.resId, ids)))
  if (!rows.length) return 0
  for (const row of rows) {
    if (ctx.signal.aborted) throw ctx.signal.reason
    // The public projection is a copy of the same bytes under another key, so
    // both go — leaving the published one behind would keep the file readable
    // by anybody holding its URL, which is the opposite of what was asked.
    for (const key of [row.storeKey, row.publicStoreKey])
      if (key) await ctx.storage.remove(String(key)).catch(() => undefined)
  }
  await ctx.db.del(deleteFrom(A).where(eq(A.resModel, resModel), inArray(A.resId, ids)))
  return rows.length
}
