import { html, each, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'

// The public website and the Studio page that edits it are whole documents, not admin screens:
// a visitor's page has no backend frame, and the Studio mounts its own client inside an empty one.
// Every href and image arrives already checked; this file decides only how they read.

export type WebsitePublicEntry = {
  id: string
  href: string
  title: unknown
  publishedAt?: unknown
  excerpt?: unknown
}
export type WebsitePublicPager = { previous?: string | null; next?: string | null }
export type WebsitePublicNavItem = {
  id: string
  href: string
  label: unknown
  /** Null when the item has no children; an empty list still opens a nested list. */
  children: WebsitePublicNavItem[] | null
}
export type WebsitePublicListing =
  | {
      kind: 'archive'
      title: unknown
      /** Rendered from the description document; when present it replaces the plain description. */
      descriptionHtml?: string | null
      description?: unknown
      entries: WebsitePublicEntry[]
      pager: WebsitePublicPager
    }
  | {
      kind: 'search'
      title: unknown
      query: string
      type: unknown
      total: number
      stale: boolean
      entries: WebsitePublicEntry[]
      pager: WebsitePublicPager
    }
  | {
      kind: 'receipt'
      title: unknown
      message: unknown
      code?: unknown
      createdAt?: unknown
      createdLabel?: unknown
    }
export type WebsitePublicPage = {
  locale: string
  head: {
    title: string
    description?: unknown
    noindex?: boolean
    canonical?: string | null
    ogType: 'article' | 'website'
    ogImage?: string | null
    ogUrl?: string | null
    siteName: unknown
  }
  theme: { preset: unknown; accent: unknown; font: unknown; spacing: unknown; buttons: unknown }
  brand: { title: unknown; logo?: string | null }
  navigation: WebsitePublicNavItem[]
  listing: WebsitePublicListing | null
  /** A post's body, rendered from its document. */
  article: { title: unknown; bodyHtml: string } | null
  sections: unknown
  footer: unknown
}

// An archive and a search list entries the same way: a title to open, its date, a few words.
const entryList = (rows: WebsitePublicEntry[]) =>
  html`<ol>${each(
    rows,
    (row) => row.id,
    (row) =>
      html`<li><article><h2><a href=${row.href}>${row.title}</a></h2>${row.publishedAt ? html`<time datetime=${String(row.publishedAt)}>${String(row.publishedAt).slice(0, 10)}</time>` : null}${row.excerpt ? html`<p>${row.excerpt}</p>` : null}</article></li>`,
  )}</ol>`

const pager = ({ previous, next }: WebsitePublicPager, vi: boolean) =>
  previous || next
    ? html`<nav aria-label=${vi ? 'Phân trang' : 'Pagination'}>${previous ? html`<a rel="prev" href=${previous}>${vi ? 'Trang trước' : 'Previous page'}</a>` : html`<span></span>`}${next ? html`<a rel="next" href=${next}>${vi ? 'Trang sau' : 'Next page'}</a>` : null}</nav>`
    : null

const listing = (value: WebsitePublicListing | null, vi: boolean): TemplateResult | null => {
  if (!value) return null
  if (value.kind === 'archive')
    return html`<section class="wt-public-archive"><h1>${value.title}</h1>${value.descriptionHtml != null ? html`<div data-ui="flow-editor-content">${trustedMarkup(value.descriptionHtml)}</div>` : value.description ? html`<p>${value.description}</p>` : null}${
      value.entries.length
        ? entryList(value.entries)
        : html`<p>${vi ? 'Chưa có bài viết.' : 'No posts yet.'}</p>`
    }${pager(value.pager, vi)}</section>`
  if (value.kind === 'search')
    return html`<section class="wt-public-search"><h1>${value.title}</h1><form role="search" action="/search" method="get"><label>${vi ? 'Từ khoá' : 'Keywords'}<input type="search" name="q" value=${value.query} maxlength="100" autocomplete="off"></label><label>${vi ? 'Loại' : 'Type'}<select name="type">${each(
      [
        ['all', vi ? 'Tất cả' : 'All'],
        ['page', vi ? 'Trang' : 'Pages'],
        ['post', vi ? 'Bài viết' : 'Posts'],
      ],
      ([type]) => String(type),
      ([type, label]) =>
        html`<option value=${type} selected=${value.type === type ? true : null}>${label}</option>`,
    )}</select></label><button type="submit">${vi ? 'Tìm' : 'Search'}</button></form>${
      !value.query
        ? null
        : value.query.length < 2
          ? html`<p>${vi ? 'Nhập ít nhất 2 ký tự.' : 'Type at least 2 characters.'}</p>`
          : html`<p role="status">${vi ? `${value.total} kết quả` : `${value.total} results`}${
              // A rebuild that has not caught up still answers; the visitor is told it may be short.
              value.stale
                ? vi
                  ? ' · Chỉ mục đang cập nhật, có thể còn thiếu kết quả.'
                  : ' · The index is updating; some results may be missing.'
                : ''
            }</p>${value.entries.length ? entryList(value.entries) : html`<p>${vi ? 'Không tìm thấy kết quả phù hợp.' : 'Nothing matched.'}</p>`}${pager(value.pager, vi)}`
    }</section>`
  // A form's receipt, after the visitor posted: the form's own thanks, the code and the time.
  return html`<section class="wt-public-receipt"><h1>${value.title}</h1><p role="status">${value.message}</p>${
    value.code
      ? html`<dl><dt>${vi ? 'Mã biên nhận' : 'Receipt'}</dt><dd><code>${value.code}</code></dd><dt>${vi ? 'Thời gian gửi' : 'Sent at'}</dt><dd><time datetime=${String(value.createdAt)}>${value.createdLabel}</time></dd></dl>`
      : null
  }<a class="wt-button" href="/">${vi ? 'Về trang chủ' : 'Back to the home page'}</a></section>`
}

// Parent links stay usable; nested lists remain available without client JavaScript.
const navigation = (items: WebsitePublicNavItem[]): TemplateResult =>
  html`<ul>${each(
    items,
    (item) => item.id,
    (item) =>
      html`<li><a href=${item.href}>${item.label}</a>${item.children ? navigation(item.children) : null}</li>`,
  )}</ul>`

/** A visitor's page of a Studio-built site. */
export function websitePublicDocument(p: WebsitePublicPage): TemplateResult {
  const vi = p.locale === 'vi'
  const searchLabel = vi ? 'Tìm kiếm' : 'Search'
  const { head, theme } = p
  // Shared links read Open Graph; a crawler that finds none guesses from the page.
  const openGraph = html`<meta property="og:type" content=${head.ogType}><meta property="og:title" content=${head.title}>${head.description ? html`<meta property="og:description" content=${head.description}>` : null}<meta property="og:site_name" content=${head.siteName}>${head.ogImage ? html`<meta property="og:image" content=${head.ogImage}>` : null}${head.ogUrl ? html`<meta property="og:url" content=${head.ogUrl}>` : null}`
  return html`<html lang=${p.locale}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${head.title}</title>${head.description ? html`<meta name="description" content=${head.description}>` : null}${openGraph}${head.noindex ? html`<meta name="robots" content="noindex">` : null}${head.canonical ? html`<link rel="canonical" href=${head.canonical}>` : null}<link rel="stylesheet" href="/_ket/asset/website_backend/public.css"></head><body class="wt-public"><div class="wt-site" data-website-theme="default" data-theme-preset=${theme.preset} data-accent=${theme.accent} data-font=${theme.font} data-spacing=${theme.spacing} data-buttons=${theme.buttons}><header class="wt-theme-header"><a href="/">${p.brand.logo ? html`<img class="wt-public-logo" src=${p.brand.logo} alt=${p.brand.title}>` : html`<strong>${p.brand.title}</strong>`}</a><nav aria-label=${vi ? 'Điều hướng chính' : 'Main navigation'}>${navigation(p.navigation)}</nav>${p.listing?.kind === 'search' ? null : html`<form class="wt-public-search-box" role="search" action="/search" method="get"><input type="search" name="q" maxlength="100" autocomplete="off" aria-label=${searchLabel} placeholder=${searchLabel}><button type="submit">${vi ? 'Tìm' : 'Search'}</button></form>`}</header><main>${listing(p.listing, vi)}${p.article ? html`<article class="wt-public-post"><h1>${p.article.title}</h1><div data-ui="flow-editor-content">${trustedMarkup(p.article.bodyHtml)}</div></article>` : null}${p.sections}</main><footer class="wt-theme-footer">${p.footer}</footer></div></body></html>`
}

/** The empty page the Studio client mounts into; `props` is its serialized starting state. */
export function websiteStudioDocument(props: string): TemplateResult {
  return html`<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Website · KétSuite</title><link rel="stylesheet" href="/_ket/asset/website_backend/website.css"><script type="module" src="/_ket/asset/website_backend/website.mjs"></script></head><body style="margin:0"><div data-kv-design-system data-theme="light" data-presentation="grouped" data-density="compact"><div id="website-studio" data-props=${props}></div></div></body></html>`
}
