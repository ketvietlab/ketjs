import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString, HydrationMismatch } from '../src/view/ssr.ts'
import { html, each, when, hydrateRoot, createRoot } from '../src/view/render.ts'
import { domHost } from '../src/view/host.ts'
import { document, parseFragment, TEXT, ELEMENT } from './helpers/dom.ts'
import type { TNode } from './helpers/dom.ts'
import type { HostNode } from '../src/view/host.ts'

type Item = { id: number; name: string }
const list = (items: Item[]) =>
  html`<ul class="l">${each(items, i => (i as Item).id, i => html`<li data-id=${(i as Item).id}>${(i as Item).name}</li>`)}</ul>`

// Counts DOM construction so "hydration adopts rather than rebuilds" is a number.
function tracingDoc() {
  const counts = { createElement: 0, createTextNode: 0, createComment: 0 }
  return {
    counts,
    createElement: (t: string) => { counts.createElement++; return document.createElement(t) },
    createTextNode: (d: string) => { counts.createTextNode++; return document.createTextNode(d) },
    createComment: (d: string) => { counts.createComment++; return document.createComment(d) },
  }
}

test('ssr: fences every hole so adjacent text cannot merge', () => {
  const out = renderToString(html`<p class="a" title=${'xin chào'}>${'nội dung'}</p>`)
  assert.equal(out, '<p class="a" title="xin chào"><!--k[-->nội dung<!--k--></p>')
})

test('ssr: escapes interpolated values, in text and in attributes', () => {
  const out = renderToString(html`<p title=${'"><script>'}>${'<script>alert(1)</script>'}</p>`)
  assert.ok(!out.includes('<script>'), 'no raw script tag may survive')
  assert.match(out, /&lt;script&gt;/)
  assert.match(out, /title="&quot;&gt;&lt;script&gt;"/)
})

test('ssr: nested templates and lists render in document order', () => {
  const out = renderToString(list([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]))
  assert.equal(out, '<ul class="l"><!--k[--><li data-id="1"><!--k[-->a<!--k--></li><li data-id="2"><!--k[-->b<!--k--></li><!--k--></ul>')
})

test('ssr: an absent value renders nothing but still leaves its marker', () => {
  assert.equal(renderToString(html`<p>${null}${when(false, () => html`<b>x</b>`)}</p>`), '<p><!--k[--><!--k--><!--k[--><!--k--></p>')
})

test('hydration: adopts the server DOM instead of rebuilding it', () => {
  const items: Item[] = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }]
  const container = parseFragment(renderToString(list(items)))
  const before = container.querySelectorAll('li')
  assert.equal(before.length, 3)

  const doc = tracingDoc()
  hydrateRoot(domHost(doc), container as unknown as HostNode, list(items))
  assert.deepEqual(doc.counts, { createElement: 0, createTextNode: 0, createComment: 0 },
    'hydration must not construct a single node')

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
  root.render(list(items.map(i => (i.id === 7 ? { ...i, name: 'ĐỔI' } : i))))

  assert.deepEqual(doc.counts, { createElement: 0, createTextNode: 0, createComment: 0 },
    'patching one row must not create nodes')
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
  const items: Item[] = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]
  const container = parseFragment(renderToString(list(items)))
  const root = hydrateRoot(domHost(document), container as unknown as HostNode, list(items))

  root.render(list([{ id: 0, name: 'z' }, ...items]))
  assert.deepEqual(container.querySelectorAll('li').map(n => n.innerHTML.replace(/<!--k\[?-->/g, '')), ['z', 'a', 'b'])

  root.render(list([{ id: 2, name: 'b' }]))
  assert.deepEqual(container.querySelectorAll('li').map(n => n.innerHTML.replace(/<!--k\[?-->/g, '')), ['b'])
})

test('hydration: a mismatch fails loudly rather than patching over it', () => {
  const container = parseFragment('<ul class="l"><li>wrong markup</li></ul>')
  assert.throws(
    () => hydrateRoot(domHost(document), container as unknown as HostNode, list([{ id: 1, name: 'a' }])),
    (e: unknown) => {
      assert.ok(e instanceof HydrationMismatch)
      assert.equal((e as { code: string }).code, 'E_HYDRATION_MISMATCH')
      return true
    })
})

test('ssr and client render agree on the markup they produce', () => {
  const items: Item[] = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]
  const server = renderToString(list(items))

  const container = document.createElement('div')
  createRoot(domHost(document), container as unknown as HostNode).render(list(items))
  // the client uses empty text nodes as anchors where the server writes comments
  const client = container.innerHTML.replace(/<!--k\[?-->/g, '')
  assert.equal(server.replace(/<!--k\[?-->/g, ''), client)
})
