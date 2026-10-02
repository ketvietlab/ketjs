import { menuTree } from './content-schema.ts'
import type { MenuNode } from './content-schema.ts'
import type { MenuItem } from './types.ts'

export type MenuRow = MenuItem & { depth: number }
export type MenuPlacement = 'before' | 'after' | 'inside'

export function flattenMenu(items: readonly MenuItem[]): MenuRow[] {
  const flat: MenuRow[] = []
  const walk = (nodes: MenuNode[], depth: number) => {
    for (const node of nodes) {
      const { children, ...item } = node
      flat.push({ ...item, depth })
      walk(children, depth + 1)
    }
  }
  walk(menuTree(items), 0)
  return flat
}
export function menuBranch(items: readonly MenuItem[], id: string): Set<string | null> {
  const ids = new Set<string | null>([id])
  let changed = true
  while (changed) {
    changed = false
    for (const item of items)
      if (ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id)
        changed = true
      }
  }
  return ids
}
// A move always carries descendants. A destination inside the source branch is invalid.
export function moveMenu(
  items: MenuItem[],
  id: string,
  targetId: string,
  placement: MenuPlacement = 'before',
): MenuItem[] {
  const rows = flattenMenu(items)
  const source = rows.find((item) => item.id === id)
  const target = rows.find((item) => item.id === targetId)
  const branch = menuBranch(items, id)
  if (!source || !target || branch.has(targetId)) return items
  const moving = rows.filter((item) => branch.has(item.id))
  const remaining = rows.filter((item) => !branch.has(item.id))
  moving[0] = { ...moving[0], parentId: placement === 'inside' ? target.id : target.parentId }
  let index = remaining.findIndex((item) => item.id === targetId)
  if (placement !== 'before') {
    const targetBranch = menuBranch(remaining, targetId)
    while (index < remaining.length && targetBranch.has(remaining[index].id)) index++
  }
  remaining.splice(index, 0, ...moving)
  return remaining.map(({ depth: _depth, ...item }, position) => ({ ...item, position }))
}
export function stepMenu(items: MenuItem[], id: string, direction: 'up' | 'down' | 'in' | 'out'): MenuItem[] {
  const rows = flattenMenu(items)
  const item = rows.find((row) => row.id === id)
  if (!item) return items
  const siblings = rows.filter((row) => (row.parentId || null) === (item.parentId || null))
  const index = siblings.findIndex((row) => row.id === id)
  if (direction === 'out') return item.parentId ? moveMenu(items, id, item.parentId, 'after') : items
  if (direction === 'in') return index > 0 ? moveMenu(items, id, siblings[index - 1].id, 'inside') : items
  const target = siblings[index + (direction === 'up' ? -1 : 1)]
  return target ? moveMenu(items, id, target.id, direction === 'up' ? 'before' : 'after') : items
}
export function removeMenuItem(items: readonly MenuItem[], id: string): MenuItem[] {
  const parent = items.find((item) => item.id === id)?.parentId ?? null
  return items
    .filter((item) => item.id !== id)
    .map((item, position) => ({
      ...item,
      parentId: item.parentId === id ? parent : item.parentId,
      position,
    }))
}

// Horizontal movement changes hierarchy in 24px steps, including a drag over the source row.
export function planMenuDrop(
  items: readonly MenuItem[],
  id: string,
  targetId: string,
  placement: MenuPlacement,
  deltaX: number,
): { targetId: string; placement: MenuPlacement; label: string } | null {
  const rows = flattenMenu(items)
  const source = rows.find((row) => row.id === id)
  let target = rows.find((row) => row.id === targetId)
  if (!source || !target) return null
  const levels = Math.trunc(deltaX / 24)
  if (id === targetId) {
    if (levels > 0) {
      const siblings = rows.filter((row) => (row.parentId || null) === (source.parentId || null))
      target = siblings[siblings.findIndex((row) => row.id === id) - 1]
      if (!target) return null
      placement = 'inside'
    } else if (levels < 0) {
      if (!target.parentId) return null
      for (let step = 0; step < -levels && target.parentId; step++) {
        const parentId: string = target.parentId
        target = rows.find((row) => row.id === parentId)!
      }
      placement = 'after'
    } else return null
  } else if (levels > 0) {
    placement = 'inside'
  } else if (levels < 0) {
    for (let step = 0; step < -levels && target.parentId; step++) {
      const parentId: string = target.parentId
      target = rows.find((row) => row.id === parentId)!
    }
    placement = placement === 'before' ? 'before' : 'after'
  }
  if (menuBranch(items, id).has(target.id)) return null
  return { targetId: target.id, placement, label: target.label }
}
