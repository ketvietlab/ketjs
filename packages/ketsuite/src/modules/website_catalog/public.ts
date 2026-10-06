import { text, withHeaders } from '@ketvietlab/ketjs'
import type { RouteEntry, Row } from '@ketvietlab/ketjs'
import { publicSiteOf } from '../website_backend/studio/public-site.ts'
import { renderStudioPublic } from '../website_backend/studio/public.ts'

/** Catalog pages need their pager/query and real 301 redirects, rather than a path-only CMS lookup. */
const page: RouteEntry = {
  anonymous: true,
  handler: (ctx) => async (url, req) => {
    if (!['GET', 'HEAD'].includes(req.method ?? 'GET')) return text('GET', { status: 405 })
    const context = await publicSiteOf(ctx, url, req, url.pathname)
    if (!context) return text('not found', { status: 404 })
    const target = (await ctx.call(
      'website_catalog.resolveRedirect',
      { siteId: context.site.id, path: url.pathname },
      url,
      req,
    )) as { path?: string } | null
    if (target?.path) return withHeaders(text('', { status: 301 }), { location: target.path + url.search })
    const record = (await ctx.call(
      'website_catalog.getEntryByPath',
      {
        siteId: context.site.id,
        path: url.pathname,
        page: Math.max(1, Number(url.searchParams.get('page')) || 1),
      },
      url,
      req,
    )) as Row | null
    if (!record) return text('not found', { status: 404 })
    const sections = typeof record.layout === 'string' ? JSON.parse(record.layout) : record.layout
    const sectionData = await ctx.resolveSectionData(sections, context.site.id, url, req)
    const result = renderStudioPublic({
      ...context,
      page: record,
      sections,
      sectionData,
      request: { preview: false, staff: (await ctx.requestIdentityOf(url, req)) !== null },
      meta: record.meta ?? {},
      appearance: record.appearance ?? context.appearance,
      fields: record.fields,
    })
    return result ?? text('not found', { status: 404 })
  },
}
const preview: RouteEntry = (ctx) => async (url, req, params) => {
  if (!['GET', 'HEAD'].includes(req.method ?? 'GET')) return text('GET', { status: 405 })
  if (!(await ctx.requestIdentityOf(url, req))) return text('sign in', { status: 401 })
  if (!(await ctx.allows('website_catalog.getBuilder', url, req))) return text('forbidden', { status: 403 })
  const input = {
    siteId: url.searchParams.get('site'),
    id: params.id,
    mode: params.mode,
    ...(url.searchParams.get('product') ? { productId: url.searchParams.get('product') } : {}),
  }
  const data = (await ctx.call('website_catalog.getBuilder', input, url, req)) as Row,
    entry = data.entry as Row
  const sectionData = await ctx.resolveSectionData(entry.layout, String(input.siteId), url, req)
  const menu = await ctx.call('website_menu.publicMenu', { siteId: input.siteId }, url, req)
  return (
    renderStudioPublic({
      site: data.site,
      locale: (data.site as Row).locale,
      appearance: data.appearance,
      menu,
      page: { id: entry.id, path: entry.path, title: entry.title, type: 'website.product' },
      fields: {},
      sections: entry.layout,
      sectionData,
      readonlyForms: true,
      request: { preview: true, themeInteractive: true, staff: true },
    }) ?? text('not found', { status: 404 })
  )
}
export const publicRoutes: Record<string, RouteEntry> = {
  '/website/catalog/preview/{mode}/{id}': preview,
  '/p/{slug}': page,
  '/c/{slug}': page,
  '/danh-muc/{slug}': page,
  '/bo-suu-tap/{slug}': page,
}
