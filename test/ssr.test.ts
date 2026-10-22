import { test } from 'node:test'
import assert from 'node:assert/strict'
import { document, parseFragment } from './helpers/dom.ts'
import type { TNode } from './helpers/dom.ts'
import {
  HydrationMismatch,
  SVG_NAMESPACE,
  createRoot,
  domHost,
  each,
  html,
  hydrateRoot,
  renderToStaticString,
  renderToString,
  trustedMarkup,
  when,
} from '@ketvietlab/ketjs-view'
import type { HostNode, TemplateResult } from '@ketvietlab/ketjs-view'

type Item = { id: number; name: string }
const list = (items: Item[]) =>
  html`<ul class="l">${each(
    items,
    (i) => (i as Item).id,
    (i) => html`<li data-id=${(i as Item).id}>${(i as Item).name}</li>`,
  )}</ul>`

// Counts DOM construction so "hydration adopts rather than rebuilds" is a number.
function tracingDoc() {
  const counts = { createElement: 0, createTextNode: 0, createComment: 0 }
  return {
    counts,
    createElement: (t: string) => {
      counts.createElement++
      return document.createElement(t)
    },
    createTextNode: (d: string) => {
      counts.createTextNode++
      return document.createTextNode(d)
    },
    createComment: (d: string) => {
      counts.createComment++
      return document.createComment(d)
    },
  }
}

test('ssr: fences every hole so adjacent text cannot merge', () => {
  const out = renderToString(html`<p class="a" title=${'xin chào'}>${'nội dung'}</p>`)
  assert.equal(out, '<p class="a" title="xin chào"><!--k[-->nội dung<!--k--></p>')
})

test('static rendering: omits hydration markers through nested templates and lists', () => {
  const out = renderToStaticString(
    html`<main>${html`<h1>${'Cửa hàng'}</h1>`}${list([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ])}</main>`,
  )
  assert.equal(
    out,
    '<main><h1>Cửa hàng</h1><ul class="l"><li data-id="1">a</li><li data-id="2">b</li></ul></main>',
  )
})

test('static rendering: keeps markers only inside legacy and standard island hosts', () => {
  const out = renderToStaticString(html`
    <header>${'Tĩnh'}</header>
    <ket-island data-island="legacy"><button>${1}</button></ket-island>
    <div data-ket-island="" data-island="standard"><button>${2}</button></div>
    <footer>${'Tĩnh'}</footer>
  `)
  assert.doesNotMatch(out, /<header><!--k/)
  assert.match(out, /<ket-island[^>]*><button><!--k\[-->1<!--k--><\/button><\/ket-island>/)
  assert.match(
    out,
    /<div data-ket-island="" data-island="standard"><button><!--k\[-->2<!--k--><\/button><\/div>/,
  )
  assert.doesNotMatch(out, /<footer><!--k/)
  assert.equal(
    renderToStaticString(html`<div data-ket-island=${false}>${3}</div>`),
    '<div>3</div>',
    'a false boundary attribute does not retain markers',
  )
})

test('static rendering: one compiled template follows its boundary hole on every render', () => {
  // The same call site renders both ways, so the compiled template cannot fix the
  // answer from whichever value it happened to see first.
  const view = (boundary: string | null) =>
    html`<section><div data-ket-island=${boundary}><b>${'x'}</b></div></section>`
  for (let i = 0; i < 2; i++) {
    assert.equal(
      renderToStaticString(view('')),
      '<section><div data-ket-island=""><b><!--k[-->x<!--k--></b></div></section>',
    )
    assert.equal(renderToStaticString(view(null)), '<section><div><b>x</b></div></section>')
  }
})

test('ssr: static attribute values and every escaped character survive compilation', () => {
  assert.equal(
    renderToString(html`<a title="a & b" href=${`?q=<'&">`}>${`&<>"'`}</a>`),
    `<a title="a &amp; b" href="?q=&lt;&#39;&amp;&quot;&gt;"><!--k[-->&amp;&lt;&gt;&quot;&#39;<!--k--></a>`,
  )
})

test('static rendering: escapes values without relying on marker removal', () => {
  assert.equal(
    renderToStaticString(html`<p title=${'"><script>'}>${'<script>alert(1)</script>'}</p>`),
    '<p title="&quot;&gt;&lt;script&gt;">&lt;script&gt;alert(1)&lt;/script&gt;</p>',
  )
})

test('ssr: escapes interpolated values, in text and in attributes', () => {
  const out = renderToString(html`<p title=${'"><script>'}>${'<script>alert(1)</script>'}</p>`)
  assert.ok(!out.includes('<script>'), 'no raw script tag may survive')
  assert.match(out, /&lt;script&gt;/)
  assert.match(out, /title="&quot;&gt;&lt;script&gt;"/)
})

test('ssr: nested templates and lists render in document order', () => {
  const out = renderToString(
    list([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ]),
  )
  assert.equal(
    out,
    '<ul class="l"><!--k[--><li data-id="1"><!--k[-->a<!--k--></li><li data-id="2"><!--k[-->b<!--k--></li><!--k--></ul>',
  )
})

test('ssr: an absent value renders nothing but still leaves its marker', () => {
  assert.equal(
    renderToString(html`<p>${null}${when(false, () => html`<b>x</b>`)}</p>`),
    '<p><!--k[--><!--k--><!--k[--><!--k--></p>',
  )
})

test('hydration: adopts the server DOM instead of rebuilding it', () => {
  const items: Item[] = [
    { id: 1, name: 'a' },
    { id: 2, name: 'b' },
    { id: 3, name: 'c' },
  ]
  const container = parseFragment(renderToString(list(items)))
  const before = container.querySelectorAll('li')
  assert.equal(before.length, 3)

  const doc = tracingDoc()
  hydrateRoot(domHost(doc), container as unknown as HostNode, list(items))
  assert.deepEqual(
    doc.counts,
    { createElement: 0, createTextNode: 0, createComment: 0 },
    'hydration must not construct a single node',
  )

  const after = container.querySelectorAll('li')
  assert.equal(after.length, 3)
  for (let i = 0; i < 3; i++) assert.equal(after[i], before[i], 'the very same node objects must survive')
})

test('hydration: the first update after it is surgical, not a rebuild', () => {
  const items: Item[] = Array.from({ length: 20 }, (_, i) => ({ id: i, name: `n${i}` }))
  const container = parseFragment(renderToString(list(items)))
  const doc = tracingDoc()
  const root = hydrateRoot(domHost(doc), container as unknown as HostNode, list(items))

  const targetNode = container.querySelectorAll('li')[7] as TNode
  root.render(list(items.map((i) => (i.id === 7 ? { ...i, name: 'ĐỔI' } : i))))

  assert.deepEqual(
    doc.counts,
    { createElement: 0, createTextNode: 0, createComment: 0 },
    'patching one row must not create nodes',
  )
  assert.equal(container.querySelectorAll('li')[7], targetNode, 'the row element itself is untouched')
  assert.match(targetNode.innerHTML, /ĐỔI/)
})

test('hydration: attributes are adopted, and the element is never replaced', () => {
  // One template function, so every render shares a call site — the same rule that
  // lets a tagged template be cached at all.
  const view = (cls: string) => html`<p class=${cls}>${'x'}</p>`
  const container = parseFragment(renderToString(view('a')))
  const p = container.querySelectorAll('p')[0] as TNode
  const doc = tracingDoc()
  const root = hydrateRoot(domHost(doc), container as unknown as HostNode, view('a'))

  root.render(view('a'))
  assert.equal(p.getAttribute('class'), 'a')
  root.render(view('b'))
  assert.equal(p.getAttribute('class'), 'b')
  assert.equal(container.querySelectorAll('p')[0], p, 'the element is patched, never replaced')
  assert.deepEqual(doc.counts, { createElement: 0, createTextNode: 0, createComment: 0 })
})

test('hydration: growing and shrinking the list after hydration still works', () => {
  const items: Item[] = [
    { id: 1, name: 'a' },
    { id: 2, name: 'b' },
  ]
  const container = parseFragment(renderToString(list(items)))
  const root = hydrateRoot(domHost(document), container as unknown as HostNode, list(items))

  root.render(list([{ id: 0, name: 'z' }, ...items]))
  assert.deepEqual(
    container.querySelectorAll('li').map((n) => n.innerHTML.replace(/<!--k\[?-->/g, '')),
    ['z', 'a', 'b'],
  )

  root.render(list([{ id: 2, name: 'b' }]))
  assert.deepEqual(
    container.querySelectorAll('li').map((n) => n.innerHTML.replace(/<!--k\[?-->/g, '')),
    ['b'],
  )
})

test('hydration: a mismatch fails loudly rather than patching over it', () => {
  const container = parseFragment('<ul class="l"><li>wrong markup</li></ul>')
  assert.throws(
    () => hydrateRoot(domHost(document), container as unknown as HostNode, list([{ id: 1, name: 'a' }])),
    (e: unknown) => {
      assert.ok(e instanceof HydrationMismatch)
      assert.equal((e as { code: string }).code, 'E_HYDRATION_MISMATCH')
      return true
    },
  )
})

test('ssr and client render agree on the markup they produce', () => {
  const items: Item[] = [
    { id: 1, name: 'a' },
    { id: 2, name: 'b' },
  ]
  const server = renderToString(list(items))

  const container = document.createElement('div')
  createRoot(domHost(document), container as unknown as HostNode).render(list(items))
  // the client uses empty text nodes as anchors where the server writes comments
  const client = container.innerHTML.replace(/<!--k\[?-->/g, '')
  assert.equal(server.replace(/<!--k\[?-->/g, ''), client)
})

test('hydration: an implied element is diagnosed, not just reported', () => {
  // The template omits <tbody>; a parser inserts one, so the walk finds a node the
  // template never wrote. This is the most common SSR trap there is.
  const view = () => html`<table><tr><td>${'x'}</td></tr></table>`
  const server = renderToString(view())
  assert.ok(!server.includes('tbody'), 'the server wrote exactly what the template said')

  const asParsed = parseFragment(
    server.replace('<table>', '<table><tbody>').replace('</table>', '</tbody></table>'),
  )
  const e = (() => {
    try {
      hydrateRoot(domHost(document), asParsed as unknown as HostNode, view())
    } catch (err) {
      return err as HydrationMismatch & { hint: string }
    }
  })()!
  assert.match(e.message, /expected <tr>, found <tbody>/)
  assert.match(e.hint, /parser inserted <tbody> on its own — write it in the template/)
})

test('ssr: a hole inside <title> gets no hydration markers, because they are not comments there', () => {
  // An HTML parser reads title and textarea as text, not markup, so `<!--k[-->`
  // arrives as literal characters. The browser tab said "<!--k[-->KetSuite<!--k-->".
  assert.equal(renderToString(html`<title>${'KetSuite'}</title>`), '<title>KetSuite</title>')
  assert.equal(renderToString(html`<textarea>${'ghi chú'}</textarea>`), '<textarea>ghi chú</textarea>')
})

test('ssr: a hole inside <style> or <script> gets none either, and only trusted markup is code there', () => {
  // A marker in a style sheet opened a selector that swallowed every rule after it,
  // and in a script `<!--` commented out the rest of the line.
  const css = trustedMarkup('a > b { color: red }')
  assert.equal(renderToString(html`<style>${css}</style>`), '<style>a > b { color: red }</style>')
  assert.equal(
    renderToString(html`<script>${trustedMarkup('if (a && b < c) go()')}</script>`),
    '<script>if (a && b < c) go()</script>',
  )
  // A plain string is text, so it is escaped: it cannot close the element, and it is not code.
  assert.equal(
    renderToString(html`<script>${'</script><script>alert(1)'}</script>`),
    '<script>&lt;/script&gt;&lt;script&gt;alert(1)</script>',
  )
})

test('ssr: and the value is still escaped there', () => {
  assert.equal(
    renderToString(html`<title>${'<script>x</script>'}</title>`),
    '<title>&lt;script&gt;x&lt;/script&gt;</title>',
  )
})

test('ssr: everywhere else the markers stay, because the hydration walk counts on them', () => {
  assert.match(renderToString(html`<p>giá trị ${5}</p>`), /<!--k\[-->5<!--k-->/)
})

// Records the namespace of every element a render creates, over the test DOM.
function namespaceDoc() {
  const created: { tag: string; ns: string | null }[] = []
  return {
    created,
    createElement: (t: string) => {
      created.push({ tag: t, ns: null })
      return document.createElement(t)
    },
    createElementNS: (ns: string, t: string) => {
      created.push({ tag: t, ns })
      return document.createElement(t)
    },
    createTextNode: (d: string) => document.createTextNode(d),
    createComment: (d: string) => document.createComment(d),
  }
}

test('hydration: a template patched into a server-rendered <svg> is created in the svg namespace', () => {
  // A design-system icon is an <svg> whose glyph arrives through a hole. On the server
  // the HTML parser puts the glyph in the SVG namespace; after hydration, a new glyph
  // is built by the client and has to be told, or it lands in HTML and draws nothing.
  const icon = (glyph: TemplateResult) => html`<span>${html`<svg viewBox="0 0 24 24">${glyph}</svg>`}</span>`
  const phone = html`<path d="M1 1" />`
  const off = html`<path d="M2 2" /><path d="M22 2 2 22" />`
  const container = parseFragment(renderToString(icon(phone)))
  const doc = namespaceDoc()
  const root = hydrateRoot(domHost(doc), container as unknown as HostNode, icon(phone))
  assert.deepEqual(doc.created, [], 'hydration adopts the server nodes')

  root.render(icon(off))
  assert.deepEqual(doc.created, [
    { tag: 'path', ns: SVG_NAMESPACE },
    { tag: 'path', ns: SVG_NAMESPACE },
  ])
})

test('hydration: list entries inside an <svg> keep the namespace, and <foreignObject> content is html', () => {
  const chart = (bars: number[], label: TemplateResult) =>
    html`<svg>${each(
      bars,
      (bar) => bar,
      (bar) => html`<rect width=${bar} />`,
    )}<foreignObject>${label}</foreignObject></svg>`
  const container = parseFragment(renderToString(chart([1], html`<p>${'a'}</p>`)))
  const doc = namespaceDoc()
  const root = hydrateRoot(domHost(doc), container as unknown as HostNode, chart([1], html`<p>${'a'}</p>`))

  root.render(chart([1, 2], html`<div>${'b'}</div>`))
  assert.deepEqual(doc.created, [
    { tag: 'rect', ns: SVG_NAMESPACE },
    { tag: 'div', ns: null },
  ])
})

test('hydration: entries that shift position leave no server nodes behind', () => {
  // A list keyed by position whose entries wrap their content, as a layout stack does:
  // putting an entry in front makes every entry render what its neighbour had.
  const stack = (items: TemplateResult[]) =>
    html`<div>${each(
      items,
      (_, index) => index,
      (item) => html`${item}`,
    )}</div>`
  const text = (value: string) => html`<span>${value}</span>`
  const box = (value: string) => html`<section>${value}</section>`
  const notice = (value: string) => html`<aside>${value}</aside>`
  const container = parseFragment(renderToString(stack([text('one'), box('two')])))
  const root = hydrateRoot(
    domHost(document),
    container as unknown as HostNode,
    stack([text('one'), box('two')]),
  )

  root.render(stack([notice('zero'), text('one'), box('two')]))
  const visible = container.innerHTML.replace(/<!--.*?-->/g, '')
  assert.equal(visible, '<div><aside>zero</aside><span>one</span><section>two</section></div>')

  root.render(stack([text('one')]))
  assert.equal(container.innerHTML.replace(/<!--.*?-->/g, ''), '<div><span>one</span></div>')
})

test('hydration: adopted entries know their places, so the first reorder moves only what moved', () => {
  const rows = (ids: string[]) =>
    html`<ul>${each(
      ids,
      (id) => id as string,
      (id) => html`${html`<li>${id as string}</li>`}`,
    )}</ul>`
  const container = parseFragment(renderToString(rows(['a', 'b', 'c'])))
  const host = domHost(document)
  const moved: string[] = []
  const move = host.move.bind(host)
  host.move = (parent, node, before) => {
    const element = node as unknown as TNode
    if (element.nodeType === 1) moved.push(element.innerHTML.replace(/<!--.*?-->/g, ''))
    move(parent, node, before)
  }
  const root = hydrateRoot(host, container as unknown as HostNode, rows(['a', 'b', 'c']))

  root.render(rows(['c', 'a', 'b']))
  assert.equal(container.innerHTML.replace(/<!--.*?-->/g, ''), '<ul><li>c</li><li>a</li><li>b</li></ul>')
  assert.deepEqual(moved, ['c'], 'a and b were already in order')
})
