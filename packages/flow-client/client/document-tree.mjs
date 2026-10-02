export const sameDocumentLevel = (a, b) =>
  (a.parentId ?? null) === (b.parentId ?? null) &&
  a.projectId === b.projectId &&
  (a.visibility ?? 'shared') === (b.visibility ?? 'shared')
export const documentSiblings = (pages, page) =>
  pages.filter((p) => !p.archived && sameDocumentLevel(p, page))
// Keep matching pages attached to their ancestors; filtering never flattens the tree.
export function filterDocumentTree(pages, matches) {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const keep = new Set()
  for (const page of pages.filter(matches)) {
    let current = page
    const visited = new Set()
    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      keep.add(current.id)
      current = byId.get(current.parentId)
    }
  }
  return pages.filter((p) => keep.has(p.id))
}
