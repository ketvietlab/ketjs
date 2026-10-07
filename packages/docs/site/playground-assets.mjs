import { buildSync } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'

export function preparePlayground() {
  const dir = 'public/_vendor/playground'
  mkdirSync(dir, { recursive: true })
  buildSync({
    entryPoints: ['node_modules/esbuild-wasm/lib/browser.js'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    minify: true,
    outfile: `${dir}/compiler.js`,
  })
  buildSync({
    stdin: {
      contents: `import * as view from '@ketvietlab/ketjs-view'; import * as jsx from '@ketvietlab/ketjs-view/jsx-runtime'; export {view, jsx};`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'iife',
    globalName: 'KetPlayground',
    platform: 'browser',
    minify: true,
    outfile: `${dir}/runtime.js`,
  })
  copyFileSync('node_modules/esbuild-wasm/esbuild.wasm', `${dir}/esbuild.wasm`)
  copyFileSync('node_modules/esbuild-wasm/LICENSE.md', `${dir}/esbuild-LICENSE.md`)
}
