// Rendering targets an abstract host, so one renderer drives a real DOM in the
// browser, a string builder on the server, and a counting mock in tests.
// The counting mock is how "surgical update" stops being a claim and becomes a number.

export type HostNode = {
  id: number
  tag?: string
  attrs?: Record<string, string>
  children?: HostNode[]
  text?: string
  /** Trusted markup in the counting host; real DOM hosts materialise actual nodes. */
  rawHtml?: string
  parent: HostNode | null
}

export type Host = {
  ops: Record<string, number> | null
  createElement(tag: string): HostNode
  createText(value: unknown): HostNode
  setText(node: HostNode, value: unknown): void
  setAttribute(node: HostNode, name: string, value: unknown): void
  insert(parent: HostNode, node: HostNode, before?: HostNode | null): void
  /** Parse compiler-trusted markup and insert every resulting node. */
  insertMarkup(parent: HostNode, html: string, before?: HostNode | null): HostNode[]
  move(parent: HostNode, node: HostNode, before?: HostNode | null): void
  remove(node: HostNode): void
  /** Attach a listener; returns the detach function. */
  listen(node: HostNode, event: string, handler: (e: unknown) => void): () => void
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const NEEDS_ESCAPE = /[&<>"']/
const ESCAPE_ALL = /[&<>"']/g

export const escapeHtml = (s: unknown): string => {
  const str = String(s)
  // Most interpolated values contain nothing to escape, and testing is far cheaper
  // than replacing. The lookup table is hoisted; it used to be rebuilt per character.
  return NEEDS_ESCAPE.test(str) ? str.replace(ESCAPE_ALL, (c) => ESCAPES[c] as string) : str
}

export type CountingHost = Host & {
  ops: Record<string, number>
  fire(node: HostNode, event: string, payload?: unknown): void
  reset(): void
  text(node: HostNode): string
  html(node: HostNode): string
  root(): HostNode
}

export function countingHost(): CountingHost {
  let id = 0
  const ops = {
    createElement: 0,
    createText: 0,
    setText: 0,
    setAttribute: 0,
    insert: 0,
    remove: 0,
    move: 0,
    listen: 0,
  }
  const listeners = new Map<HostNode, Map<string, Set<(e: unknown) => void>>>()

  const detach = (node: HostNode): void => {
    if (!node.parent) return
    const sibs = node.parent.children as HostNode[]
    const i = sibs.indexOf(node)
    if (i >= 0) sibs.splice(i, 1)
    node.parent = null
  }
  const place = (parent: HostNode, node: HostNode, before: HostNode | null | undefined): void => {
    detach(node)
    const sibs = (parent.children ??= [])
    const idx = before ? sibs.indexOf(before) : -1
    if (idx >= 0) sibs.splice(idx, 0, node)
    else sibs.push(node)
    node.parent = parent
  }

  const host: CountingHost = {
    ops,
    reset() {
      for (const k of Object.keys(ops)) ops[k as keyof typeof ops] = 0
    },
    root() {
      return { id: -1, tag: '#root', attrs: {}, children: [], parent: null }
    },
    createElement(tag) {
      ops.createElement++
      return { id: id++, tag, attrs: {}, children: [], parent: null }
    },
    createText(value) {
      ops.createText++
      return { id: id++, text: String(value), parent: null }
    },
    setText(node, value) {
      ops.setText++
      node.text = String(value)
    },
    setAttribute(node, name, value) {
      ops.setAttribute++
      const attrs = (node.attrs ??= {})
      if (value == null || value === false) delete attrs[name]
      else attrs[name] = String(value)
    },
    listen(node, event, handler) {
      ops.listen++
      const byEvent = listeners.get(node) ?? new Map<string, Set<(e: unknown) => void>>()
      listeners.set(node, byEvent)
      const set = byEvent.get(event) ?? new Set<(e: unknown) => void>()
      byEvent.set(event, set)
      set.add(handler)
      return () => {
        set.delete(handler)
      }
    },
    fire(node, event, payload) {
      for (const fn of listeners.get(node)?.get(event) ?? []) fn(payload ?? { type: event })
    },
    insert(parent, node, before = null) {
      ops.insert++
      place(parent, node, before)
    },
    insertMarkup(parent, html, before = null) {
      const node: HostNode = { id: id++, rawHtml: html, parent: null }
      ops.createElement++
      ops.insert++
      place(parent, node, before)
      return [node]
    },
    move(parent, node, before = null) {
      ops.move++
      place(parent, node, before)
    },
    remove(node) {
      ops.remove++
      detach(node)
    },
    text(node) {
      if (node.rawHtml != null) return ''
      return node.text != null ? node.text : (node.children ?? []).map((c) => host.text(c)).join('')
    },
    html(node) {
      if (node.rawHtml != null) return node.rawHtml
      if (node.text != null) return escapeHtml(node.text)
      const attrs = Object.entries(node.attrs ?? {})
        .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
        .join('')
      return `<${node.tag}${attrs}>${(node.children ?? []).map((c) => host.html(c)).join('')}</${node.tag}>`
    },
  }
  return host
}

// The real-DOM host. Everything above is proven against the counting mock, which
// verifies the algorithm; this is what actually runs in a browser.
type DomLike = {
  createElement(tag: string): unknown
  createTextNode(data: string): unknown
  /** Test hosts may supply their small parser instead of implementing <template>. */
  parseHTML?(html: string): { childNodes: Iterable<unknown> }
}

export function domHost(doc: DomLike = (globalThis as { document?: DomLike }).document as DomLike): Host {
  type El = {
    addEventListener(e: string, h: (ev: unknown) => void): void
    removeEventListener(e: string, h: (ev: unknown) => void): void
    setAttribute(n: string, v: string): void
    removeAttribute(n: string): void
    insertBefore(n: unknown, before: unknown): void
    remove(): void
    data: string
  }
  const el = (n: HostNode) => n as unknown as El
  return {
    ops: null,
    createElement: (tag) => doc.createElement(tag) as unknown as HostNode,
    createText: (value) => doc.createTextNode(String(value)) as unknown as HostNode,
    setText: (node, value) => {
      el(node).data = String(value)
    },
    setAttribute: (node, name, value) => {
      if (value == null || value === false) el(node).removeAttribute(name)
      else el(node).setAttribute(name, String(value))
    },
    insert: (parent, node, before = null) => {
      el(parent).insertBefore(node, before)
    },
    insertMarkup: (parent, html, before = null) => {
      let fragment: { childNodes: Iterable<unknown> }
      if (doc.parseHTML) fragment = doc.parseHTML(html)
      else {
        const template = doc.createElement('template') as {
          innerHTML: string
          content: { childNodes: Iterable<unknown> }
        }
        template.innerHTML = html
        fragment = template.content
      }
      const nodes = [...fragment.childNodes] as HostNode[]
      for (const node of nodes) el(parent).insertBefore(node, before)
      return nodes
    },
    move: (parent, node, before = null) => {
      el(parent).insertBefore(node, before)
    },
    remove: (node) => {
      el(node).remove()
    },
    listen: (node, event, handler) => {
      const target = node as unknown as {
        addEventListener(e: string, h: (ev: unknown) => void): void
        removeEventListener(e: string, h: (ev: unknown) => void): void
      }
      target.addEventListener(event, handler)
      return () => target.removeEventListener(event, handler)
    },
  }
}
