// Builds the public package stylesheet from its canonical CSS import graph.
//
// Consumers resolve @ketvietlab/design-system/styles.css directly. Keeping the
// bundle in the design-system package (rather than copying it into KetSuite)
// preserves one source of truth and gives the complete graph one cache identity.

import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'packages/design-system/src/styles.css')

export async function buildDesignSystemStyles(output) {
  await mkdir(dirname(output), { recursive: true })
  await esbuild.build({
    entryPoints: [SOURCE],
    bundle: true,
    outfile: output,
    minify: true,
    platform: 'browser',
    target: 'es2022',
    banner: {
      css: '/* Generated from @ketvietlab/design-system/src/styles.css — do not edit. */',
    },
    logLevel: 'warning',
  })
  return output
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const output = join(ROOT, 'packages/design-system/dist/styles.css')
  await buildDesignSystemStyles(output)
  console.log('built public design-system stylesheet')
}
