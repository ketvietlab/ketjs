// A DOM small enough to fit in a test file, so hydration can be checked without a
// browser and without a dependency. It parses exactly what renderToString emits —
// tags, attributes, text and comments — and nothing more.
//
// It is a stand-in, not a browser: test/ssr-browser.md records the same scenarios
// run against a real one.

export type TNode = {
  nodeType: number
  nodeName: string
  data: string
  attrs: Map<string, string>
  childNodes: TNode[]
  parentNode: TNode | null
  readonly firstChild: TNode | null
  readonly nextSibling: TNode | null
  setAttribute(n: string, v: string): void
  removeAttribute(n: string): void
  getAttribute(n: string): string | null
  insertBefore(node: TNode, before: TNode | null): TNode
  remove(): void
  querySelectorAll(sel: string): TNode[]
  readonly outerHTML: string
  readonly innerHTML: string
}

export const ELEMENT = 1, TEXT = 3, COMMENT = 8

const ESC = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const UNESC = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

export function makeNode(nodeType: number, nodeName: string, data = ''): TNode {
  const n: TNode = {
    nodeType, nodeName, data,
    attrs: new Map(), childNodes: [], parentNode: null,
    get firstChild() { return n.childNodes[0] ?? null },
    get nextSibling() {
      const p = n.parentNode
      if (!p) return null
      return p.childNodes[p.childNodes.indexOf(n) + 1] ?? null
    },
    setAttribute(k, v) { n.attrs.set(k, v) },
    removeAttribute(k) { n.attrs.delete(k) },
    getAttribute(k) { return n.attrs.get(k) ?? null },
    insertBefore(node, before) {
      if (node.parentNode) {
        const sibs = node.parentNode.childNodes
        const at = sibs.indexOf(node)
        if (at >= 0) sibs.splice(at, 1)
      }
      const i = before ? n.childNodes.indexOf(before) : -1
      if (i >= 0) n.childNodes.splice(i, 0, node)
      else n.childNodes.push(node)
      node.parentNode = n
      return node
    },
    remove() {
      const p = n.parentNode
      if (!p) return
      const i = p.childNodes.indexOf(n)
      if (i >= 0) p.childNodes.splice(i, 1)
      n.parentNode = null
    },
    querySelectorAll(sel) {
      const out: TNode[] = []
      const walk = (x: TNode) => {
        if (x.nodeType === ELEMENT && x.nodeName.toLowerCase() === sel.toLowerCase()) out.push(x)
        for (const c of x.childNodes) walk(c)
      }
      for (const c of n.childNodes) walk(c)
      return out
    },
    get innerHTML() { return n.childNodes.map(c => c.outerHTML).join('') },
    get outerHTML() {
      if (n.nodeType === TEXT) return ESC(n.data)
      if (n.nodeType === COMMENT) return `<!--${n.data}-->`
      const a = [...n.attrs].map(([k, v]) => ` ${k}="${ESC(v)}"`).join('')
      return `<${n.nodeName.toLowerCase()}${a}>${n.innerHTML}</${n.nodeName.toLowerCase()}>`
    },
  }
  return n
}

export const document = {
  createElement: (tag: string) => makeNode(ELEMENT, tag.toUpperCase()),
  createTextNode: (data: string) => makeNode(TEXT, '#text', data),
  createComment: (data: string) => makeNode(COMMENT, '#comment', data),
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])

/** Parse an HTML fragment into the tree above. Handles what renderToString emits. */
export function parseFragment(html: string): TNode {
  const root = makeNode(ELEMENT, 'DIV')
  const stack: TNode[] = [root]
  const top = () => stack[stack.length - 1] as TNode
  let i = 0
  const pushText = (s: string) => { if (s) top().insertBefore(makeNode(TEXT, '#text', UNESC(s)), null) }

  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) { pushText(html.slice(i)); break }
    pushText(html.slice(i, lt))
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt)
      top().insertBefore(makeNode(COMMENT, '#comment', html.slice(lt + 4, end)), null)
      i = end + 3
      continue
    }
    if (html[lt + 1] === '/') { stack.pop(); i = html.indexOf('>', lt) + 1; continue }
    let j = lt + 1
    while (j < html.length && /[^\s/>]/.test(html[j] as string)) j++
    const tag = html.slice(lt + 1, j)
    const el = makeNode(ELEMENT, tag.toUpperCase())
    const gt = html.indexOf('>', j)
    const attrSrc = html.slice(j, gt)
    for (const m of attrSrc.matchAll(/([^\s=]+)="([^"]*)"/g)) el.setAttribute(m[1] as string, UNESC(m[2] as string))
    top().insertBefore(el, null)
    if (!VOID.has(tag) && !attrSrc.trimEnd().endsWith('/')) stack.push(el)
    i = gt + 1
  }
  return root
}
