import { asc, defineJob, deleteFrom, eq, from, gt, inArray, isNull } from '@ketvietlab/ketjs'
import type { JobContext, JobSpec } from '@ketvietlab/ketjs'
import { inlineTypes, publicationKey, RENDITION_SIZES, renderableTypes, renditionKey } from './policy.ts'
import type { RenditionSize } from './policy.ts'

/** Everything a stream yields, as one buffer: sharp decodes from memory, not from a stream. */
const bytesOf = async (body: AsyncIterable<Uint8Array>): Promise<Buffer> => {
  const chunks: Uint8Array[] = []
  for await (const chunk of body) chunks.push(chunk)
  return Buffer.concat(chunks)
}

/** Refuse decompression bombs before they allocate: 12k × 12k is already 432 MB of RGBA. */
const MAX_INPUT_PIXELS = 12_000 * 12_000

async function* single(buffer: Buffer): AsyncIterable<Uint8Array> {
  yield buffer
}

export const jobs: Record<string, JobSpec> = {
  /**
   * Resize one stored raster image into every RENDITION_SIZES entry, as WebP.
   *
   * sharp is imported here, inside the handler, so only a worker that actually runs
   * this job loads libvips — the HTTP process imports this module too. A size the
   * source is already smaller than is still written (never enlarged), so the file
   * route can always ask for one by name.
   */
  render: defineJob({
    // Its own queue: resizing is CPU work, and a burst of uploads must not hold up
    // publication or the sweep behind it.
    queue: 'media',
    input: { id: 'id' },
    effects: [
      'read:storage.Attachment',
      'read:storage.AttachmentRendition',
      'write:storage.AttachmentRendition',
      'storage:read',
      'storage:write',
    ],
    idempotent: true,
    maxAttempts: 3,
    timeoutMs: 120_000,
    handler: async (ctx: JobContext, args) => {
      const company = ctx.scope.company
      if (!company) throw new Error('storage.render requires a company scope')
      const A = ctx.table('storage.Attachment')
      const row = await ctx.db.one(from(A).where(eq(A.id, args.id), eq(A.companyId, company)))
      // Removed since it was queued, or not something this job renders: nothing to do.
      if (row?.kind !== 'stored' || !row.storeKey || !row.checksum) return
      if (!renderableTypes.has(String(row.mimetype))) return
      const source = await ctx.storage.get(String(row.storeKey))
      if (!source) throw new Error('rendition source is missing')
      const input = await bytesOf(source.body)
      const { default: sharp } = await import('sharp')
      // Bytes sharp cannot read (a mislabelled or truncated upload) will not decode on a
      // retry either: the original simply stays the only copy, and the job is done.
      const readable = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
        .metadata()
        .then(() => true)
        .catch(() => false)
      if (!readable) return
      for (const [size, spec] of Object.entries(RENDITION_SIZES) as Array<
        [RenditionSize, (typeof RENDITION_SIZES)[RenditionSize]]
      >) {
        if (ctx.signal.aborted) throw ctx.signal.reason
        const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
          .rotate() // honour EXIF orientation before the pixels are resized away from it
          .resize(spec.width, spec.height, { fit: spec.fit, withoutEnlargement: true })
          .webp({ quality: size === 'thumb' ? 75 : 82 })
          .toBuffer({ resolveWithObject: true })
        const key = renditionKey(company, String(row.checksum), size)
        await ctx.storage.put(key, single(data), { type: 'image/webp', size: data.length })
        const record = {
          id: `${String(row.id)}:${size}`,
          attachmentId: row.id,
          size,
          storeKey: key,
          mimetype: 'image/webp',
          width: info.width,
          height: info.height,
          bytes: data.length,
          createdAt: new Date().toISOString(),
        }
        await ctx.tx(async (tx) => {
          // The attachment may have been removed while this size was being encoded.
          if (!(await tx.db.one(from(A).where(eq(A.id, args.id), eq(A.companyId, company))))) return
          const inserted = await tx.db.insertIfAbsent('storage.AttachmentRendition', record)
          if (!('dryRun' in inserted) && !inserted.inserted)
            await tx.db.update('storage.AttachmentRendition', { id: record.id }, record)
        })
      }
    },
  }),

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
    effects: [
      'read:storage.Attachment',
      'read:storage.AttachmentRendition',
      'storage:read',
      'storage:remove',
      'enqueue:storage.publish',
    ],
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
      // Rendition objects are kept while any rendition row still names them.
      const R = ctx.table('storage.AttachmentRendition')
      after = undefined
      do {
        const page = await ctx.storage.list(`renditions/${company}/`, {
          ...(after ? { after } : {}),
          limit: 250,
        })
        const referenced = new Set(
          (await ctx.db.all(from(R).select(R.storeKey).where(inArray(R.storeKey, page.keys)))).map(
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
