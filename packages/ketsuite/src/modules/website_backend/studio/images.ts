import { json, text, streamed, withHeaders } from '@ketvietlab/ketjs'
import type { Row, RouteEntry } from '@ketvietlab/ketjs'
import { receiveAttachment } from '../../storage/routes.ts'
import type { Attachment } from '../../storage/routes.ts'

export const imageRoutes: Record<string, RouteEntry> = {
  '/website/images/{entryId}/{field}': (ctx) => async (url, req, params) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (!(await ctx.requestIdentityOf(url, req))) return json({ ok: false }, { status: 401 })
    if (req.headers['sec-fetch-site'] === 'cross-site') return json({ ok: false }, { status: 403 })
    if (req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host) return json({ ok: false }, { status: 403 })
      } catch {
        return json({ ok: false }, { status: 403 })
      }
    }
    if (!['image', 'cover'].includes(params.field) || !(await ctx.allows('website.saveEntry', url, req)))
      return json({ ok: false }, { status: 403 })
    const found = (await ctx.call('website.getEntry', { id: params.entryId }, url, req)) as {
      entry: Row | null
    }
    const siteId = url.searchParams.get('site')
    if (!siteId || (found?.entry && (found.entry.status === 'trash' || found.entry.siteId !== siteId)))
      return json({ ok: false }, { status: 404 })
    if (!found?.entry) {
      const context = (await ctx.call('website_backend.studioContext', { siteId }, url, req)) as {
        site: Row | null
      }
      if (!context.site) return json({ ok: false }, { status: 404 })
    }
    try {
      const stored = await receiveAttachment(ctx, url, req, {
        public: false,
        maxBytes: 5 * 1024 * 1024 + 64 * 1024,
        staged: {
          key: (company, id, checksum) => `website-images/${company}/${id}/${checksum}`,
          validate: async (body, type, size) => {
            if (
              !['image/png', 'image/jpeg', 'image/webp', 'image/avif'].includes(type) ||
              size <= 0 ||
              size > 5 * 1024 * 1024
            )
              throw new Error('invalid image')
            const parts: Uint8Array[] = []
            for await (const part of body) parts.push(part)
            const { default: sharp } = await import('sharp')
            const picture = sharp(Buffer.concat(parts), { limitInputPixels: 24_000_000, animated: false })
            const meta = await picture.metadata()
            if (!['png', 'jpeg', 'webp', 'heif', 'avif'].includes(String(meta.format)))
              throw new Error('invalid image')
            await picture.stats()
          },
          prepare: (input) =>
            ctx.callUnchecked('website.stageImage', { ...input, entryId: params.entryId, siteId }, url, req),
          complete: async (id) =>
            (await ctx.callUnchecked('website.completeImage', { id }, url, req)) as Attachment,
        },
      })
      return withHeaders(json(stored, { status: 201 }), { 'cache-control': 'no-store' })
    } catch {
      return json(
        {
          ok: false,
          code: 'invalidImage',
          message: 'Không thể tải ảnh. Kiểm tra định dạng, kích thước hoặc thử lại.',
        },
        { status: 400 },
      )
    }
  },
  '/website/files/{id}': {
    anonymous: true,
    handler: (ctx) => async (url, req, params) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return text('GET', { status: 405 })
      const identity = await ctx.requestIdentityOf(url, req)
      if (identity && !(await ctx.allows('website.getEntry', url, req)))
        return text('not found', { status: 404 })
      const { image } = (await ctx.callUnchecked('website.imageForReader', { id: params.id }, url, req)) as {
        image: Row | null
      }
      if (!image) return text('not found', { status: 404 })
      const object = await (await ctx.storageOf(url, req)).get(String(image.storeKey))
      if (!object) return text('not found', { status: 404 })
      const headers = {
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
        'content-length': String(object.meta.size),
      }
      return withHeaders(
        req.method === 'HEAD'
          ? text('', { type: String(image.mimetype) })
          : streamed(object.body, { type: String(image.mimetype) }),
        headers,
      )
    },
  },
}
