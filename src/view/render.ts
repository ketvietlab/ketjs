// Surgical rendering: no virtual DOM, no whole-tree diff. A first render walks the
// parsed static structure once to build nodes; every later update writes only to
// the holes whose value actually changed.

import { templateFor } from './template.ts'
import type { TplNode, TplRoot, TplEl } from './template.ts'
import type { Host, HostNode } from './host.ts'

const RESULT = Symbol('ket.result')
const EACH = Symbol('ket.each')

export type TemplateResult = { [RESULT]: true; strings: readonly string[]; values: unknown[] }
export type EachResult = { [EACH]: true; items: unknown[]; keyOf: (item: unknown, i: number) => unknown; render: (item: unknown, i: number) => TemplateResult }

export function html(strings: TemplateStringsArray, ...values: unknown[]): TemplateResult {
  return { [RESULT]: true, strings, values }
}
export const isResult = (v: unknown): v is TemplateResult => !!(v as TemplateResult)?.[RESULT]

export function each<T>(items: Iterable<T>, keyOf: (item: T, i: number) => unknown, render: (item: T, i: number) => TemplateResult): EachResult {
  return { [EACH]: true, items: [...items] as unknown[], keyOf: keyOf as EachResult['keyOf'], render: render as EachResult['render'] }
}
export const isEach = (v: unknown): v is EachResult => !!(v as EachResult)?.[EACH]

export function when(cond: unknown, render: () => TemplateResult, otherwise?: () => TemplateResult): TemplateResult | string {
  return cond ? render() : (otherwise ? otherwise() : '')
}

type AttrPart = { attr: true; node: HostNode; name: string; last: unknown }
type AnyPart = Part | AttrPart

class Part {
  attr = false as const
  host: Host
  parent: HostNode
  anchor: HostNode
  kind: 'text' | 'result' | 'each' | null = null
  node: HostNode | null = null
  child: Instance | null = null
  keyed: Map<unknown, Instance> | null = null
  keys: unknown[] = []

  constructor(host: Host, parent: HostNode, anchor: HostNode) {
    this.host = host; this.parent = parent; this.anchor = anchor
  }

  clear(): void {
    if (this.node) { this.host.remove(this.node); this.node = null }
    if (this.child) { this.child.remove(); this.child = null }
    if (this.keyed) { for (const inst of this.keyed.values()) inst.remove(); this.keyed = null; this.keys = [] }
    this.kind = null
  }

  commit(value: unknown): void {
    if (isResult(value)) return this.commitResult(value)
    if (isEach(value)) return this.commitEach(value)
    return this.commitText(value)
  }

  commitText(value: unknown): void {
    const str = value == null || value === false ? '' : String(value)
    if (this.kind === 'text' && this.node) {
      if (this.node.text !== str) this.host.setText(this.node, str)
      return
    }
    this.clear()
    this.kind = 'text'
    this.node = this.host.createText(str)
    this.host.insert(this.parent, this.node, this.anchor)
  }

  commitResult(result: TemplateResult): void {
    if (this.kind === 'result' && this.child && this.child.strings === result.strings) {
      this.child.update(result.values)
      return
    }
    this.clear()
    this.kind = 'result'
    this.child = new Instance(this.host, result.strings)
    this.child.mount(this.parent, this.anchor)
    this.child.update(result.values)
  }

  // Keyed list reconciliation.
  //
  // Removals happen first so stale nodes never poison the sibling chain, then a
  // longest-increasing-subsequence over the surviving order decides which entries
  // are already in relative order. Only entries outside that subsequence move, so
  // a swap costs one move rather than cascading through the whole list.
  commitEach(list: EachResult): void {
    if (this.kind !== 'each') { this.clear(); this.kind = 'each'; this.keyed = new Map(); this.keys = [] }
    const keyed = this.keyed as Map<unknown, Instance>
    const prevKeys = this.keys

    const n = list.items.length
    const nextKeys: unknown[] = new Array(n)
    const results: TemplateResult[] = new Array(n)
    // Same length and same keys in the same places is by far the most common
    // render: a value changed, nothing moved. Detecting it here skips the Set, the
    // Map, the LIS and the anchor walk below — six N-sized structures that existed
    // only to answer a question already answered.
    let sameOrder = prevKeys.length === n
    for (let i = 0; i < n; i++) {
      const key = list.keyOf(list.items[i], i)
      nextKeys[i] = key
      results[i] = list.render(list.items[i], i)
      if (sameOrder && prevKeys[i] !== key) sameOrder = false
    }

    if (sameOrder) {
      for (let i = 0; i < n; i++) {
        const inst = keyed.get(nextKeys[i])
        const result = results[i] as TemplateResult
        if (inst && inst.strings === result.strings) { inst.update(result.values); continue }
        sameOrder = false     // a template swapped shape; fall through to the full path
        break
      }
      if (sameOrder) { this.keys = nextKeys; return }
    }

    // 1. drop what disappeared, before anything is measured or moved
    const wanted = new Set(nextKeys)
    for (const [k, inst] of keyed) {
      if (!wanted.has(k)) { inst.remove(); keyed.delete(k) }
    }

    // 2. where each surviving entry used to sit
    const prevPos = new Map<unknown, number>()
    let live = 0
    for (const k of prevKeys) if (keyed.has(k)) prevPos.set(k, live++)

    // The index is already in hand here. Looking it up with indexOf made this
    // quadratic — a million comparisons per render of a thousand rows, and the
    // reason an unchanged re-render still cost half a millisecond.
    const oldIndex: number[] = nextKeys.map((k, i) => {
      const inst = keyed.get(k)
      if (!inst) return -1
      return inst.strings === (results[i] as TemplateResult).strings ? (prevPos.get(k) ?? -1) : -1
    })

    // 3. entries in the longest increasing subsequence are already in order
    const stay = lisIndices(oldIndex)

    // 4. one back-to-front pass: only entries outside the subsequence touch the host
    let nextAnchor: HostNode = this.anchor
    for (let i = nextKeys.length - 1; i >= 0; i--) {
      const key = nextKeys[i]
      const result = results[i] as TemplateResult
      let inst = keyed.get(key)
      const reusable = !!inst && inst.strings === result.strings

      if (reusable && inst) {
        inst.update(result.values)
        if (!stay.has(i)) inst.moveBefore(this.parent, nextAnchor)
      } else {
        if (inst) inst.remove()
        inst = new Instance(this.host, result.strings)
        inst.mount(this.parent, nextAnchor)
        inst.update(result.values)
        keyed.set(key, inst)
      }
      nextAnchor = (inst as Instance).firstNode() ?? nextAnchor
    }
    this.keys = nextKeys
  }
}

// Longest increasing subsequence over positions; -1 marks a brand new entry and
// can never be part of it. Returns the set of *new-list* indices that may stay put.
function lisIndices(arr: number[]): Set<number> {
  const piles: number[] = []
  const parent: number[] = new Array(arr.length).fill(-1)
  const tails: number[] = []
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i] as number
    if (v < 0) continue
    let lo = 0, hi = piles.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((arr[piles[mid] as number] as number) < v) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) parent[i] = piles[lo - 1] as number
    piles[lo] = i
    tails[lo] = v
  }
  const out = new Set<number>()
  let k = piles.length ? (piles[piles.length - 1] as number) : -1
  while (k >= 0) { out.add(k); k = parent[k] as number }
  return out
}

class Instance {
  host: Host
  strings: readonly string[]
  tpl: TplRoot
  parts: Array<AnyPart | undefined> = []
  roots: HostNode[] = []
  values: unknown[] = []

  constructor(host: Host, strings: readonly string[]) {
    this.host = host; this.strings = strings; this.tpl = templateFor(strings)
  }

  mount(parent: HostNode, anchor: HostNode | null): void {
    const build = (node: TplNode, target: HostNode): void => {
      const atRoot = target === parent
      if (node.type === 'text') {
        const t = this.host.createText(node.value)
        this.host.insert(target, t, atRoot ? anchor : null)
        if (atRoot) this.roots.push(t)
        return
      }
      if (node.type === 'hole') {
        const marker = this.host.createText('')
        this.host.insert(target, marker, atRoot ? anchor : null)
        if (atRoot) this.roots.push(marker)
        this.parts[node.index] = new Part(this.host, target, marker)
        return
      }
      const el = this.host.createElement((node as TplEl).tag)
      for (const a of (node as TplEl).attrs) {
        if (a.hole != null) this.parts[a.hole] = { attr: true, node: el, name: a.name, last: undefined }
        else this.host.setAttribute(el, a.name, a.value ?? '')
      }
      this.host.insert(target, el, atRoot ? anchor : null)
      if (atRoot) this.roots.push(el)
      for (const c of (node as TplEl).children) build(c, el)
    }
    for (const n of this.tpl.children) build(n, parent)
  }

  update(values: unknown[]): void {
    for (let i = 0; i < values.length; i++) {
      const p = this.parts[i]
      if (!p) continue
      const v = values[i]
      if (p.attr) {
        if (!Object.is(p.last, v)) { this.host.setAttribute(p.node, p.name, v); p.last = v }
        continue
      }
      if (Object.is(this.values[i], v) && !isResult(v) && !isEach(v)) continue
      p.commit(v)
    }
    this.values = values
  }

  firstNode(): HostNode | null { return this.roots[0] ?? null }

  nextSibling(): HostNode | null {
    const last = this.roots[this.roots.length - 1]
    if (!last) return null
    // A real DOM node knows its own neighbour; the counting mock keeps an array.
    const native = (last as unknown as { nextSibling?: HostNode | null }).nextSibling
    if (native !== undefined) return native ?? null
    if (!last.parent) return null
    const sibs = last.parent.children ?? []
    return sibs[sibs.indexOf(last) + 1] ?? null
  }

  moveBefore(parent: HostNode, anchor: HostNode | null): void {
    for (const n of this.roots) this.host.move(parent, n, anchor)
  }

  remove(): void {
    for (const p of this.parts) if (p && !p.attr) (p as Part).clear()
    for (const n of this.roots) this.host.remove(n)
    this.roots = []
  }
}

export type Root = { render(result: TemplateResult): void }

export function createRoot(host: Host, container: HostNode): Root {
  let instance: Instance | null = null
  return {
    render(result) {
      if (!instance || instance.strings !== result.strings) {
        instance?.remove()
        instance = new Instance(host, result.strings)
        instance.mount(container, null)
      }
      instance.update(result.values)
    },
  }
}
