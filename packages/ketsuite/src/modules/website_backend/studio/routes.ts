import { page, json, text, withHeaders } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { websiteStudioDocument } from '../../../ui/website-public.ts'
import { imageRoutes } from './images.ts'
import { searchRoutes } from './search.ts'
import { formRoutes } from './forms.ts'
import { accountRoutes } from './account.ts'
import { studioPaths } from './paths.ts'
import { studioTransport } from './transport.ts'
import type { StudioOptions } from './transport.ts'
const redirect = (location: string) => withHeaders(text('', { status: 303 }), { location })
const canOpenStudio = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) =>
  !!(await ctx.scopeOf(url, req)).company &&
  (await ctx.allows('website_backend.studioContext', url, req)) &&
  (await ctx.allows('website.getEntry', url, req))
const screen =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.requestIdentityOf(url, req)))
      return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`)
    if (!(await canOpenStudio(ctx, url, req))) return text('Forbidden', { status: 403 })
    const props = JSON.stringify({
      path: url.pathname.replace(/^\/website\/?/, '') || 'overview',
      basePath: '/website/',
      query: Object.fromEntries(url.searchParams),
    })
    return withHeaders(
      page({
        body: websiteStudioDocument(props),
      }),
      { 'cache-control': 'no-store' },
    )
  }
const api =
  (options: StudioOptions) =>
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (!(await ctx.requestIdentityOf(url, req)))
      return json({ ok: false, code: 'forbidden' }, { status: 401 })
    if (!(await canOpenStudio(ctx, url, req))) return json({ ok: false, code: 'forbidden' }, { status: 403 })
    let crossSite = req.headers['sec-fetch-site'] === 'cross-site'
    if (req.headers.origin) {
      try {
        crossSite ||= new URL(req.headers.origin).host !== req.headers.host
      } catch {
        crossSite = true
      }
    }
    if (crossSite) return json({ ok: false, code: 'forbidden' }, { status: 403 })
    if (!String(req.headers['content-type']).startsWith('application/json'))
      return json({ ok: false, code: 'validation' }, { status: 415 })
    try {
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > 1048576) return json({ ok: false, code: 'validation' }, { status: 413 })
        chunks.push(buffer)
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!input || typeof input !== 'object' || Array.isArray(input))
        return json({ ok: false, code: 'validation' }, { status: 400 })
      const name = decodeURIComponent(url.pathname.slice('/website/api/'.length))
      const value = await studioTransport(ctx, url, req, options)(name, input)
      return withHeaders(json({ ok: true, value }), { 'cache-control': 'no-store' })
    } catch (error) {
      const e = error as { code?: string; message?: string }
      const denied = e.code === 'E_FN_NOT_PERMITTED' || e.code === 'forbidden'
      return withHeaders(
        json(
          {
            ok: false,
            code: denied ? 'forbidden' : (e.code ?? 'validation'),
            message: denied ? 'Bạn không có quyền thực hiện thao tác này.' : e.message,
          },
          { status: denied ? 403 : e.code === 'notFound' ? 404 : 400 },
        ),
        { 'cache-control': 'no-store' },
      )
    }
  }
export const createStudioRoutes = (options: StudioOptions = {}): Record<string, RouteEntry> => ({
  ...Object.fromEntries(studioPaths.map((path) => [path, screen])),
  '/website': screen,
  '/website/': screen,
  '/website/api/{operation}': api(options),
  '/website-client/theme/{file}': () => async (url) =>
    redirect(`/_ket/asset/website_backend/theme/${encodeURIComponent(url.pathname.split('/').at(-1)!)}`),
  ...imageRoutes,
  ...searchRoutes,
  ...formRoutes,
  ...accountRoutes,
})
export const studioRoutes = createStudioRoutes()
