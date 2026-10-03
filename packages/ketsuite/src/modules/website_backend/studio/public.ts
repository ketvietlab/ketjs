import { page, withHeaders, tableNameFor } from '@ketvietlab/ketjs'
import type { Row, RequestIdentityResolveContext, Scope } from '@ketvietlab/ketjs'
import { documentHtml } from '../../../ui/client/live-doc-shell.tsx'
import type { LiveDocBlock } from '../../../ui/client/live-doc-shell.tsx'
import { websitePublicDocument } from '../../../ui/website-public.ts'
import type {
  WebsitePublicEntry,
  WebsitePublicListing,
  WebsitePublicNavItem,
} from '../../../ui/website-public.ts'
import { renderLayout, safeHref, safeImage, SECTION_RENDERERS } from '../client/public-renderer.mjs'

const object = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {}
const placements = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : [])
const supported = (layout: Row[]): boolean =>
  layout.every(
    (node) =>
      (node.type === 'website.columns' || Object.hasOwn(SECTION_RENDERERS, String(node.type))) &&
      Object.values(object(node.slots)).every((children) => supported(placements(children))),
  )
const remainingLayout = (layout: Row[]): Row[] =>
  layout
    .filter((node) => node.type !== 'website.rich_text')
    .map((node) => ({
      ...node,
      ...(node.slots
        ? {
            slots: Object.fromEntries(
              Object.entries(object(node.slots)).map(([key, nodes]) => [
                key,
                remainingLayout(placements(nodes)),
              ]),
            ),
          }
        : {}),
    }))

/** Where a visitor signs in to their customer account on a Studio site. */
export const CUSTOMER_SIGNIN_PATH = '/account/login'

/**
 * A path on this site to come back to, or the home page.
 *
 * It ends up in a link and in `location`, so anything that could leave the site - another origin,
 * a protocol-relative `//host`, a backslash a browser reads as a slash - is refused, and so is the
 * sign-in itself, which would only send a visitor round in a circle.
 */
export const customerReturnPath = (value: unknown): string => {
  const path = typeof value === 'string' ? value.trim() : ''
  const control = [...path].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)
  if (!/^\/(?![/\\])/.test(path) || /[\\\s]/.test(path) || control || path.length > 512) return '/'
  return path === CUSTOMER_SIGNIN_PATH || path.startsWith(`${CUSTOMER_SIGNIN_PATH}?`) ? '/' : path
}

/** Application-owned presenter, never executable uploaded theme code. Legacy domains keep KTL. */
export function renderStudioPublic(scope: Record<string, unknown>) {
  if (!scope.appearance || !object(scope.page).id || !supported(placements(scope.sections))) return null
  const appearance = object(scope.appearance)
  const site = object(scope.site)
  const record = object(scope.page)
  const fields = object(scope.fields)
  const legacyMeta = object(scope.meta)
  const seo = object(fields.seo)
  const meta = fields.seo
    ? {
        title: seo.title,
        // A description written as paragraphs reads as one line in a search result.
        metaDescription: String(seo.description ?? '')
          .replace(/\s+/g, ' ')
          .trim(),
        canonical: seo.canonical,
        noindex: seo.indexing === 'noindex',
        ogImage: seo.image,
      }
    : legacyMeta
  const menu = placements(scope.menu)
  const locale = String(scope.locale ?? 'vi')
  let blocks: LiveDocBlock[] | undefined
  if (record.type === 'website.post' && fields.bodyDoc) {
    try {
      const value = JSON.parse(String(fields.bodyDoc))
      if (Array.isArray(value)) blocks = value
    } catch {
      /* Historical content falls back to its layout. */
    }
  }
  // A category or tag page: the listing getEntryByPath gathered, then a pager.
  const archive = record.type === 'website.archive' ? object(fields.archive) : null
  let description: LiveDocBlock[] | undefined
  try {
    const value = archive?.descriptionDoc ? JSON.parse(String(archive.descriptionDoc)) : null
    if (Array.isArray(value)) description = value
  } catch {
    /* The plain description below still reads. */
  }
  const vi = locale === 'vi'
  const entries = (rows: Row[]): WebsitePublicEntry[] =>
    rows.map((row) => ({
      id: String(row.id),
      href: safeHref(row.path),
      title: row.title,
      publishedAt: row.publishedAt,
      excerpt: row.excerpt,
    }))
  const pager = (previous: unknown, next: unknown) => ({
    previous: previous ? safeHref(previous) : null,
    next: next ? safeHref(next) : null,
  })
  const search = record.type === 'website.search' ? object(fields.search) : null
  // A form's receipt, after the visitor posted: the form's own thanks, the code and the time.
  const receipt = record.type === 'website.formReceipt' ? object(fields.receipt) : null
  const signin = record.type === 'website.customerSignin' ? object(fields.signin) : null
  const customer = record.type === 'website.customerAccount' ? object(fields.customer) : null
  const listing: WebsitePublicListing | null = archive
    ? {
        kind: 'archive',
        title: record.title,
        descriptionHtml: description ? documentHtml(description, locale) : null,
        description: archive.description,
        entries: entries(placements(archive.posts)),
        pager: pager(archive.previous, archive.next),
      }
    : search
      ? {
          kind: 'search',
          title: record.title,
          query: String(search.q ?? ''),
          type: search.type,
          total: Number(search.total ?? 0),
          stale: !!search.stale,
          entries: entries(placements(search.hits)),
          pager: pager(search.previous, search.next),
        }
      : receipt
        ? {
            kind: 'receipt',
            title: record.title,
            message: receipt.message,
            code: receipt.code,
            createdAt: receipt.createdAt,
            createdLabel: receipt.createdLabel,
          }
        : signin
          ? { kind: 'signin', title: record.title, returnTo: customerReturnPath(signin.returnTo) }
          : customer && ['profile', 'forgot', 'reset'].includes(String(customer.view))
            ? { kind: 'customer', title: record.title, view: customer.view as 'profile' | 'forgot' | 'reset' }
            : null
  // The header offers the sign-in only where the site chose to; the sign-in page needs no link to itself.
  const here = customerReturnPath(record.path)
  const account =
    appearance.account === 'shown' && !signin && !customer
      ? {
          href:
            here === '/'
              ? CUSTOMER_SIGNIN_PATH
              : `${CUSTOMER_SIGNIN_PATH}?${new URLSearchParams({ returnTo: here })}`,
        }
      : null
  const image = meta.ogImage && safeHref(meta.ogImage) !== '#' ? safeHref(meta.ogImage) : ''
  const options = {
    mode: 'public' as const,
    locale,
    preset: appearance.preset,
    sectionData: object(scope.sectionData),
    formText: { send: vi ? 'Gửi' : 'Send' },
  }
  const layout = placements(scope.sections)
  const navigation = (parent: unknown, ancestors = new Set<string>()): WebsitePublicNavItem[] =>
    menu
      .filter((item) => (item.parentId ?? null) === parent && !ancestors.has(String(item.id)))
      .map((item) => ({
        id: String(item.id),
        href: safeHref(item.href),
        label: item.label,
        children: menu.some((child) => child.parentId === item.id)
          ? navigation(item.id, new Set([...ancestors, String(item.id)]))
          : null,
      }))
  return withHeaders(
    page({
      // A page of its own answering a refused post says so in its status, not only in its words.
      ...(typeof scope.status === 'number' ? { status: scope.status } : {}),
      body: websitePublicDocument({
        locale,
        head: {
          title: String(meta.title || record.title || ''),
          description: meta.metaDescription,
          noindex: !!meta.noindex,
          canonical: meta.canonical ? safeHref(meta.canonical) : null,
          ogType: record.type === 'website.post' ? 'article' : 'website',
          ogImage: image || null,
          ogUrl:
            meta.canonical && /^https:\/\//.test(String(meta.canonical)) ? safeHref(meta.canonical) : null,
          siteName: site.title,
        },
        theme: {
          preset: appearance.preset ?? 'default',
          accent: appearance.accent ?? 'green',
          font: appearance.font ?? 'sans',
          spacing: appearance.spacing ?? 'comfortable',
          buttons: appearance.buttons ?? 'rounded',
        },
        brand: { title: site.title, logo: appearance.logo ? safeImage(appearance.logo) : null },
        navigation: navigation(null),
        account,
        listing,
        article: blocks ? { title: record.title, bodyHtml: documentHtml(blocks, locale) } : null,
        sections: renderLayout(blocks ? remainingLayout(layout) : layout, options),
        footer: appearance.footer ?? site.title,
      }),
    }),
    { 'cache-control': 'no-cache' },
  )
}

/** Resolve only configured domains within the already selected tenant. Ambiguity fails closed. */
export async function websiteAnonymousScope({
  adapter,
  url,
  req,
}: RequestIdentityResolveContext): Promise<Scope | null> {
  let host: string
  try {
    host = new URL(`http://${req.headers.host ?? url.host}`).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return { company: null }
  }
  const q = adapter.quoteIdent.bind(adapter)
  const rows = await adapter.all(
    `SELECT ${q('companyId')} FROM ${q(tableNameFor('website.SiteDomain'))} WHERE ${q('host')} = ${adapter.name === 'postgres' ? '$1' : '?'} LIMIT 2`,
    [host],
  )
  if (!rows.length) return null
  return rows.length === 1 ? { company: String(rows[0]!.companyId), branches: null } : { company: null }
}
