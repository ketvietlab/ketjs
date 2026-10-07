// Public SSR APIs render the same element tree and escaped product data.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { jsx as ket } from '../../packages/ketjs-view/dist/jsx-runtime.js'
import { renderToStaticString } from '../../packages/ketjs-view/dist/index.js'
import { createElement as react } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { h as preact } from 'preact'
import { renderToString as renderPreact } from 'preact-render-to-string'
import { h as vue } from 'vue'
import { renderToString as renderVue } from '@vue/server-renderer'

const ketVersion = JSON.parse(
  readFileSync(new URL('../../packages/ketjs-view/package.json', import.meta.url)),
).version
const rotation = Number(process.argv[2] ?? 0) % 4
const candidates = [
  {
    name: 'ketjs-view',
    version: ketVersion,
    element: (tag, props, children) => ket(tag, { ...props, children }),
    render: renderToStaticString,
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
const escapeText = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
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
    const normalize = (html) => html.replace(/<!--[\s\S]*?-->/g, '').replaceAll('&gt;', '>')
    assert.ok(
      normalize(await renderList(candidate, products)) === normalize(expected),
      `${candidate.name} must render equivalent HTML`,
    )
    for (let i = 0; i < warmup; i++) await renderList(candidate, products)
    const start = performance.now()
    let result
    for (let i = 0; i < iterations; i++) result = await renderList(candidate, products)
    const milliseconds = performance.now() - start
    assert.ok(normalize(result) === normalize(expected), `${candidate.name} final output must match`)
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
