import { raw, text, withHeaders } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, RouteResult, ServeContext } from '@ketvietlab/ketjs'
import { reservedPrefixes, robotsTxt, sitemapXml } from './projection.ts'

type Req = Parameters<Route>[1]

/** Both files are cheap to regenerate and stale for minutes at worst. */
const cached = (result: RouteResult): RouteResult =>
  withHeaders(result, { 'cache-control': 'public, max-age=300' })

const notAllowed = (): RouteResult => withHeaders(text('', { status: 405 }), { allow: 'GET, HEAD' })

/**
 * The origin a crawler used to reach us. Both files must speak in absolute URLs,
 * and the only host we can honestly name is the one the request arrived on —
 * inventing a canonical host here would contradict the domain the site answers.
 */
const originOf = (req: Req): string => {
  const host = String(req.headers.host ?? '')
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    ?.trim()
  const scheme = forwarded === 'https' || forwarded === 'http' ? forwarded : 'http'
  return `${scheme}://${host}`
}

/**
 * The site this host actually serves.
 *
 * `resolveSite` answers with a synthetic `__legacy__` site when a company has no
 * active site at all, so a deployment can still render something while it is
 * being set up. That is precisely the state these two files must not advertise,
 * so it does not count as a site here.
 */
const siteFor = async (ctx: ServeContext, url: URL, req: Req): Promise<{ id: string } | null> => {
  const site = (await ctx.call('website.resolveSite', { host: String(req.headers.host ?? '') }, url, req)) as
    | { id?: string }
    | null
    | undefined
  return site?.id && site.id !== '__legacy__' ? { id: site.id } : null
}

export const routes: Record<string, RouteEntry> = {
  '/robots.txt': {
    anonymous: true,
    handler:
      (ctx: ServeContext): Route =>
      async (url, req) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return notAllowed()
        const site = await siteFor(ctx, url, req)
        const prefixes = reservedPrefixes(Object.keys(ctx.manifest.routes ?? {}))
        return cached(text(robotsTxt(originOf(req), { indexable: site !== null, prefixes })))
      },
  },

  '/sitemap.xml': {
    anonymous: true,
    handler:
      (ctx: ServeContext): Route =>
      async (url, req) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return notAllowed()
        const site = await siteFor(ctx, url, req)
        if (!site) return text('', { status: 404 })
        const entries = (await ctx.call('website_seo.sitemapEntries', { siteId: site.id }, url, req)) as
          | Array<{ path: string; lastModified?: string | null }>
          | null
          | undefined
        // Every value in here went through escapeXml in the projection.
        return cached(
          raw(sitemapXml(originOf(req), entries ?? []), { type: 'application/xml; charset=utf-8' }),
        )
      },
  },
}
