import { raw, streamed, text, withHeaders } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { themeBootModule } from './boot.ts'

/**
 * Theme files are immutable per version, so a browser or a CDN may keep them for a year. A file served
 * on its own - an SVG opened directly, say - runs nothing: `sandbox` gives it an opaque origin.
 */
const IMMUTABLE = {
  'cache-control': 'public, max-age=31536000, immutable',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  'cross-origin-resource-policy': 'same-origin',
}
const missing = () => withHeaders(text('not found', { status: 404 }), { 'cache-control': 'no-store' })

export const routes: Record<string, RouteEntry> = {
  /**
   * `/_ket/` belongs to the framework, and the route parameter is a single segment, which is why
   * packages are flat. The page and its theme share an origin, so the CSP stays `'self'` and an ES
   * module needs no CORS; it also works the same on the `local` storage driver as on S3.
   */
  '/_theme/{versionId}/{file}': {
    anonymous: true,
    handler:
      (ctx: ServeContext): Route =>
      async (url, req, params) => {
        if (req.method !== 'GET' && req.method !== 'HEAD')
          return withHeaders(text('', { status: 405 }), { allow: 'GET, HEAD' })
        const { file } = (await ctx.callUnchecked(
          'website_theme.themeFileForReader',
          { versionId: params.versionId, file: params.file },
          url,
          req,
        )) as {
          file: { boot?: boolean; entry?: string; storeKey?: string; type?: string; size?: number } | null
        }
        if (!file) return missing()
        if (file.boot) {
          const source = themeBootModule(String(file.entry))
          return withHeaders(
            req.method === 'HEAD'
              ? text('', { type: 'text/javascript; charset=utf-8' })
              : text(source, { type: 'text/javascript; charset=utf-8' }),
            IMMUTABLE,
          )
        }
        const storage = await ctx.storageOf(url, req)
        const type = String(file.type)
        if (req.method === 'HEAD') {
          const meta = await storage.head(String(file.storeKey))
          return meta
            ? withHeaders(text('', { type }), { ...IMMUTABLE, 'content-length': String(meta.size) })
            : missing()
        }
        const object = await storage.get(String(file.storeKey))
        if (!object) return missing()
        // SVG is intentional markup. Keep its opaque-origin sandbox even when opened directly;
        // the octet response helpers deliberately reject active markup content types.
        if (type === 'image/svg+xml') {
          const chunks: Uint8Array[] = []
          for await (const chunk of object.body) chunks.push(chunk)
          return withHeaders(raw(Buffer.concat(chunks).toString('utf8'), { type }), {
            ...IMMUTABLE,
            'content-length': String(object.meta.size),
          })
        }
        return withHeaders(streamed(object.body, { type }), {
          ...IMMUTABLE,
          'content-length': String(object.meta.size),
        })
      },
  },
}
