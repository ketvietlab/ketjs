import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { transform } from 'esbuild'
import { scaffoldView } from '@ketvietlab/create-view'
import {
  HydrationMismatch,
  domHost,
  mountHydrated,
  renderToStaticString,
  renderToString,
} from '@ketvietlab/ketjs-view'
import type { HostNode, Signal, TemplateResult } from '@ketvietlab/ketjs-view'
import { buildProject, transformKetJsx } from '@ketvietlab/ketjs-view-tools'
import { document, parseFragment } from './helpers/dom.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Every construct the compiler either writes as a template or must hand back to the
// runtime: entities, JSX whitespace, spread, style objects, refs-free components,
// fragments, nested lists, svg, and characters a template literal treats specially.
const FIXTURES = `
import { signal } from '@ketvietlab/ketjs-view'
type P = { id: number; name: string; qty: number }
export const products = (n: number): P[] =>
  Array.from({ length: n }, (_, id) => ({ id, name: \`Product \${id} <&>\`, qty: id + 1 }))

export const List = (ps: P[]) => (
  <ul class="products">
    {ps.map((p) => (
      <li key={p.id} data-id={String(p.id)}>
        <span>{p.name}</span>
        <b>{String(p.qty)}</b>
      </li>
    ))}
  </ul>
)

export const Counter = (props: { label: string; count: number; onIncrement?: () => void }) => (
  <button type="button" class="counter" data-count={props.count} onClick={props.onIncrement}>
    {props.label}: {props.count}
  </button>
)

const Layout = (props: { title: unknown; children?: unknown }) => (
  <main>
    {props.title}
    {props.children}
  </main>
)

export const Mixed = (props: Record<string, unknown>) => (
  <section id="m" title="a &amp; b" data-q='say "hi"'>
    Tom &amp; Jerry — line one
    and line two   {/* a comment */}
    <Counter label="x" count={1} />
    <div {...props} />
    <input disabled />
    <p style={{ color: 'red', marginTop: 0 }}>styled</p>
    <>
      <i>fragment</i> tail
    </>
    {props.show && <em>shown</em>}
    {props.hide && <em>hidden</em>}
    {['a', ['b', <u>c</u>]]}
    <svg viewBox="0 0 10 10">
      <path d="M0 0" />
    </svg>
    <label htmlFor="x">cost \${'{'}5{'}'} \`tick\` \\ back</label>
    <Layout title={<h1>Hi</h1>}>
      <p>child</p>
      <p>two</p>
    </Layout>
  </section>
)

export const count = signal(3)
export const Live = () => (
  <div class="live">
    <span>Count: {count()}</span>
    <Counter label="c" count={count()} />
  </div>
)

export const Ref = () => <div ref={{}} />
export const VoidChild = () => <input>child</input>

export const cases = () => [
  List(products(3)),
  Counter({ label: '<x>', count: 2 }),
  Mixed({ show: true, hide: false, 'data-x': '1' }),
  Live(),
]
`

type Fixtures = {
  List: (products: unknown[]) => TemplateResult
  products: (n: number) => unknown[]
  Live: () => TemplateResult
  Ref: () => TemplateResult
  VoidChild: () => TemplateResult
  count: Signal<number>
  cases: () => TemplateResult[]
}

/** Both builds of the fixtures, loaded from a directory that resolves the workspace packages. */
async function load(): Promise<{ runtime: Fixtures; compiled: Fixtures; code: string; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), 'ket-jsx-test-'))
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir')
  const runtime = await transform(FIXTURES, {
    loader: 'tsx',
    jsx: 'automatic',
    jsxImportSource: '@ketvietlab/ketjs-view',
    format: 'esm',
  })
  const compiled = await transformKetJsx(FIXTURES)
  writeFileSync(join(dir, 'runtime.mjs'), runtime.code)
  writeFileSync(join(dir, 'compiled.mjs'), compiled.code)
  return {
    runtime: (await import(pathToFileURL(join(dir, 'runtime.mjs')).href)) as Fixtures,
    compiled: (await import(pathToFileURL(join(dir, 'compiled.mjs')).href)) as Fixtures,
    code: compiled.code,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

test('jsx compiler: static markup is byte-identical to the runtime it replaces', async () => {
  const { runtime, compiled, cleanup } = await load()
  try {
    const expected = runtime.cases().map((result) => renderToStaticString(result))
    const actual = compiled.cases().map((result) => renderToStaticString(result))
    assert.deepEqual(actual, expected)
  } finally {
    cleanup()
  }
})

test('jsx compiler: a static subtree becomes one template and the rest stays runtime JSX', async () => {
  const result = await transformKetJsx(
    'export const Row = (p: { id: number; name: string }) => <li data-id={p.id}><span>{p.name}</span><b>x</b></li>\n' +
      'export const Spread = (p: object) => <div {...p}><i>static</i></div>\n',
  )
  assert.equal(result.templates, 2)
  assert.equal(result.fallbacks, 1)
  assert.match(
    result.code,
    /__ket_html`<li data-id=\$\{p\.id\}><span>\$\{__ket_child\(p\.name\)\}<\/span><b>x<\/b><\/li>`/,
  )
  assert.match(result.code, /jsx\("div", \{ \.\.\.p, children: __ket_html`<i>static<\/i>` \}\)/)
  assert.doesNotMatch(result.code, /jsx\("li"/)

  const plain = await transformKetJsx('export const n = 1 + 1\n')
  assert.equal(plain.templates, 0)
  assert.doesNotMatch(plain.code, /__ket_html/, 'a module without JSX gains no imports')
})

test('jsx compiler: what the runtime rejects is still rejected by the runtime', async () => {
  const { compiled, cleanup } = await load()
  try {
    assert.throws(() => compiled.Ref(), /does not expose mutable element refs/)
    assert.throws(() => compiled.VoidChild(), /void element/)
  } finally {
    cleanup()
  }
})

test('jsx compiler: compiled server markup hydrates with a compiled client, and only with one', async () => {
  const { runtime, compiled, cleanup } = await load()
  try {
    const container = parseFragment(renderToString(compiled.Live()))
    const span = container.querySelectorAll('span')[0]
    mountHydrated(domHost(document), container as unknown as HostNode, compiled.Live)
    compiled.count.set(4)
    assert.equal(container.querySelectorAll('span')[0], span, 'the span is adopted, not rebuilt')
    const text = container.innerHTML.replace(/<!--k\[?-->/g, '')
    assert.match(text, /Count: 4/)
    assert.match(text, /data-count="4"/)

    // The two transforms place hydration markers differently. Mixing them must fail
    // loudly, which is why the server and the client have to share one build.
    const mixed = parseFragment(renderToString(runtime.Live()))
    assert.throws(
      () => mountHydrated(domHost(document), mixed as unknown as HostNode, compiled.Live),
      HydrationMismatch,
    )
  } finally {
    cleanup()
  }
})

test('jsx compiler: compiled lists are fewer templates than runtime JSX', async () => {
  const { runtime, compiled, code, cleanup } = await load()
  try {
    const products = compiled.products(2)
    const count = (result: unknown): number => {
      if (Array.isArray(result)) return result.reduce((n: number, item) => n + count(item), 0)
      if (typeof result !== 'object' || result === null || !('strings' in result)) return 0
      return 1 + count((result as TemplateResult).values)
    }
    // Runtime: ul, its list fragment, and per row li, span and b. Compiled: ul, the fragment, one per row.
    assert.equal(count(runtime.List(products)), 2 + 3 * 2)
    assert.equal(count(compiled.List(products)), 2 + 2)
    assert.match(code, /__ket_child = /)
  } finally {
    cleanup()
  }
})

test('view tools: compileJsx renders TSX pages to the same static markup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ket-view-jsx-'))
  try {
    scaffoldView('jsx-site', dir)
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir')
    writeFileSync(
      join(dir, 'src/pages/catalog.tsx'),
      `import { definePage } from '@ketvietlab/ketjs-view-tools'
const items = ['Tea & cake', 'Coffee']
export default definePage({
  head: { title: 'Catalog' },
  view: () => (
    <main class="catalog">
      <h1>Menu</h1>
      <ul>{items.map((item) => <li>{item}</li>)}</ul>
    </main>
  ),
})
`,
    )
    writeFileSync(
      join(dir, 'src/islands/note.tsx'),
      `import type { IslandFactory } from '@ketvietlab/ketjs-view'
const note: IslandFactory<{ text: string }> = (props) => () => <p class="note">{props.text}</p>
export default note
`,
    )
    const config = (compileJsx: boolean) =>
      `import { defineConfig } from '@ketvietlab/ketjs-view-tools'
export default defineConfig({
  styles: ['src/styles/main.css'],
  islands: { counter: 'src/islands/counter.tsx', note: 'src/islands/note.tsx' },
  compileJsx: ${compileJsx},
})
`
    // Static page markup is the same either way, so the island bundle shows which build ran. Pages
    // with islands are not compared: their hydration markers follow the JSX build by design.
    const build = async (compileJsx: boolean) => {
      writeFileSync(join(dir, 'ket-view.config.ts'), config(compileJsx))
      await buildProject(dir)
      const assets = readdirSync(join(dir, 'dist/assets')).filter((file) => file.endsWith('.js'))
      return {
        page: readFileSync(join(dir, 'dist/catalog/index.html'), 'utf8'),
        client: assets.map((file) => readFileSync(join(dir, 'dist/assets', file), 'utf8')).join('\n'),
      }
    }
    const runtime = await build(false)
    const compiled = await build(true)

    assert.match(
      compiled.page,
      /<main class="catalog"><h1>Menu<\/h1><ul><li>Tea &amp; cake<\/li><li>Coffee<\/li><\/ul><\/main>/,
    )
    assert.equal(compiled.page, runtime.page)
    assert.match(compiled.client, /<p class="note">/)
    assert.doesNotMatch(runtime.client, /<p class="note">/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
