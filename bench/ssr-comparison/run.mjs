// Public SSR APIs render the same escaped product list; equivalent markup is verified.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { jsx as ket } from '@ketvietlab/ketjs-view/jsx-runtime'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { createElement as react } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { h as vue } from 'vue'
import { renderToString as renderVue } from '@vue/server-renderer'
import { compile } from 'svelte/compiler'
import { render as renderSvelte } from 'svelte/server'
import { transform } from '@astrojs/compiler-rs'
import { experimental_AstroContainer as AstroContainer } from 'astro/container'

/**
 * @typedef {(tag: string, props: Record<string, unknown> | null, children?: unknown) => unknown} Element
 * @typedef {{ name: string, version: string, render: (products: Product[]) => string | Promise<string> }} Candidate
 * @typedef {{ id: number, name: string, qty: number }} Product
 */

const here = fileURLToPath(new URL('.', import.meta.url))
/** @param {string} name */
const versionOf = (name) =>
  JSON.parse(readFileSync(join(here, 'node_modules', name, 'package.json'), 'utf8')).version

// Svelte and Astro compile templates ahead of time, as their builds do. That happens here, once,
// before any timing; the timed render calls each framework's public server API.
const compiled = mkdtempSync(join(here, '.compiled-'))
/** @type {unknown} */
let SvelteList
/** @type {unknown} */
let AstroList
try {
  const svelteFile = join(compiled, 'ProductList.svelte.js')
  const svelteSource = readFileSync(join(here, 'components/ProductList.svelte'), 'utf8')
  writeFileSync(
    svelteFile,
    compile(svelteSource, { generate: 'server', filename: 'ProductList.svelte' }).js.code,
  )
  SvelteList = (await import(pathToFileURL(svelteFile).href)).default

  const astroFile = join(compiled, 'ProductList.astro.mjs')
  const astroSource = readFileSync(join(here, 'components/ProductList.astro'), 'utf8')
  const astro = transform(astroSource, {
    filename: join(here, 'components/ProductList.astro'),
    internalURL: 'astro/compiler-runtime',
    compact: true,
    resolvePath: (specifier) => specifier,
  })
  writeFileSync(astroFile, astro.code)
  AstroList = (await import(pathToFileURL(astroFile).href)).default
} finally {
  rmSync(compiled, { recursive: true, force: true })
}
const astroContainer = await AstroContainer.create()

/**
 * The product list written with a framework's element function.
 * @param {Element} h
 * @param {Product[]} products
 */
const tree = (h, products) =>
  h(
    'ul',
    { class: 'products' },
    products.map((product) =>
      h('li', { key: product.id, 'data-id': String(product.id) }, [
        h('span', null, product.name),
        h('b', null, String(product.qty)),
      ]),
    ),
  )
/** @type {Element} */
const ketElement = (tag, props, children) =>
  ket(tag, { ...props, children: /** @type {import('@ketvietlab/ketjs-view').JSXChild} */ (children) })
// React uses className; the other element functions accept class.
/** @type {Element} */
const reactElement = (tag, props, children) => {
  const { class: className, ...rest } = props ?? {}
  return react(tag, className ? { ...rest, className } : rest, children)
}

/** @type {Candidate[]} */
const candidates = [
  {
    name: 'ketjs-view',
    version: JSON.parse(readFileSync(join(here, '../../packages/ketjs-view/package.json'), 'utf8')).version,
    render: (products) =>
      renderToStaticString(
        /** @type {import('@ketvietlab/ketjs-view').TemplateResult} */ (tree(ketElement, products)),
      ),
  },
  {
    name: 'React',
    version: versionOf('react'),
    render: (products) => renderToStaticMarkup(tree(reactElement, products)),
  },
  {
    name: 'Svelte',
    version: versionOf('svelte'),
    render: (products) => renderSvelte(SvelteList, { props: { products } }).body,
  },
  {
    name: 'Vue',
    version: versionOf('vue'),
    render: (products) => renderVue(tree(vue, products)),
  },
  {
    name: 'Astro',
    version: versionOf('astro'),
    render: (products) => astroContainer.renderToString(AstroList, { props: { products } }),
  },
]
const rotation = Number(process.argv[2] ?? 0) % candidates.length

/** @param {unknown} value */
const escapeText = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
for (const count of [50, 1000]) {
  const products = Array.from({ length: count }, (_, id) => ({ id, name: `Product ${id} <&>`, qty: id + 1 }))
  const expected = `<ul class="products">${products.map((product) => `<li data-id="${product.id}"><span>${escapeText(product.name)}</span><b>${product.qty}</b></li>`).join('')}</ul>`
  const iterations = count === 50 ? 5000 : 500
  const warmup = count === 50 ? 500 : 50
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[(index + rotation) % candidates.length]
    const normalize = (/** @type {string} */ html) =>
      html.replace(/<!--[\s\S]*?-->/g, '').replaceAll('&gt;', '>')
    assert.ok(
      normalize(await candidate.render(products)) === normalize(expected),
      `${candidate.name} must render equivalent HTML`,
    )
    for (let i = 0; i < warmup; i++) await candidate.render(products)
    // Encode every result, as a server must: V8 can return an unflattened string from concatenation and
    // defer the work past the timer, which only a consumer would pay for.
    const start = performance.now()
    let result = ''
    let bytes = 0
    for (let i = 0; i < iterations; i++) {
      result = await candidate.render(products)
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
