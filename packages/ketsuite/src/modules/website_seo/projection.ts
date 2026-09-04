/**
 * The public projection: what a crawler is allowed to be told about a site.
 *
 * Everything here is a pure function over already-authorised data. The database
 * reads and the permission checks live in `functions.ts`; keeping the rendering
 * separate is what lets a test assert the escaping and the reserved-path rules
 * without booting an adapter.
 */

// Reserved namespaces are a routing fact, so `website` owns them and the sitemap,
// the site's own search and any future public listing read the same rule.
export { isReservedPath, reservedPrefixes } from '../website/paths.ts'

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

/** Escape a value for XML text and attribute content alike. */
export const escapeXml = (value: string): string => value.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] as string)

/**
 * A canonical URL may only point back at the site that declares it.
 *
 * A canonical pointing elsewhere hands the site's ranking to whoever owns that
 * host, so this is a permission decision rather than a formatting preference.
 *
 * The relative branch is the one that needs care. A leading `/` does not make a
 * value site-relative: a browser resolves `//other.example/x`, `/\other.example/x`
 * and `/<TAB>/other.example/x` all to that other host, because a backslash is
 * normalised to a slash for http(s) and because tab, CR and LF are stripped from
 * a URL before it is parsed. So the rules here mirror `website.cleanPath`, which
 * already refuses exactly this class, rather than testing for `//` alone.
 *
 * Returns the normalised canonical, or null when the value cannot be trusted.
 */
export const sameSiteCanonical = (value: unknown, hosts: readonly string[]): string | null => {
  const raw = String(value ?? '').trim()
  if (!raw || raw.length > 2048) return null

  if (raw.startsWith('/')) {
    if (raw.startsWith('//') || raw.includes('\\')) return null
    // Any C0 control or DEL, anywhere — not only at the ends, which trim() covers.
    if ([...raw].some((c) => c.charCodeAt(0) <= 31 || c.charCodeAt(0) === 127)) return null
    if (/[?#]/.test(raw)) return null
    try {
      if (raw.split('/').some((part) => ['.', '..'].includes(decodeURIComponent(part).toLowerCase())))
        return null
    } catch {
      return null
    }
    return raw
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  // Credentials in a canonical are never intentional and would be published.
  if (url.username || url.password) return null
  const allowed = new Set(hosts.map((host) => host.toLowerCase()))
  if (!allowed.has(url.host.toLowerCase())) return null
  return url.toString()
}

/**
 * An og:image may be a site-relative path or an absolute http(s) URL. The
 * relative form is held to the same rules as a canonical, for the same reason.
 */
export const safeOgImage = (value: unknown): string | null => {
  const raw = String(value ?? '').trim()
  if (!raw || raw.length > 2048) return null
  if (raw.startsWith('/')) return sameSiteCanonical(raw, [])
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

export type SitemapEntry = { path: string; lastModified?: string | null }

/**
 * Render a urlset. Entries are expected to be already filtered — this renders
 * what it is given and does not decide what is publishable.
 */
export const sitemapXml = (origin: string, entries: readonly SitemapEntry[]): string => {
  const base = origin.replace(/\/$/, '')
  const urls = entries
    .map((entry) => {
      const loc = escapeXml(`${base}${entry.path}`)
      const lastmod = entry.lastModified ? `\n    <lastmod>${escapeXml(entry.lastModified)}</lastmod>` : ''
      return `  <url>\n    <loc>${loc}</loc>${lastmod}\n  </url>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}${urls ? '\n' : ''}</urlset>\n`
}

/**
 * Render robots.txt.
 *
 * A site that is not serving content publicly disallows everything: content
 * being prepared should not be discovered while it is being prepared.
 */
export const robotsTxt = (
  origin: string,
  options: { indexable: boolean; prefixes: readonly string[] },
): string => {
  const base = origin.replace(/\/$/, '')
  if (!options.indexable) return 'User-agent: *\nDisallow: /\n'
  // robots.txt matches by character prefix, so a bare `Disallow: /admin` would
  // also hide `/administrative-notes`. Each namespace is emitted as its subtree
  // plus an anchored exact match, which is the segment rule isReservedPath uses.
  const disallow = options.prefixes
    .flatMap((prefix) => [`Disallow: ${prefix}/`, `Disallow: ${prefix}$`])
    .join('\n')
  return `User-agent: *\n${disallow}\n\nSitemap: ${base}/sitemap.xml\n`
}
