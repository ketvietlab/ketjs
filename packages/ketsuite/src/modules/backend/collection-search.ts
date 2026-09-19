import type { Frame } from '../../ui/index.ts'
export { paginateCollectionRows, collectionQueryKeep } from '../../ui/collection-state.ts'

/** Search complete, authorised collections using the same text the reader sees. */
export const searchCollectionRows = <R>(url: URL, rows: R[], text: (row: R) => string): R[] => {
  const query = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase()
  return query ? rows.filter((row) => text(row).toLocaleLowerCase().includes(query)) : rows
}

/** GET search preserves collection filters and locale, and dismisses transient forms. */
export const collectionSearchFrame = (url: URL, frame: Frame, placeholder: string): Frame => {
  const keep: Record<string, string | string[]> = {}
  for (const key of new Set(url.searchParams.keys())) {
    if (['q', 'page', 'create', 'edit', 'invalid', 'dialog', 'close', 'carryKey', 'record'].includes(key))
      continue
    if (key === 'tab' && url.searchParams.has('record')) continue
    const values = url.searchParams.getAll(key)
    keep[key] = values.length === 1 ? values[0]! : values
  }
  return {
    ...frame,
    collectionUrl: url.pathname + url.search,
    chrome: {
      ...frame.chrome,
      search: { name: 'q', value: url.searchParams.get('q') ?? '', placeholder, keep },
    },
  }
}

/**
 * Read a complete authorized collection from a bounded API before local search,
 * grouping or pagination. The caller keeps filters and stable ordering identical
 * for every batch and chooses a size the source supports without truncation.
 */
export const loadCollectionRows = async <R>(
  load: (page: { limit: number; offset: number }) => Promise<R[]>,
  batchSize = 500,
): Promise<R[]> => {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1)
    throw new RangeError('Collection batch size must be a positive safe integer')
  const rows: R[] = []
  for (;;) {
    const batch = await load({ limit: batchSize, offset: rows.length })
    rows.push(...batch)
    if (batch.length < batchSize) return rows
  }
}
