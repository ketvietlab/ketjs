import { randomUUID } from 'node:crypto'
import { defineFn, KetError, from, eq, deleteFrom, asc, gt } from '@ketvietlab/ketjs'
import type { Ctx, JobContext, Row, ModelDef, FnSpec, JobSpec } from '@ketvietlab/ketjs'
import { canEditEntry, canAccessSite } from './access.ts'

export const IMAGE_TTL = 24 * 60 * 60 * 1000
const invalid = (): never => {
  throw new KetError({
    code: 'E_WEBSITE_IMAGE',
    message: 'Ảnh không hợp lệ, đã hết hạn hoặc không thuộc nội dung này.',
  })
}
export const imageUrl = (id: unknown) => `/website/files/${encodeURIComponent(String(id))}`
export const imageModels: Record<string, ModelDef> = {
  ImageAsset: {
    scope: 'company',
    fields: {
      id: 'id',
      siteId: 'ref:website.Site',
      entryId: 'text',
      ownerId: 'text',
      name: 'text',
      storeKey: 'text',
      mimetype: 'text',
      size: 'int',
      checksum: 'text',
      state: 'text',
      ready: 'bool',
      expiresAt: 'datetime?',
      unreferencedAt: 'datetime?',
      claim: 'text',
    },
  },
  ImageReference: {
    scope: 'company',
    fields: { id: 'id', imageId: 'ref:website.ImageAsset', revisionId: 'ref:website.EntryRevision' },
    indexes: { image_revision: { fields: ['imageId', 'revisionId'], unique: true } },
  },
}
export function imageIds(value: unknown, result = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    const match = /^\/website\/files\/([A-Za-z0-9-]+)$/.exec(value)
    if (match) result.add(match[1]!)
    else if (value.startsWith('[') || value.startsWith('{')) {
      try {
        imageIds(JSON.parse(value), result)
      } catch {
        /* prose */
      }
    }
  } else if (Array.isArray(value)) for (const item of value) imageIds(item, result)
  else if (value && typeof value === 'object') for (const item of Object.values(value)) imageIds(item, result)
  return result
}
export const imageClaimEffects = [
  'read:website.ImageAsset',
  'write:website.ImageAsset',
  'write:website.ImageReference',
]
/** Called inside the same transaction that inserts an immutable revision. */
export async function claimImages(
  ctx: Ctx,
  entryId: unknown,
  siteId: unknown,
  revisionId: string,
  value: unknown,
) {
  for (const id of imageIds(value)) {
    const asset = (await ctx.db.select('website.ImageAsset', { id }))[0]
    if (
      !asset ||
      asset.entryId !== entryId ||
      asset.siteId !== siteId ||
      !asset.ready ||
      !['pending', 'attached'].includes(String(asset.state)) ||
      (asset.state === 'pending' &&
        ((ctx.actor && asset.ownerId !== ctx.actor) ||
          new Date(String(asset.expiresAt)).getTime() <= Date.now()))
    )
      invalid()
    const changed = await ctx.db.compareAndSet(
      'website.ImageAsset',
      { id },
      { state: asset.state, claim: asset.claim },
      { state: 'attached', expiresAt: null, unreferencedAt: null, claim: randomUUID() },
    )
    if (!('dryRun' in changed) && !changed.matched) invalid()
    await ctx.db.insertIfAbsent('website.ImageReference', {
      id: `${revisionId}:${id}`,
      imageId: id,
      revisionId,
    })
  }
}
const entryEffects = ['read:website.Site', 'read:website.SiteMember', 'read:website.Entry']
export const imageFunctions: Record<string, FnSpec> = {
  stageImage: defineFn({
    exposure: 'internal',
    input: {
      id: 'id',
      entryId: 'id',
      siteId: 'id',
      name: 'text',
      storeKey: 'text',
      mimetype: 'text',
      size: 'int',
      checksum: 'text',
    },
    output: { ok: 'bool' },
    effects: [...entryEffects, 'write:website.ImageAsset', 'enqueue:website.collectImages'],
    handler: async (ctx, args) => {
      const entry = (await ctx.db.select('website.Entry', { id: args.entryId, siteId: args.siteId }))[0]
      if (
        !ctx.actor ||
        !(await canAccessSite(ctx, args.siteId)) ||
        (entry && (!(await canEditEntry(ctx, entry)) || entry.status === 'trash'))
      )
        invalid()
      if (
        !['image/png', 'image/jpeg', 'image/webp', 'image/avif'].includes(String(args.mimetype)) ||
        Number(args.size) <= 0 ||
        Number(args.size) > 5 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test(String(args.checksum)) ||
        args.storeKey !== `website-images/${ctx.scope.company}/${args.id}/${args.checksum}`
      )
        invalid()
      await ctx.tx(async (tx) => {
        await tx.db.insert('website.ImageAsset', {
          ...args,
          ownerId: ctx.actor,
          state: 'pending',
          ready: false,
          expiresAt: new Date(Date.now() + IMAGE_TTL).toISOString(),
          unreferencedAt: null,
          claim: randomUUID(),
        })
        await tx.jobs.enqueue(
          'website.collectImages',
          {},
          { runAt: new Date(Date.now() + IMAGE_TTL), uniqueKey: `upload:${args.id}` },
        )
      })
      return { ok: true }
    },
  }),
  completeImage: defineFn({
    exposure: 'internal',
    input: { id: 'id' },
    output: {
      id: 'id',
      name: 'text',
      kind: 'text',
      url: 'text',
      mimetype: 'text',
      size: 'int',
      public: 'bool',
    },
    effects: [...entryEffects, 'read:website.ImageAsset', 'write:website.ImageAsset'],
    handler: async (ctx, args) => {
      const asset = (await ctx.db.select('website.ImageAsset', { id: args.id }))[0]
      if (
        !asset ||
        asset.ownerId !== ctx.actor ||
        asset.state !== 'pending' ||
        new Date(String(asset.expiresAt)).getTime() <= Date.now() ||
        !(await canAccessSite(ctx, asset.siteId))
      )
        invalid()
      const changed = await ctx.db.compareAndSet(
        'website.ImageAsset',
        { id: args.id },
        { state: 'pending', claim: asset.claim },
        { ready: true },
      )
      if (!('dryRun' in changed) && !changed.matched) invalid()
      return {
        id: asset.id,
        name: asset.name,
        kind: 'stored',
        url: imageUrl(asset.id),
        mimetype: asset.mimetype,
        size: asset.size,
        public: false,
      }
    },
  }),
  imageForReader: defineFn({
    exposure: 'internal',
    crossCompany: true,
    input: { id: 'id' },
    output: { image: 'json?' },
    effects: [
      ...entryEffects,
      'read:website.EntryRevision',
      'read:website.Publication',
      'read:website.ImageAsset',
      'read:website.ImageReference',
    ],
    handler: async (ctx, args) => {
      const asset = (await ctx.db.select('website.ImageAsset', { id: args.id }))[0]
      if (!asset?.ready || asset.state === 'deleting') return { image: null }
      const publicEntry = (await ctx.db.select('website.Entry', { id: asset.entryId }))[0]
      const site = (await ctx.db.select('website.Site', { id: asset.siteId }))[0]
      const published = publicEntry?.publishedRevisionId
        ? (await ctx.db.select('website.EntryRevision', { id: publicEntry.publishedRevisionId }))[0]
        : null
      if (
        site?.active &&
        publicEntry?.status !== 'trash' &&
        published &&
        imageIds(published).has(String(asset.id))
      )
        return { image: { ...asset, public: true } }
      if (!ctx.actor || !(await canAccessSite(ctx, asset.siteId))) return { image: null }
      if (
        asset.state === 'pending' &&
        (asset.ownerId !== ctx.actor || new Date(String(asset.expiresAt)).getTime() <= Date.now())
      )
        return { image: null }
      return { image: { ...asset, public: false } }
    },
  }),
}
async function referenced(ctx: Ctx, asset: Row) {
  for (const ref of await ctx.db.select('website.ImageReference', { imageId: asset.id }))
    if ((await ctx.db.select('website.EntryRevision', { id: ref.revisionId }))[0]) return true
  // Legacy publication snapshots may outlive a revision-retention job.
  return (await ctx.db.select('website.Publication', { siteId: asset.siteId })).some((p) =>
    imageIds(p).has(String(asset.id)),
  )
}
export async function collectImages(ctx: JobContext) {
  const A = ctx.table('website.ImageAsset')
  let after = ''
  for (;;) {
    let query = from(A).orderBy(asc(A.id)).limit(200)
    if (after) query = query.where(gt(A.id, after))
    const batch = await ctx.db.all(query)
    for (const asset of batch) {
      if (ctx.signal.aborted) throw ctx.signal.reason
      const remove = await ctx.tx(async (tx) => {
        if (await referenced(tx, asset)) return false
        const now = Date.now()
        if (asset.state === 'attached' && !asset.unreferencedAt) {
          await tx.db.compareAndSet(
            'website.ImageAsset',
            { id: asset.id },
            { state: asset.state, claim: asset.claim },
            { unreferencedAt: new Date(now).toISOString() },
          )
          return false
        }
        const deadline =
          asset.state === 'pending'
            ? new Date(String(asset.expiresAt)).getTime()
            : new Date(String(asset.unreferencedAt)).getTime() + IMAGE_TTL
        if (asset.state !== 'deleting' && (!Number.isFinite(deadline) || deadline > now)) return false
        const changed = await tx.db.compareAndSet(
          'website.ImageAsset',
          { id: asset.id },
          { state: asset.state, claim: asset.claim },
          { state: 'deleting' },
        )
        return 'dryRun' in changed || changed.matched
      })
      if (!remove) continue
      // Failure leaves the tombstone for the worker retry and the next scheduled sweep.
      await ctx.storage.remove(String(asset.storeKey))
      // Keep an unfinished upload tombstone: a delayed object-store write may
      // still arrive after expiry. Future sweeps must continue deleting its key.
      if (!asset.ready) continue
      await ctx.tx(async (tx) => {
        const R = tx.table('website.ImageReference')
        await tx.db.del(deleteFrom(R).where(eq(R.imageId, asset.id)))
        await tx.db.del(deleteFrom(A).where(eq(A.id, asset.id), eq(A.state, 'deleting')))
      })
    }
    if (batch.length < 200) break
    after = String(batch.at(-1)!.id)
  }
}
export const imageJobs: Record<string, JobSpec> = {
  collectImages: {
    queue: 'default',
    schedule: { every: '1m' },
    crossCompany: true,
    idempotent: true,
    maxAttempts: 8,
    effects: [
      'read:website.ImageAsset',
      'write:website.ImageAsset',
      'read:website.ImageReference',
      'write:website.ImageReference',
      'read:website.EntryRevision',
      'read:website.Publication',
      'storage:remove',
    ],
    handler: collectImages,
  },
}
