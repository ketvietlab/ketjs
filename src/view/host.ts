// Rendering targets an abstract host, so one renderer drives a real DOM in the
// browser, a string builder on the server, and a counting mock in tests.
// The counting mock is how "surgical update" stops being a claim and becomes a number.

export type HostNode = { id: number; tag?: string; attrs?: Record<string, string>; children?: HostNode[]; text?: string; parent: HostNode | null }

export type Host = {
  ops: Record<string, number> | null
  createElement(tag: string): HostNode
  createText(value: unknown): HostNode
  setText(node: HostNode, value: unknown): void
  setAttribute(node: HostNode, name: string, value: unknown): void
  insert(parent: HostNode, node: HostNode, before?: HostNode | null): void
  move(parent: HostNode, node: HostNode, before?: HostNode | null): void
  remove(node: HostNode): void
}

export const escapeHtml = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

export type CountingHost = Host & {
  ops: Record<string, number>
  reset(): void
  text(node: HostNode): string
  html(node: HostNode): string
  root(): HostNode
}

export function countingHost(): CountingHost {
  let id = 0
  const ops = { createElement: 0, createText: 0, setText: 0, setAttribute: 0, insert: 0, remove: 0, move: 0 }

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
    reset() { for (const k of Object.keys(ops)) ops[k as keyof typeof ops] = 0 },
    root() { return { id: -1, tag: '#root', attrs: {}, children: [], parent: null } },
    createElement(tag) { ops.createElement++; return { id: id++, tag, attrs: {}, children: [], parent: null } },
    createText(value) { ops.createText++; return { id: id++, text: String(value), parent: null } },
    setText(node, value) { ops.setText++; node.text = String(value) },
    setAttribute(node, name, value) {
      ops.setAttribute++
      const attrs = (node.attrs ??= {})
      if (value == null || value === false) delete attrs[name]
      else attrs[name] = String(value)
    },
    insert(parent, node, before = null) { ops.insert++; place(parent, node, before) },
    move(parent, node, before = null) { ops.move++; place(parent, node, before) },
    remove(node) { ops.remove++; detach(node) },
    text(node) { return node.text != null ? node.text : (node.children ?? []).map(c => host.text(c)).join('') },
    html(node) {
      if (node.text != null) return escapeHtml(node.text)
      const attrs = Object.entries(node.attrs ?? {}).map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join('')
      return `<${node.tag}${attrs}>${(node.children ?? []).map(c => host.html(c)).join('')}</${node.tag}>`
    },
  }
  return host
}
