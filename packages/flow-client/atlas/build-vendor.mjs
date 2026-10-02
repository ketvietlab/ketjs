// Bundle the installed KetJS translator and the public LiveDoc entry for the Atlas import map. Do not fork them.
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const out = fileURLToPath(new URL('./vendor/', import.meta.url))
const ket = dirname(fileURLToPath(import.meta.resolve('@ketvietlab/ketjs')))
await build({
  entryPoints: [resolve(ket, 'kernel/i18n.js')],
  outfile: resolve(out, 'ketjs-i18n.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2023',
})
// Includes the Yjs binding; do not bundle a second view runtime.
await build({
  entryPoints: [fileURLToPath(import.meta.resolve('@ketvietlab/ketsuite/livedoc'))],
  outfile: resolve(out, 'live-doc.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2023',
  external: ['@ketvietlab/ketjs-view', '@ketvietlab/ketjs-view/*'],
})
