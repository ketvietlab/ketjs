// The navigation tree, as one viewer sees it.
//
// Three filters, applied in this order, because each depends on the one before:
// what the deployment ships, what this database has switched on, and what this
// viewer may call. The last is the one that matters most — a menu offering what it
// cannot deliver is a menu that lies, and the 401 arrives after the click rather
// than instead of it.
//
// A heading with nothing left under it disappears with its children. An empty
// section is worse than a missing one: it reads as "this is broken" rather than
// "this is not for you".

import type { Manifest, MenuDef } from '../types.ts'

export type MenuNode = {
  id: string
  label: string
  path: string | null
  icon: string | null
  /** True for the node whose path is showing, and for every heading above it. */
  active: boolean
  children: MenuNode[]
}

export type MenuOptions = {
  /** Function keys this viewer may call. Null means unrestricted. */
  allow?: readonly string[] | null
  /** Resolves a label. Given a key it does not know, it should return it unchanged. */
  translate?: (key: string) => string
  /** The path currently showing, used to mark the branch leading to it. */
  active?: string
  /**
   * Narrow the tree to what matches. A heading survives if anything under it
   * does, so filtering never orphans a leaf from the words above it.
   */
  q?: string
}

const order = (a: [string, MenuDef & { by: string }], b: [string, MenuDef & { by: string }]): number =>
  (a[1].sequence ?? 100) - (b[1].sequence ?? 100) || a[1].label.localeCompare(b[1].label)

export function buildMenu(manifest: Manifest, o: MenuOptions = {}): MenuNode[] {
  const entries = Object.entries(manifest.menus)
  const byParent = new Map<string | undefined, Array<[string, MenuDef & { by: string }]>>()
  for (const e of entries) {
    const list = byParent.get(e[1].parent) ?? []
    list.push(e)
    byParent.set(e[1].parent, list)
  }

  // Two reasons an entry does not appear: the function it leads to is not in this
  // build at all, or it is and this viewer may not call it.
  const permitted = (def: MenuDef): boolean =>
    !def.needs || (!!manifest.functions[def.needs] && (!o.allow || o.allow.includes(def.needs)))

  const label = (def: MenuDef & { by: string }): string => {
    const key = `${def.by}.${def.label}`
    const out = o.translate?.(key)
    // A translator that does not know the key hands it back; a module that wrote a
    // literal rather than a key gets the literal.
    return out && out !== key ? out : (o.translate?.(def.label) ?? def.label)
  }

  const needle = o.q?.trim().toLocaleLowerCase('vi') ?? ''
  const matches = (text: string): boolean => !needle || text.toLocaleLowerCase('vi').includes(needle)

  const build = (parent: string | undefined, depth: number): MenuNode[] => {
    if (depth > 8) return [] // a cycle would otherwise recurse forever
    const out: MenuNode[] = []
    for (const [id, def] of (byParent.get(parent) ?? []).sort(order)) {
      if (!permitted(def)) continue
      const children = build(id, depth + 1)
      // A heading is only worth showing if something is under it.
      if (!def.path && !children.length) continue
      // A search keeps a branch that matches anywhere along it, so a leaf never
      // arrives without the words that explain where it lives.
      if (needle && !children.length && !matches(label(def))) continue
      const active = (def.path !== undefined && def.path === o.active) || children.some((c) => c.active)
      out.push({ id, label: label(def), path: def.path ?? null, icon: def.icon ?? null, active, children })
    }
    return out
  }

  return build(undefined, 0)
}

/** The app a path belongs to: the root whose branch contains it. */
export function activeApp(tree: MenuNode[]): MenuNode | null {
  return tree.find((n) => n.active) ?? null
}
