import type { Frame } from '../../ui/index.ts'

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
    chrome: {
      ...frame.chrome,
      search: { name: 'q', value: url.searchParams.get('q') ?? '', placeholder, keep },
    },
  }
}
