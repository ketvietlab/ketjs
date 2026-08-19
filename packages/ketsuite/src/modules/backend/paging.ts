// Reading a list's state out of the URL, and writing it back.
//
// The URL is the state. Not a store, not a hook, not a component that has to be
// told what page it is on — a query string the server reads and the browser
// remembers. That is what makes the back button, a bookmark and a link somebody
// pastes into chat all work with no code written for any of them.

import type { Pager } from './screens.ts'

/** Odoo's default, and about as many rows as fit a laptop screen. */
export const PAGE_SIZE = 30

export const pageOf = (url: URL): number => {
  const n = Number(url.searchParams.get('page') ?? '1')
  return Number.isInteger(n) && n > 0 ? n : 1
}

export const searchOf = (url: URL): string | undefined => {
  const q = url.searchParams.get('q')?.trim()
  return q ? q : undefined
}

/** Which optional columns this viewer asked for: ?cols=id,category. */
export const colsOf = (url: URL): string[] =>
  (url.searchParams.get('cols') ?? '').split(',').map(s => s.trim()).filter(Boolean)

/** Where a column-menu entry points: the same list showing a different set. */
export const colsHref = (url: URL) => (keys: readonly string[]): string =>
  withParam(url, 'cols', keys.length ? [...keys].join(',') : null, false)

/**
 * The same URL with one parameter changed.
 *
 * Page resets by default, because a new filter on page three shows an empty page
 * three. Showing one more column is not a new filter, so that passes false.
 */
export const withParam = (url: URL, key: string, value: string | null, resetPage = true): string => {
  const next = new URL(url.href)
  if (value === null) next.searchParams.delete(key)
  else next.searchParams.set(key, value)
  if (resetPage && key !== 'page') next.searchParams.delete('page')
  return next.pathname + (next.search || '')
}

/**
 * The "1-30 / 84" and its arrows. Null when everything fits on one page: a pager
 * that can only ever say "1-3 / 3" is furniture.
 */
export const pager = (url: URL, page: number, shown: number, total: number): Pager | null => {
  if (total <= PAGE_SIZE) return null
  const from = (page - 1) * PAGE_SIZE + 1
  return {
    from, to: from + shown - 1, total,
    prev: page > 1 ? withParam(url, 'page', String(page - 1)) : null,
    next: from + shown - 1 < total ? withParam(url, 'page', String(page + 1)) : null,
  }
}
