import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { buildSync, transformSync } from 'esbuild'
import { previewDocument } from '../site/playground-frame.mjs'

const bundle = buildSync({
  stdin: {
    contents: `import * as view from '@ketvietlab/ketjs-view'; import * as jsx from '@ketvietlab/ketjs-view/jsx-runtime'; export { view, jsx };`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: 'iife',
  globalName: 'Runtime',
  platform: 'browser',
  write: false,
}).outputFiles[0].text
const context = {}
runInNewContext(bundle, context)
const { view, jsx } = context.Runtime
const module = { exports: {} }
new Function(
  'module',
  'exports',
  transformSync(readFileSync('site/playground-presets.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code,
)(module, module.exports)

test('every browser preset compiles and renders through the bundled public runtime', () => {
  for (const preset of module.exports.presets) {
    const compiled = transformSync(preset.code, {
      loader: 'tsx',
      format: 'cjs',
      jsx: 'automatic',
      jsxImportSource: '@ketvietlab/ketjs-view',
    }).code
    const exports = { exports: {} }
    new Function('require', 'module', 'exports', compiled)(
      (name) => (name.endsWith('/jsx-runtime') ? jsx : view),
      exports,
      exports.exports,
    )
    const instance = exports.exports.default()
    const host = view.countingHost(),
      root = host.root()
    const mounted = view.mount(host, root, typeof instance === 'function' ? instance : instance.view)
    assert.match(host.html(root), /<h1>/, preset.id)
    if (preset.id === 'counter') {
      const find = (node) => (node.tag === 'button' ? node : node.children?.map(find).find(Boolean))
      host.fire(find(root), 'click', {})
      assert.match(host.html(root), /Count: 1/)
      mounted.dispose()
      host.fire(find(root), 'click', {})
      assert.match(host.html(root), /Count: 1/)
    } else mounted.dispose()
  }
})

test('user source cannot break out of the isolated preview script', () => {
  const html = previewDocument('throw new Error("</script><script>parent.pwned=true</script>")', {
    runtimeUrl: 'https://ketjs.dev/_vendor/playground/runtime.js',
    colors: ['white', 'black', 'gray', 'blue'],
    nonce: 'test',
  })
  assert.equal((html.match(/<script/g) ?? []).length, 2)
  assert.ok(!html.includes('<script>parent.pwned'))
  assert.match(html, /connect-src 'none'/)
  assert.throws(() => previewDocument('', { runtimeUrl: 'javascript:alert(1)', colors: [], nonce: 'test' }))
})
