export type SearchItem = { title: string; description: string; route: string; keywords: string }

export function searchItems(items: SearchItem[], input: string): SearchItem[] {
  const query = input.trim().toLowerCase()
  const rank = (item: SearchItem) => {
    if (!query) return 0
    const title = item.title.toLowerCase()
    return title === query ? 3 : title.startsWith(query) ? 2 : title.includes(query) ? 1 : 0
  }
  return items
    .filter(
      (item) => !query || `${item.title} ${item.description} ${item.keywords}`.toLowerCase().includes(query),
    )
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, 8)
}
