/**
 * Which public paths the deployment itself owns.
 *
 * This lives in `website` rather than in `website_seo` because it is a fact
 * about routing, not about crawlers: the sitemap, the site's own search and any
 * future public listing all have to agree on it, and only this module is a
 * dependency of all of them.
 */

/**
 * Namespaces reserved even when no module claims them by prefix. `/api` and
 * `/internal/v1` are reserved as families rather than registered as single paths.
 */
const ALWAYS_RESERVED = ['/api', '/internal/v1'] as const

/**
 * The reserved namespaces, derived from what the deployment actually serves.
 *
 * Only the first segment of each registered route matters: a module owning
 * `/admin/website/pages` owns `/admin`, and a CMS page published anywhere under
 * it can never be reached, because module routes are matched before the
 * storefront fallback. Publishing one there is a composition error, not a page
 * that merely fails to rank.
 *
 * Derived rather than hardcoded: a hand-written list drifts from the routes that
 * answer, and a page published at `/login` would then be advertised while the
 * user module serves that path.
 */
export const reservedPrefixes = (routes: Iterable<string>): string[] => {
  const found = new Set<string>(ALWAYS_RESERVED)
  for (const route of routes) {
    if (!route.startsWith('/')) continue
    const head = route.split('/')[1] ?? ''
    // A route whose first segment is a parameter reserves nothing specific.
    if (!head || head.startsWith('{')) continue
    found.add(`/${head}`)
  }
  return [...found].sort()
}

/**
 * True when a public path falls inside a reserved namespace.
 *
 * The comparison is per segment, not per character: `/administrative-notes` is
 * an ordinary page that merely begins with the same letters as `/admin`, and
 * excluding it would quietly hide real content.
 */
export const isReservedPath = (path: string, prefixes: readonly string[]): boolean =>
  prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
