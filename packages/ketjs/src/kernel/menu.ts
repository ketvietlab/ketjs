// The navigation tree, as one viewer sees it.
//
// Two filters, applied in this order: what the deployment composes and what this
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
  /**
   * True when this viewer may open the entry but the entry is not their work.
   * The shell leaves these out of the main list; search still finds them.
   */
  secondary: boolean
  children: MenuNode[]
}

export type MenuOptions = {
  /** Function keys this viewer may call. Null means unrestricted. */
  allow?: readonly string[] | null
  /** Resolves a label. Given a key it does not know, it should return it unchanged. */
  translate?: (key: string) => string
  /** The locale the labels come back in, so equal sequences sort the way it reads. */
  locale?: string
  /** The path currently showing, used to mark the branch leading to it. */
  active?: string
  /**
   * Narrow the tree to what matches. A heading survives if anything under it
   * does, so filtering never orphans a leaf from the words above it.
   */
  q?: string
  /**
   * Mark entries this viewer may open but does not work on. Off by default:
   * a caller that does not ask for the distinction gets the tree it always got.
   *
   * A viewer nothing is primary for keeps the whole permitted tree. An empty
   * sidebar reads as a broken deployment, and telling a night auditor their
   * work is nowhere is worse than showing them one screen too many.
   */
  intent?: boolean
  /**
   * The deployment's own grouping, applied before anything else is decided.
   *
   * Named entries move under the declared heading; the rest keep the heading
   * their module gave them. A heading whose entries are all filtered away
   * disappears like any other empty heading.
   */
  groups?: ReadonlyArray<{ id: string; label: string; icon?: string; items: readonly string[] }>
  /** Menu ids to keep out of the main list whatever `for` says. */
  demote?: readonly string[]
}

/**
 * The menu as this deployment arranges it.
 *
 * Regrouping happens on the declarations rather than on the built tree, so
 * permission, intent, search and active-branch logic all keep working on one
 * shape. A group inherits its position from the first entry it claims, which
 * keeps a regrouped sidebar in the order the module authors already thought
 * about rather than in declaration order.
 */
const regrouped = (
  manifest: Manifest,
  groups: MenuOptions['groups'],
): Array<[string, MenuDef & { by: string }]> => {
  const entries = Object.entries(manifest.menus)
  if (!groups?.length) return entries

  const claimed = new Map<string, { id: string; label: string; icon?: string; order: number }>()
  for (const [index, group] of groups.entries())
    for (const item of group.items)
      claimed.set(item, { id: group.id, label: group.label, icon: group.icon, order: index })

  const byId = new Map(entries)
  const sequenceOf = (group: string): number => {
    const owned = [...claimed.entries()]
      .filter(([, g]) => g.id === group)
      .map(([item]) => byId.get(item)?.sequence ?? 100)
    return owned.length ? Math.min(...owned) : 100
  }

  const out: Array<[string, MenuDef & { by: string }]> = []
  const seen = new Set<string>()
  for (const [id, def] of entries) {
    const group = claimed.get(id)
    if (!group) {
      out.push([id, def])
      continue
    }
    if (!seen.has(group.id)) {
      seen.add(group.id)
      out.push([
        group.id,
        {
          by: def.by,
          label: group.label,
          ...(group.icon ? { icon: group.icon } : {}),
          // The declared group stands where the module's heading stood, so a
          // regrouped sidebar sits at the same level as the one it replaces.
          // An entry hanging straight off a root has no heading to replace, and
          // the group becomes that root's first heading instead.
          parent: def.parent ? (byId.get(def.parent)?.parent ?? def.parent) : undefined,
          sequence: sequenceOf(group.id),
        } as MenuDef & { by: string },
      ])
    }
    out.push([id, { ...def, parent: group.id }])
  }
  return out
}

export function buildMenu(manifest: Manifest, o: MenuOptions = {}): MenuNode[] {
  const entries = regrouped(manifest, o.groups)
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

  // `for` is about this viewer, not about this build: an entry naming a write
  // the deployment does not compose is a declaration to fix, not a reason to
  // demote the entry for everyone.
  const demoted = new Set(o.demote ?? [])
  let applyIntent = o.intent === true
  const intended = (id: string, def: MenuDef): boolean =>
    !applyIntent ||
    (!demoted.has(id) && (!def.for?.length || def.for.some((key) => !o.allow || o.allow.includes(key))))

  const label = (def: MenuDef & { by: string }): string => {
    const key = `${def.by}.${def.label}`
    const out = o.translate?.(key)
    // A translator that does not know the key hands it back; a module that wrote a
    // literal rather than a key gets the literal.
    return out && out !== key ? out : (o.translate?.(def.label) ?? def.label)
  }

  /**
   * Sequence first, then the words the reader actually sees.
   *
   * The tie-break used to compare `def.label`, which is the message *key*: every
   * root often declares the same `menu.app` key, so equal sequences compared equal
   * and the sidebar fell back to the order modules happened to be registered in.
   * Below a heading it was worse — an untranslated key sorts in English, so the
   * Vietnamese Purchasing menu read Đơn mua · RFQ · Bảng giá because `orders` <
   * `rfqs` < `vendorPricelists`. Comparing the translation puts a Vietnamese menu
   * in Vietnamese order, and `sequence` remains the way to say what you mean.
   */
  const order = (a: [string, MenuDef & { by: string }], b: [string, MenuDef & { by: string }]): number =>
    (a[1].sequence ?? 100) - (b[1].sequence ?? 100) || label(a[1]).localeCompare(label(b[1]), o.locale)

  const needle = o.q?.trim().toLocaleLowerCase('vi') ?? ''
  const matches = (text: string): boolean => !needle || text.toLocaleLowerCase('vi').includes(needle)
  const activePath = o.active
    ? entries
        .map(([, def]) => def.path)
        .filter(
          (path): path is string =>
            !!path && (o.active === path || o.active!.startsWith(`${path.replace(/\/$/, '')}/`)),
        )
        .sort((a, b) => b.length - a.length)[0]
    : undefined

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
      const active = (def.path !== undefined && def.path === activePath) || children.some((c) => c.active)
      // A heading is secondary only when everything under it is: a group holding
      // one entry that is someone's work still belongs in their sidebar.
      const secondary = children.length ? children.every((c) => c.secondary) : !intended(id, def)
      out.push({
        id,
        label: label(def),
        path: def.path ?? null,
        icon: def.icon ?? null,
        active,
        secondary,
        children,
      })
    }
    return out
  }

  const tree = build(undefined, 0)
  // Nobody gets an empty sidebar. If no entry claims this viewer, the distinction
  // told us nothing about them and the permitted tree is the honest answer.
  const anyPrimary = (nodes: MenuNode[]): boolean =>
    nodes.some((node) => !node.secondary || anyPrimary(node.children))
  if (!applyIntent || anyPrimary(tree)) return tree
  applyIntent = false
  return build(undefined, 0)
}

/** The root navigation section a path belongs to. */
export function activeMenuRoot(tree: MenuNode[]): MenuNode | null {
  return tree.find((n) => n.active) ?? null
}
