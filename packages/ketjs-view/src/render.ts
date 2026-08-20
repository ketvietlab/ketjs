// Surgical rendering: no virtual DOM, no whole-tree diff. A first render walks the
// parsed static structure once to build nodes; every later update writes only to
// the holes whose value actually changed.

import { templateFor } from './template.ts'
import type { TplNode, TplRoot, TplEl } from './template.ts'
import type { Host, HostNode } from './host.ts'
import { HOLE_MARKER, HOLE_OPEN, HydrationMismatch, isMarkup } from './ssr.ts'
import type { Markup } from './ssr.ts'

const RESULT = Symbol('ket.result')
const EACH = Symbol('ket.each')

export type TemplateResult = { [RESULT]: true; strings: readonly string[]; values: unknown[] }
export type EachResult = {
  [EACH]: true
  items: unknown[]
  keyOf: (item: unknown, i: number) => unknown
  render: (item: unknown, i: number) => TemplateResult
}
/** Values the renderer understands without falling back to `[object Object]`. */
export type Renderable = TemplateResult | EachResult | Markup | string | number | boolean | null | undefined

export function html(strings: TemplateStringsArray, ...values: unknown[]): TemplateResult {
  return { [RESULT]: true, strings, values }
}
export const isResult = (v: unknown): v is TemplateResult => !!(v as TemplateResult)?.[RESULT]

export function each<T>(
  items: Iterable<T>,
  keyOf: (item: T, i: number) => unknown,
  render: (item: T, i: number) => TemplateResult,
): EachResult {
  return {
    [EACH]: true,
    items: [...items] as unknown[],
    keyOf: keyOf as EachResult['keyOf'],
    render: render as EachResult['render'],
  }
}
export const isEach = (v: unknown): v is EachResult => !!(v as EachResult)?.[EACH]

export function when(
  cond: unknown,
  render: () => TemplateResult,
  otherwise?: () => TemplateResult,
): TemplateResult | string {
  return cond ? render() : otherwise ? otherwise() : ''
}

type AttrPart = { attr: true; node: HostNode; name: string; last: unknown }
/**
 * An event binding attaches once and reads the current handler through a box, so
 * re-rendering with a fresh closure — which happens on every render — does not
 * detach and re-attach a listener each time.
 */
type EventPart = { event: true; detach: () => void; box: { fn: ((e: unknown) => void) | null } }
type AnyPart = Part | AttrPart | EventPart

export const EVENT_PREFIX = 'on:'
const isEventAttr = (name: string) => name.startsWith(EVENT_PREFIX)

function bindEvent(host: Host, node: HostNode, name: string, initial: unknown): EventPart {
  const box: { fn: ((e: unknown) => void) | null } = {
    fn: typeof initial === 'function' ? (initial as (e: unknown) => void) : null,
  }
  const detach = host.listen(node, name.slice(EVENT_PREFIX.length), (e) => box.fn?.(e))
  return { event: true, detach, box }
}

class Part {
  attr = false as const
  host: Host
  parent: HostNode
  anchor: HostNode
  kind: 'text' | 'result' | 'each' | 'markup' | null = null
  node: HostNode | null = null
  child: Instance | null = null
  keyed: Map<unknown, Instance> | null = null
  keys: unknown[] = []
  markupNodes: HostNode[] = []
  markupHtml = ''

  constructor(host: Host, parent: HostNode, anchor: HostNode) {
    this.host = host
    this.parent = parent
    this.anchor = anchor
  }

  clear(): void {
    if (this.node) {
      this.host.remove(this.node)
      this.node = null
    }
    if (this.child) {
      this.child.remove()
      this.child = null
    }
    if (this.keyed) {
      for (const inst of this.keyed.values()) inst.remove()
      this.keyed = null
      this.keys = []
    }
    for (const node of this.markupNodes) this.host.remove(node)
    this.markupNodes = []
    this.markupHtml = ''
    this.kind = null
  }

  disposeBehavior(): void {
    this.child?.dispose(false)
    if (this.keyed) for (const instance of this.keyed.values()) instance.dispose(false)
  }

  commit(value: unknown): void {
    if (isResult(value)) {
      this.commitResult(value)
      return
    }
    if (isEach(value)) {
      this.commitEach(value)
      return
    }
    if (isMarkup(value)) {
      this.commitMarkup(value.html)
      return
    }
    this.commitText(value)
  }

  commitMarkup(html: string): void {
    if (this.kind === 'markup' && this.markupHtml === html) return
    this.clear()
    this.kind = 'markup'
    this.markupHtml = html
    this.markupNodes = this.host.insertMarkup(this.parent, html, this.anchor)
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
    if (this.kind !== 'each') {
      this.clear()
      this.kind = 'each'
      this.keyed = new Map()
      this.keys = []
    }
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
        if (inst && inst.strings === result.strings) {
          inst.update(result.values)
          continue
        }
        sameOrder = false // a template swapped shape; fall through to the full path
        break
      }
      if (sameOrder) {
        for (let i = 0; i < n; i++) (keyed.get(nextKeys[i]) as Instance).pos = i
        this.keys = nextKeys
        return
      }
    }

    // Where each surviving entry used to sit is carried on the instance itself, so
    // this pass needs no Map — and counting the reused ones tells us whether
    // anything was removed at all, so it needs no Set either. Both used to be built
    // on every reorder of every list, to answer questions the pass already knew.
    const oldIndex: number[] = new Array(n)
    let reused = 0
    for (let i = 0; i < n; i++) {
      const inst = keyed.get(nextKeys[i])
      if (inst && inst.strings === (results[i] as TemplateResult).strings) {
        oldIndex[i] = inst.pos
        reused++
      } else oldIndex[i] = -1
    }

    // Every existing entry accounted for means nothing disappeared; only then is the
    // removal scan worth its own walk over the map.
    if (reused !== keyed.size) {
      const wanted = new Set(nextKeys)
      for (const [k, inst] of keyed) {
        if (!wanted.has(k)) {
          inst.remove()
          keyed.delete(k)
        }
      }
    }

    // Entries in the longest increasing subsequence are already in relative order.
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
        if (stay[i] !== 1) inst.moveBefore(this.parent, nextAnchor)
      } else {
        if (inst) inst.remove()
        inst = new Instance(this.host, result.strings)
        inst.mount(this.parent, nextAnchor)
        inst.update(result.values)
        keyed.set(key, inst)
      }
      ;(inst as Instance).pos = i
      nextAnchor = (inst as Instance).firstNode() ?? nextAnchor
    }
    this.keys = nextKeys
  }
}

// Longest increasing subsequence over positions; -1 marks a brand new entry and can
// never be part of it. Returns a flag per index rather than a Set: the caller reads
// it once per entry, which a typed array does without allocating a hash.
function lisIndices(arr: number[]): Uint8Array {
  const piles: number[] = []
  const parent: number[] = new Array(arr.length).fill(-1)
  const tails: number[] = []
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i] as number
    if (v < 0) continue
    let lo = 0,
      hi = piles.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((arr[piles[mid] as number] as number) < v) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) parent[i] = piles[lo - 1] as number
    piles[lo] = i
    tails[lo] = v
  }
  const out = new Uint8Array(arr.length)
  let k = piles.length ? (piles[piles.length - 1] as number) : -1
  while (k >= 0) {
    out[k] = 1
    k = parent[k] as number
  }
  return out
}

class Instance {
  host: Host
  strings: readonly string[]
  tpl: TplRoot
  parts: Array<AnyPart | undefined> = []
  roots: HostNode[] = []
  values: unknown[] = []
  /** Position among its siblings at the last render, for the reordering pass. */
  pos = -1

  constructor(host: Host, strings: readonly string[]) {
    this.host = host
    this.strings = strings
    this.tpl = templateFor(strings)
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
        if (a.hole == null) {
          this.host.setAttribute(el, a.name, a.value ?? '')
          continue
        }
        this.parts[a.hole] = isEventAttr(a.name)
          ? bindEvent(this.host, el, a.name, undefined)
          : { attr: true, node: el, name: a.name, last: undefined }
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
      if ('event' in p) {
        p.box.fn = typeof v === 'function' ? (v as (e: unknown) => void) : null
        continue
      }
      if (p.attr) {
        if (!Object.is(p.last, v)) {
          this.host.setAttribute(p.node, p.name, v)
          p.last = v
        }
        continue
      }
      if (Object.is(this.values[i], v) && !isResult(v) && !isEach(v)) continue
      p.commit(v)
    }
    this.values = values
  }

  firstNode(): HostNode | null {
    return this.roots[0] ?? null
  }

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
    this.dispose(true)
  }

  dispose(removeNodes: boolean): void {
    for (const p of this.parts) {
      if (!p) continue
      if ('event' in p) {
        p.detach()
        continue
      }
      if (!p.attr) {
        if (removeNodes) (p as Part).clear()
        else (p as Part).disposeBehavior()
      }
    }
    if (removeNodes) {
      for (const n of this.roots) this.host.remove(n)
      this.roots = []
    }
  }
}

export type Root = {
  render(result: TemplateResult): void
  /** Detach behaviour; optionally remove the rendered nodes too. */
  dispose(options?: { remove?: boolean }): void
}

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
    dispose(options = {}) {
      instance?.dispose(options.remove === true)
      instance = null
    },
  }
}

// --- hydration -------------------------------------------------------------
//
// Adopting server-rendered DOM rather than replacing it. The static structure is
// already correct, so the walk only has to locate each hole, claim the marker the
// server left as its anchor, and record what the hole currently holds — otherwise
// the first client update would rebuild instead of patching.

type DomNode = HostNode & {
  nodeType: number
  nodeName: string
  data?: string
  nextSibling: DomNode | null
  firstChild: DomNode | null
}

const ELEMENT = 1,
  TEXT = 3,
  COMMENT = 8

const describe = (n: DomNode | null): string =>
  !n
    ? 'nothing'
    : n.nodeType === COMMENT
      ? `comment "${n.data ?? ''}"`
      : n.nodeType === TEXT
        ? `text "${(n.data ?? '').slice(0, 20)}"`
        : `<${n.nodeName.toLowerCase()}>`

function hydrateInstance(
  host: Host,
  strings: readonly string[],
  values: unknown[],
  parent: DomNode,
  cursor: DomNode | null,
): { instance: Instance; cursor: DomNode | null } {
  const instance = new Instance(host, strings)
  let c = cursor

  const claimValue = (value: unknown, part: Part): void => {
    // Pre-rendered markup: an unknown number of nodes, so the walk cannot
    // count them. It runs to the marker the server left instead — which is
    // why a hole is fenced on both sides rather than only anchored at the end.
    if (isMarkup(value)) {
      part.kind = 'markup'
      while (c && !(c.nodeType === COMMENT && c.data === HOLE_MARKER)) {
        part.markupNodes.push(c)
        c = c.nextSibling
      }
      part.markupHtml = value.html
      return
    }
    if (isResult(value)) {
      const r = hydrateInstance(host, value.strings, value.values, part.parent as DomNode, c)
      part.kind = 'result'
      part.child = r.instance
      c = r.cursor
      return
    }
    if (isEach(value)) {
      part.kind = 'each'
      part.keyed = new Map()
      part.keys = []
      for (let i = 0; i < value.items.length; i++) {
        const item = value.items[i]
        const res = value.render(item, i)
        const r = hydrateInstance(host, res.strings, res.values, part.parent as DomNode, c)
        part.keyed.set(value.keyOf(item, i), r.instance)
        part.keys.push(value.keyOf(item, i))
        c = r.cursor
      }
      return
    }
    if (value == null || value === false) {
      part.kind = null
      return
    }
    if (!c || c.nodeType !== TEXT) throw new HydrationMismatch('a text hole', 'a text node', describe(c))
    part.kind = 'text'
    part.node = c
    c = c.nextSibling
  }

  const walk = (node: TplNode, target: DomNode): void => {
    const atRoot = target === parent
    if (node.type === 'text') {
      if (!c || c.nodeType !== TEXT)
        throw new HydrationMismatch('static text', JSON.stringify(node.value.slice(0, 20)), describe(c))
      if (atRoot) instance.roots.push(c)
      c = c.nextSibling
      return
    }
    if (node.type === 'hole') {
      if (!c || c.nodeType !== COMMENT || c.data !== HOLE_OPEN) {
        throw new HydrationMismatch('the start of a hole', `a <!--${HOLE_OPEN}--> marker`, describe(c))
      }
      const opening = c
      if (atRoot) instance.roots.push(opening)
      c = c.nextSibling
      const part = new Part(host, target, null as unknown as HostNode)
      const startedAt = c
      claimValue(values[node.index], part)
      if (atRoot && startedAt) {
        for (let n: DomNode | null = startedAt; n && n !== c; n = n.nextSibling) instance.roots.push(n)
      }
      if (!c || c.nodeType !== COMMENT || c.data !== HOLE_MARKER) {
        throw new HydrationMismatch('a hole', `a <!--${HOLE_MARKER}--> marker`, describe(c))
      }
      part.anchor = c
      if (atRoot) instance.roots.push(c)
      instance.parts[node.index] = part
      c = c.nextSibling
      return
    }
    const el = node as TplEl
    if (!c || c.nodeType !== ELEMENT || c.nodeName.toLowerCase() !== el.tag) {
      throw new HydrationMismatch('an element', `<${el.tag}>`, describe(c))
    }
    const element = c
    if (atRoot) instance.roots.push(element)
    for (const a of el.attrs) {
      if (a.hole == null) continue
      // The server never rendered a handler, so hydration is where it first attaches.
      instance.parts[a.hole] = isEventAttr(a.name)
        ? bindEvent(host, element, a.name, values[a.hole])
        : { attr: true, node: element, name: a.name, last: values[a.hole] }
    }
    const after = element.nextSibling
    c = element.firstChild
    for (const child of el.children) walk(child, element)
    c = after
  }

  for (const n of instance.tpl.children) walk(n, parent)
  instance.values = values
  return { instance, cursor: c }
}

/**
 * Attach to server-rendered markup. On a mismatch it throws rather than silently
 * patching over a difference, because a hydration that half-works is worse than one
 * that fails loudly: the caller can fall back to a clean client render.
 */
export function hydrateRoot(host: Host, container: HostNode, result: TemplateResult): Root {
  const { instance: hydrated } = hydrateInstance(
    host,
    result.strings,
    result.values,
    container as DomNode,
    (container as DomNode).firstChild,
  )
  let instance: Instance | null = hydrated
  return {
    render(next) {
      if (!instance || instance.strings !== next.strings) {
        instance?.remove()
        instance = new Instance(host, next.strings)
        instance.mount(container, null)
      }
      instance.update(next.values)
    },
    dispose(options = {}) {
      instance?.dispose(options.remove === true)
      instance = null
    },
  }
}
