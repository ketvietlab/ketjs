// Bundle the installed KetJS translator for a browser import map. Do not fork it.
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const ket = dirname(fileURLToPath(import.meta.resolve('@ketvietlab/ketjs')))
await build({
  entryPoints: [resolve(ket, 'kernel/i18n.js')],
  outfile: resolve(root, 'demo/vendor/ketjs-i18n.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2023',
})
// Public LiveDoc entry, including its Yjs binding; do not bundle a second view runtime.
await build({
  entryPoints: ['@ketvietlab/ketsuite/livedoc'],
  outfile: resolve(root, 'demo/vendor/live-doc.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2023',
  external: ['@ketvietlab/ketjs-view', '@ketvietlab/ketjs-view/*'],
})
