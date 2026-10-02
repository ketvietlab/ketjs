import { page, withHeaders, tableNameFor } from '@ketvietlab/ketjs'
import type { Row, RequestIdentityResolveContext, Scope } from '@ketvietlab/ketjs'
import { html, each, trustedMarkup } from '@ketvietlab/ketjs-view'
import { documentHtml } from '../../../ui/client/live-doc-shell.tsx'
import type { LiveDocBlock } from '../../../ui/client/live-doc-shell.tsx'
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
  // An archive and a search list entries the same way: a title to open, its date, a few words.
  const entryList = (rows: Row[]) =>
    html`<ol>${each(
      rows,
      (row) => String(row.id),
      (row) =>
        html`<li><article><h2><a href=${safeHref(row.path)}>${row.title}</a></h2>${row.publishedAt ? html`<time datetime=${String(row.publishedAt)}>${String(row.publishedAt).slice(0, 10)}</time>` : null}${row.excerpt ? html`<p>${row.excerpt}</p>` : null}</article></li>`,
    )}</ol>`
  const pager = (previous: unknown, next: unknown) =>
    previous || next
      ? html`<nav aria-label=${vi ? 'Phân trang' : 'Pagination'}>${previous ? html`<a rel="prev" href=${safeHref(previous)}>${vi ? 'Trang trước' : 'Previous page'}</a>` : html`<span></span>`}${next ? html`<a rel="next" href=${safeHref(next)}>${vi ? 'Trang sau' : 'Next page'}</a>` : null}</nav>`
      : null
  const searchLabel = vi ? 'Tìm kiếm' : 'Search'
  const search = record.type === 'website.search' ? object(fields.search) : null
  const query = String(search?.q ?? '')
  const hits = placements(search?.hits)
  // A form's receipt, after the visitor posted: the form's own thanks, the code and the time.
  const receipt = record.type === 'website.formReceipt' ? object(fields.receipt) : null
  const listing = archive
    ? html`<section class="wt-public-archive"><h1>${record.title}</h1>${description ? html`<div data-ui="flow-editor-content">${trustedMarkup(documentHtml(description, locale))}</div>` : archive.description ? html`<p>${archive.description}</p>` : null}${
        placements(archive.posts).length
          ? entryList(placements(archive.posts))
          : html`<p>${vi ? 'Chưa có bài viết.' : 'No posts yet.'}</p>`
      }${pager(archive.previous, archive.next)}</section>`
    : search
      ? html`<section class="wt-public-search"><h1>${record.title}</h1><form role="search" action="/search" method="get"><label>${vi ? 'Từ khoá' : 'Keywords'}<input type="search" name="q" value=${query} maxlength="100" autocomplete="off"></label><label>${vi ? 'Loại' : 'Type'}<select name="type">${each(
          [
            ['all', vi ? 'Tất cả' : 'All'],
            ['page', vi ? 'Trang' : 'Pages'],
            ['post', vi ? 'Bài viết' : 'Posts'],
          ],
          ([value]) => String(value),
          ([value, label]) =>
            html`<option value=${value} selected=${search.type === value ? true : null}>${label}</option>`,
        )}</select></label><button type="submit">${vi ? 'Tìm' : 'Search'}</button></form>${
          !query
            ? null
            : query.length < 2
              ? html`<p>${vi ? 'Nhập ít nhất 2 ký tự.' : 'Type at least 2 characters.'}</p>`
              : html`<p role="status">${vi ? `${Number(search.total ?? 0)} kết quả` : `${Number(search.total ?? 0)} results`}${
                  // A rebuild that has not caught up still answers; the visitor is told it may be short.
                  search.stale
                    ? vi
                      ? ' · Chỉ mục đang cập nhật, có thể còn thiếu kết quả.'
                      : ' · The index is updating; some results may be missing.'
                    : ''
                }</p>${hits.length ? entryList(hits) : html`<p>${vi ? 'Không tìm thấy kết quả phù hợp.' : 'Nothing matched.'}</p>`}${pager(search.previous, search.next)}`
        }</section>`
      : receipt
        ? html`<section class="wt-public-receipt"><h1>${record.title}</h1><p role="status">${receipt.message}</p>${
            receipt.code
              ? html`<dl><dt>${vi ? 'Mã biên nhận' : 'Receipt'}</dt><dd><code>${receipt.code}</code></dd><dt>${vi ? 'Thời gian gửi' : 'Sent at'}</dt><dd><time datetime=${String(receipt.createdAt)}>${receipt.createdLabel}</time></dd></dl>`
              : null
          }<a class="wt-button" href="/">${vi ? 'Về trang chủ' : 'Back to the home page'}</a></section>`
        : null
  // Shared links read Open Graph; a crawler that finds none guesses from the page.
  const title = String(meta.title || record.title || '')
  const image = meta.ogImage && safeHref(meta.ogImage) !== '#' ? safeHref(meta.ogImage) : ''
  const canonicalUrl =
    meta.canonical && /^https:\/\//.test(String(meta.canonical)) ? safeHref(meta.canonical) : ''
  const openGraph = html`<meta property="og:type" content=${record.type === 'website.post' ? 'article' : 'website'}><meta property="og:title" content=${title}>${meta.metaDescription ? html`<meta property="og:description" content=${meta.metaDescription}>` : null}<meta property="og:site_name" content=${site.title}>${image ? html`<meta property="og:image" content=${image}>` : null}${canonicalUrl ? html`<meta property="og:url" content=${canonicalUrl}>` : null}`
  const options = {
    mode: 'public' as const,
    locale,
    preset: appearance.preset,
    sectionData: object(scope.sectionData),
    formText: { send: vi ? 'Gửi' : 'Send' },
  }
  const layout = placements(scope.sections)
  // Parent links stay usable; nested lists remain available without client JavaScript.
  const navigation = (parent: unknown, ancestors = new Set<string>()): ReturnType<typeof html> =>
    html`<ul>${each(
      menu.filter((item) => (item.parentId ?? null) === parent && !ancestors.has(String(item.id))),
      (item) => String(item.id),
      (item) =>
        html`<li><a href=${safeHref(item.href)}>${item.label}</a>${menu.some((child) => child.parentId === item.id) ? navigation(item.id, new Set([...ancestors, String(item.id)])) : null}</li>`,
    )}</ul>`
  return withHeaders(
    page({
      // A page of its own answering a refused post says so in its status, not only in its words.
      ...(typeof scope.status === 'number' ? { status: scope.status } : {}),
      body: html`<html lang=${locale}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${meta.metaDescription ? html`<meta name="description" content=${meta.metaDescription}>` : null}${openGraph}${meta.noindex ? html`<meta name="robots" content="noindex">` : null}${meta.canonical ? html`<link rel="canonical" href=${safeHref(meta.canonical)}>` : null}<link rel="stylesheet" href="/_ket/asset/website_backend/public.css"></head><body class="wt-public"><div class="wt-site" data-website-theme="default" data-theme-preset=${appearance.preset ?? 'default'} data-accent=${appearance.accent ?? 'green'} data-font=${appearance.font ?? 'sans'} data-spacing=${appearance.spacing ?? 'comfortable'} data-buttons=${appearance.buttons ?? 'rounded'}><header class="wt-theme-header"><a href="/">${appearance.logo ? html`<img class="wt-public-logo" src=${safeImage(appearance.logo)} alt=${site.title}>` : html`<strong>${site.title}</strong>`}</a><nav aria-label=${locale === 'vi' ? 'Điều hướng chính' : 'Main navigation'}>${navigation(null)}</nav>${search ? null : html`<form class="wt-public-search-box" role="search" action="/search" method="get"><input type="search" name="q" maxlength="100" autocomplete="off" aria-label=${searchLabel} placeholder=${searchLabel}><button type="submit">${vi ? 'Tìm' : 'Search'}</button></form>`}</header><main>${listing}${blocks ? html`<article class="wt-public-post"><h1>${record.title}</h1><div data-ui="flow-editor-content">${trustedMarkup(documentHtml(blocks, locale))}</div></article>` : null}${renderLayout(blocks ? remainingLayout(layout) : layout, options)}</main><footer class="wt-theme-footer">${appearance.footer ?? site.title}</footer></div></body></html>`,
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
