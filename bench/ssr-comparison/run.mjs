// Public SSR APIs render the same element tree and escaped product data.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { jsx as ket } from '@ketvietlab/ketjs-view/jsx-runtime'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { createElement as react } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { h as preact } from 'preact'
import { renderToString as renderPreact } from 'preact-render-to-string'
import { h as vue } from 'vue'
import { renderToString as renderVue } from '@vue/server-renderer'

/**
 * @typedef {(tag: string, props: Record<string, unknown> | null, children?: unknown) => unknown} Element
 * @typedef {{ name: string, version: string, element: Element, render: (node: unknown) => string | Promise<string> }} Candidate
 * @typedef {{ id: number, name: string, qty: number }} Product
 */

const ketVersion = JSON.parse(
  readFileSync(new URL('../../packages/ketjs-view/package.json', import.meta.url), 'utf8'),
).version
const rotation = Number(process.argv[2] ?? 0) % 4
/** @type {Candidate[]} */
const candidates = [
  {
    name: 'ketjs-view',
    version: ketVersion,
    element: (tag, props, children) =>
      ket(tag, { ...props, children: /** @type {import('@ketvietlab/ketjs-view').JSXChild} */ (children) }),
    // Every node this harness passes to the ketjs-view renderer comes from its own jsx().
    render: /** @type {(node: unknown) => string} */ (renderToStaticString),
  },
  {
    name: 'React',
    version: '19.3.0',
    element: (tag, props, children) => react(tag, props, children),
    render: renderToStaticMarkup,
  },
  { name: 'Preact', version: '11.0.0 / renderer 6.8.0', element: preact, render: renderPreact },
  { name: 'Vue', version: '3.5.43', element: vue, render: renderVue },
]
/** @param {unknown} value */
const escapeText = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
/**
 * @param {Candidate} candidate
 * @param {Product[]} products
 */
function renderList(candidate, products) {
  const h = candidate.element
  return candidate.render(
    h(
      'ul',
      { class: 'products' },
      products.map((product) =>
        h('li', { key: product.id, 'data-id': String(product.id) }, [
          h('span', null, product.name),
          h('b', null, String(product.qty)),
        ]),
      ),
    ),
  )
}
// React uses className; all other public APIs accept class.
candidates[1].element = (tag, props, children) => {
  const { class: className, ...rest } = props ?? {}
  return react(tag, className ? { ...rest, className } : rest, children)
}
for (const count of [50, 1000]) {
  const products = Array.from({ length: count }, (_, id) => ({ id, name: `Product ${id} <&>`, qty: id + 1 }))
  const expected = `<ul class="products">${products.map((product) => `<li data-id="${product.id}"><span>${escapeText(product.name)}</span><b>${product.qty}</b></li>`).join('')}</ul>`
  const iterations = count === 50 ? 5000 : 500
  const warmup = count === 50 ? 500 : 50
  for (let index = 0; index < 4; index++) {
    const candidate = candidates[(index + rotation) % 4]
    const normalize = (/** @type {string} */ html) =>
      html.replace(/<!--[\s\S]*?-->/g, '').replaceAll('&gt;', '>')
    assert.ok(
      normalize(await renderList(candidate, products)) === normalize(expected),
      `${candidate.name} must render equivalent HTML`,
    )
    for (let i = 0; i < warmup; i++) await renderList(candidate, products)
    // Encode every result, as a server must: V8 can return an unflattened string from concatenation and
    // defer the work past the timer, which only a consumer would pay for.
    const start = performance.now()
    let result = ''
    let bytes = 0
    for (let i = 0; i < iterations; i++) {
      result = await renderList(candidate, products)
      bytes += Buffer.byteLength(result)
    }
    const milliseconds = performance.now() - start
    assert.ok(normalize(result) === normalize(expected), `${candidate.name} final output must match`)
    assert.ok(
      bytes === iterations * Buffer.byteLength(result),
      `${candidate.name} must render the same bytes`,
    )
    console.log(
      JSON.stringify({
        framework: candidate.name,
        version: candidate.version,
        rows: count,
        iterations,
        warmup,
        milliseconds,
        perSecond: (iterations * 1000) / milliseconds,
        millisecondsPerRender: milliseconds / iterations,
        outputBytes: Buffer.byteLength(result),
        semanticOutputBytes: Buffer.byteLength(expected),
      }),
    )
  }
}
