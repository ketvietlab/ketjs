import type { Pager } from './chrome.tsx'

export const COLLECTION_PAGE_SIZE = 30

/** Only use with a complete authorized, already-filtered collection. */
export const paginateCollectionRows = <R>(url: URL, rows: readonly R[]) => {
  const requested = Number(url.searchParams.get('page') ?? 1)
  const page = Math.min(
    Number.isSafeInteger(requested) && requested > 0 ? requested : 1,
    Math.max(1, Math.ceil(rows.length / COLLECTION_PAGE_SIZE)),
  )
  const offset = (page - 1) * COLLECTION_PAGE_SIZE
  const pageHref = (value: number): string => {
    const next = new URL(url)
    next.searchParams.set('page', String(value))
    return next.pathname + next.search
  }
  const selected = rows.slice(offset, offset + COLLECTION_PAGE_SIZE)
  const pager: Pager = {
    from: rows.length ? offset + 1 : 0,
    to: offset + selected.length,
    total: rows.length,
    prev: page > 1 ? pageHref(page - 1) : null,
    next: offset + selected.length < rows.length ? pageHref(page + 1) : null,
  }
  return { rows: selected, pager, total: rows.length, page }
}

export const collectionQueryKeep = (url: URL, excluded: readonly string[] = []) => {
  const keep: Record<string, string | string[]> = {}
  const transient = new Set([
    'page',
    'record',
    'create',
    'edit',
    'dialog',
    'invalid',
    'close',
    'carryKey',
    ...excluded,
  ])
  if (url.searchParams.has('record')) transient.add('tab')
  for (const key of new Set(url.searchParams.keys())) {
    if (transient.has(key)) continue
    const values = url.searchParams.getAll(key)
    keep[key] = values.length === 1 ? values[0]! : values
  }
  return keep
}
