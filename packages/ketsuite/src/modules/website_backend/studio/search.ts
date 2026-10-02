import { text, withHeaders } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { renderStudioPublic } from './public.ts'
import { publicSiteOf } from './public-site.ts'

/** Results per page, the same as a category or tag page. */
const PAGE_SIZE = 20

/** The public `type` choices, and the entry type each one searches. */
const TYPES: Record<string, string> = { page: 'website.page', post: 'website.post' }

type Hit = { id: string; type: string; path: string; title: string; excerpt?: string | null }

/**
 * The public search page of a Studio site: `/search?q=&type=&page=`.
 *
 * A page is resolved from its path alone, and a search is its query, so this is a route of its
 * own rather than another path `getEntryByPath` answers. It answers through the same presenter as
 * every other page, in the look of the home page, and asks crawlers not to index it.
 */
const searchPage =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return withHeaders(text('', { status: 405 }), { allow: 'GET, HEAD' })
    const publicSite = await publicSiteOf(ctx, url, req)
    if (!publicSite) return text('', { status: 404 })
    const { site } = publicSite

    const q = (url.searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)
    const type = Object.hasOwn(TYPES, url.searchParams.get('type') ?? '')
      ? String(url.searchParams.get('type'))
      : 'all'
    const pageParam = url.searchParams.get('page') ?? ''
    const pageNo = /^[1-9]\d{0,3}$/.test(pageParam) ? Number(pageParam) : 1
    const found =
      q.length >= 2
        ? ((await ctx.call(
            'website_search.searchIndexed',
            {
              siteId: site.id,
              q,
              ...(type === 'all' ? {} : { type: TYPES[type] }),
              limit: PAGE_SIZE,
              offset: (pageNo - 1) * PAGE_SIZE,
            },
            url,
            req,
          )) as { hits: Hit[]; total: number; stale: boolean })
        : { hits: [], total: 0, stale: false }
    const pageCount = Math.max(1, Math.ceil(found.total / PAGE_SIZE))
    const at = (n: number) => {
      const query = new URLSearchParams({ q })
      if (type !== 'all') query.set('type', type)
      if (n > 1) query.set('page', String(n))
      return `/search?${query}`
    }
    const locale = publicSite.locale
    const label = locale === 'vi' ? 'Tìm kiếm' : 'Search'
    return (
      renderStudioPublic({
        site,
        locale,
        menu: publicSite.menu,
        page: { id: 'search', path: '/search', title: label, type: 'website.search' },
        fields: {
          seo: { title: q ? `${label}: ${q}` : label, description: '', canonical: '', indexing: 'noindex' },
          search: {
            q,
            type,
            page: pageNo,
            total: found.total,
            stale: found.stale,
            hits: found.hits,
            previous: pageNo > 1 ? at(pageNo - 1) : null,
            next: pageNo < pageCount ? at(pageNo + 1) : null,
          },
        },
        appearance: publicSite.appearance,
        meta: {},
        sections: [],
      }) ?? text('', { status: 404 })
    )
  }

export const searchRoutes: Record<string, RouteEntry> = {
  '/search': { anonymous: true, handler: searchPage },
}
