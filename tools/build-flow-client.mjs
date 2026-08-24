// Bundles the Flow collaborative editor's client-side TypeScript (which
// imports yjs/y-protocols, real npm dependencies) into one self-contained ESM
// file the framework can serve verbatim. Nothing else in this repo needs a
// bundler — client islands elsewhere are hand-written, dependency-free .mjs —
// so this is scoped to exactly the one module that needs it, not folded into
// a general-purpose bundling step.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MODULE_DIR = join(ROOT, 'packages/ketsuite/src/modules/flow_backend')
const ENTRY = join(MODULE_DIR, 'client-src/editor-client.mjs')
const OUTFILE = join(MODULE_DIR, 'client/editor.mjs')

export async function buildFlowClient() {
  if (!existsSync(ENTRY)) return false
  await esbuild.build({
    entryPoints: [ENTRY],
    outfile: OUTFILE,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    sourcemap: true,
    logLevel: 'warning',
    // The view runtime is served by the framework at this fixed path (see
    // packages/ketsuite/src/modules/backend/islands.ts's relation-select
    // island for the same convention) — bundling it in would duplicate
    // ketjs-view into every module that ships a client island.
    external: ['/_ket/view/index.js'],
  })
  return true
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const built = await buildFlowClient()
  console.log(
    built ? `bundled flow_backend client into ${OUTFILE}` : 'flow_backend has no client entry yet, skipped',
  )
}
