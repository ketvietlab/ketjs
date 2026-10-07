import type { Route, ServeContext } from '@ketvietlab/ketjs'

type Req = Parameters<Route>[1]

export type PublicSite = {
  site: { id: string; title: string; theme?: string; googleTagManagerId?: string | null }
  locale: string
  appearance: Record<string, unknown>
  menu: unknown
}

/**
 * The Studio site the request's Host names, dressed as its home page was published.
 *
 * A page of its own - search, a form, a receipt - has no published look of its own, so it wears
 * the home page's. Null when the host is no Studio site or the site has no home page yet: such a
 * page is not served before the site is.
 */
export const publicSiteOf = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  fallbackPath?: string,
): Promise<PublicSite | null> => {
  let host = ''
  try {
    host = new URL(`http://${String(req.headers.host ?? url.host).trim()}`).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return null
  }
  const site = (await ctx.call('website.resolveSite', { host }, url, req)) as {
    id?: string
    title?: string
    locale?: string
    theme?: string
    googleTagManagerId?: string | null
  } | null
  if (!site?.id || site.id === '__legacy__') return null
  let home = (await ctx.call('website.getEntryByPath', { siteId: site.id, path: '/' }, url, req)) as {
    appearance?: Record<string, unknown> | null
  } | null
  if (!home?.appearance && fallbackPath && fallbackPath !== '/') {
    const resolve = ctx.manifest.functions['website_catalog.getEntryByPath']
      ? 'website_catalog.getEntryByPath'
      : 'website.getEntryByPath'
    home = (await ctx.call(resolve, { siteId: site.id, path: fallbackPath }, url, req)) as typeof home
  }
  if (!home?.appearance) return null
  const menu = (await ctx.call('website_menu.publicMenu', { siteId: site.id }, url, req)) ?? []
  return {
    site: {
      id: site.id,
      title: site.title ?? '',
      theme: site.theme,
      googleTagManagerId: site.googleTagManagerId,
    },
    locale: String(site.locale ?? 'vi'),
    appearance: home.appearance,
    menu,
  }
}
