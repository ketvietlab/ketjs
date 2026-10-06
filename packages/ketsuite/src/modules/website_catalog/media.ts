import { defineFn, eq, from, lt, or, json, text, streamed, withHeaders } from '@ketvietlab/ketjs'
import type { FnSpec, JobSpec, RouteEntry, Row } from '@ketvietlab/ketjs'
import { receiveAttachment } from '../storage/routes.ts'
import type { Attachment } from '../storage/routes.ts'
import { deleteRows, fail, readEffects, scoped, site, writeEffects } from './helpers.ts'

export const mediaFunctions: Record<string, FnSpec> = {
  stageImage: defineFn({
    exposure: 'internal',
    input: {
      siteId: 'id',
      ownerId: 'id',
      resModel: 'text',
      id: 'id',
      name: 'text',
      storeKey: 'text',
      mimetype: 'text',
      size: 'int',
      checksum: 'text',
    },
    effects: writeEffects,
    handler: async (ctx, args) => {
      await site(ctx, args.siteId, true)
      if (
        !ctx.actor ||
        !['website_catalog.Binding', 'website_catalog.Template', 'website_catalog.Category'].includes(
          String(args.resModel),
        ) ||
        args.storeKey !== `catalog-images/${ctx.scope.company}/${args.id}/${args.checksum}`
      )
        fail('Ảnh không hợp lệ.')
      if (
        args.resModel !== 'website_catalog.Category' ||
        (await ctx.db.select(String(args.resModel), { id: args.ownerId }))[0]
      )
        await scoped(ctx, String(args.resModel), args.siteId, args.ownerId)
      if (
        !/^image\/(png|jpeg|webp|avif)$/.test(String(args.mimetype)) ||
        Number(args.size) < 1 ||
        Number(args.size) > 5 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test(String(args.checksum))
      )
        fail('Ảnh không hợp lệ.')
      await ctx.tx(async (tx) => {
        await tx.db.insert('storage.Attachment', {
          id: args.id,
          name: args.name,
          storeKey: args.storeKey,
          mimetype: args.mimetype,
          size: args.size,
          checksum: args.checksum,
          resModel: args.resModel,
          resId: args.ownerId,
          kind: 'stored',
          public: false,
          createdAt: new Date().toISOString(),
        })
        await tx.db.insert('website_catalog.Upload', {
          id: args.id,
          siteId: args.siteId,
          resModel: args.resModel,
          ownerId: args.ownerId,
          actorId: ctx.actor,
          ready: false,
          claimed: false,
          deleting: false,
          expiresAt: new Date(Date.now() + 86400_000).toISOString(),
          storeKey: args.storeKey,
        })
      })
      return { ok: true }
    },
  }),
  completeImage: defineFn({
    exposure: 'internal',
    input: { id: 'id' },
    effects: writeEffects,
    handler: async (ctx, args) => {
      const upload = (await ctx.db.select('website_catalog.Upload', { id: args.id, actorId: ctx.actor }))[0]
      if (!upload || upload.deleting || new Date(String(upload.expiresAt)).getTime() < Date.now())
        fail('Ảnh hết hạn.')
      await site(ctx, upload!.siteId, true)
      await ctx.db.update('website_catalog.Upload', { id: args.id }, { ready: true })
      const a = (await ctx.db.select('storage.Attachment', { id: args.id }))[0]!
      return { ...a, url: `/website/catalog/files/${a.id}` }
    },
  }),
  imageForReader: defineFn({
    exposure: 'internal',
    input: { id: 'id' },
    effects: readEffects,
    handler: async (ctx, args) => {
      const a = (await ctx.db.select('storage.Attachment', { id: args.id }))[0]
      if (!a || !/^image\/(png|jpeg|webp|avif)$/.test(String(a.mimetype))) return null
      const upload = (await ctx.db.select('website_catalog.Upload', { id: args.id }))[0]
      if (upload) {
        if (
          upload.deleting ||
          !upload.ready ||
          (!upload.claimed &&
            (upload.actorId !== ctx.actor || new Date(String(upload.expiresAt)).getTime() < Date.now()))
        )
          return null
        return a
      }
      if (
        a.public &&
        a.resModel === 'website.Site' &&
        (await ctx.db.select('website.Site', { id: a.resId }))[0]
      )
        return a
      if (
        a.public &&
        a.resModel === 'product.Template' &&
        (await ctx.db.select('product_media.Media', { attachmentId: a.id, templateId: a.resId })).length
      )
        return a
      return null
    },
  }),
}
export const mediaJobs: Record<string, JobSpec> = {
  collectImages: {
    queue: 'default',
    schedule: { every: '1h' },
    crossCompany: true,
    idempotent: true,
    effects: [
      'read:website_catalog.Upload',
      'write:website_catalog.Upload',
      'read:storage.Attachment',
      'write:storage.Attachment',
      'storage:remove',
    ],
    handler: async (ctx) => {
      const U = ctx.table('website_catalog.Upload')
      const expired = await ctx.db.all(
        from(U)
          .where(or(eq(U.deleting, true), eq(U.claimed, false)), lt(U.expiresAt, new Date().toISOString()))
          .limit(200),
      )
      for (const u of expired) {
        if (!u.deleting) {
          const lease = await ctx.db.compareAndSet(
            'website_catalog.Upload',
            { id: u.id },
            { claimed: false, deleting: u.deleting ?? null },
            { deleting: true, ready: false },
          )
          if ('matched' in lease && !lease.matched) continue
        }
        await ctx.storage.remove(String(u.storeKey))
        await ctx.tx(async (tx) => {
          await deleteRows(tx, 'website_catalog.Upload', { id: u.id })
          await deleteRows(tx, 'storage.Attachment', { id: u.id })
        })
      }
    },
  },
}
export const mediaRoutes: Record<string, RouteEntry> = {
  '/website/catalog/images/{model}/{id}/{field}': (ctx) => async (url, req, params) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (!(await ctx.requestIdentityOf(url, req))) return json({ ok: false }, { status: 401 })
    let originOk = true
    try {
      if (req.headers.origin) originOk = new URL(req.headers.origin).host === req.headers.host
    } catch {
      originOk = false
    }
    if (req.headers['sec-fetch-site'] === 'cross-site' || !originOk)
      return json({ ok: false }, { status: 403 })
    if (!(await ctx.allows('website_catalog.saveBuilder', url, req)))
      return json({ ok: false }, { status: 403 })
    if (
      !['Binding', 'Template', 'Category'].includes(params.model) ||
      !['image', 'cover', 'thumbnail'].includes(params.field)
    )
      return json({ ok: false }, { status: 400 })
    try {
      const result = await receiveAttachment(ctx, url, req, {
        public: false,
        maxBytes: 5 * 1024 * 1024 + 65536,
        staged: {
          key: (company, id, checksum) => `catalog-images/${company}/${id}/${checksum}`,
          validate: async (body, type, size) => {
            if (!/^image\/(png|jpeg|webp|avif)$/.test(type) || size > 5 * 1024 * 1024)
              throw new Error('invalid image')
            const chunks = []
            for await (const chunk of body) chunks.push(chunk)
            const { default: sharp } = await import('sharp')
            const image = sharp(Buffer.concat(chunks), { limitInputPixels: 24_000_000, animated: false })
            const meta = await image.metadata()
            if (!['png', 'jpeg', 'webp', 'avif', 'heif'].includes(String(meta.format)))
              throw new Error('invalid image')
            await image.stats()
          },
          prepare: (input) =>
            ctx.callUnchecked(
              'website_catalog.stageImage',
              {
                ...input,
                siteId: url.searchParams.get('site'),
                ownerId: params.id,
                resModel: `website_catalog.${params.model}`,
              },
              url,
              req,
            ),
          complete: async (id) =>
            (await ctx.callUnchecked('website_catalog.completeImage', { id }, url, req)) as Attachment,
        },
      })
      return withHeaders(json(result, { status: 201 }), { 'cache-control': 'no-store' })
    } catch {
      return json(
        { ok: false, message: 'Không thể tải ảnh. Kiểm tra định dạng, kích thước hoặc thử lại.' },
        { status: 400 },
      )
    }
  },
  '/website/catalog/files/{id}': {
    anonymous: true,
    handler: (ctx) => async (url, req, params) => {
      if (!['GET', 'HEAD'].includes(req.method ?? 'GET')) return text('GET', { status: 405 })
      const a = (await ctx.callUnchecked(
        'website_catalog.imageForReader',
        { id: params.id },
        url,
        req,
      )) as Row | null
      if (!a) return text('not found', { status: 404 })
      const stored = await (await ctx.storageOf(url, req)).get(String(a.storeKey))
      if (!stored) return text('not found', { status: 404 })
      return withHeaders(
        req.method === 'HEAD'
          ? text('', { type: String(a.mimetype) })
          : streamed(stored.body, { type: String(a.mimetype) }),
        {
          'cache-control': a.public ? 'public, max-age=3600' : 'private, no-store',
          'x-content-type-options': 'nosniff',
          'content-disposition': 'inline',
        },
      )
    },
  },
}
