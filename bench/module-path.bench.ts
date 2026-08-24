// Module-path startup cost: scan a realistically broad catalogue, but execute only
// one selected dependency closure. Setup writes are outside the timed region.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { resolveWorkspace } from '@ketvietlab/ketjs'

const CANDIDATES = 250
const SELECTED = 40
const RUNS = 25
const root = mkdtempSync(join(tmpdir(), 'ket-module-bench-'))
const addons = join(root, 'addons')
mkdirSync(addons)

const body = (name: string, dependency: string | null) => `
export default Object.freeze({
  kind: 'module', name: ${JSON.stringify(name)}, version: '1.0.0',
  depends: Object.freeze(${JSON.stringify(dependency ? [dependency] : [])}),
  models: {}, extend: {}, joints: {}, fills: {}, functions: {}, jobs: {}, views: {},
  requires: Object.freeze([]), tokens: {}, templates: {}, provides: Object.freeze([]),
  assets: null, styles: Object.freeze([]), routes: {}, menus: {}, omits: Object.freeze([]),
  islands: {}, sections: {}, relations: {}, title: ${JSON.stringify(name)},
  summary: '', category: 'Benchmark', messages: {},
})
`

try {
  for (let index = 0; index < CANDIDATES; index++) {
    const name = `bench_${String(index).padStart(3, '0')}`
    const path = join(addons, name)
    mkdirSync(path)
    writeFileSync(join(path, 'ket.module.json'), JSON.stringify({ name, entry: './index.mjs' }))
    // An unselected module throwing proves discovery did not execute the other 210.
    writeFileSync(
      join(path, 'index.mjs'),
      index < SELECTED
        ? body(name, index ? `bench_${String(index - 1).padStart(3, '0')}` : null)
        : 'throw new Error("unselected benchmark module executed")',
    )
  }

  const declaration = {
    modulePaths: [addons],
    deployments: [
      {
        name: 'bench',
        modules: [`bench_${String(SELECTED - 1).padStart(3, '0')}`],
        headless: true,
      },
    ],
  }
  const options = { baseUrl: pathToFileURL(join(root, 'ket.workspace.js')) }
  const started = performance.now()
  const cold = await resolveWorkspace(declaration, options)
  const coldMs = performance.now() - started
  assert.equal(cold.deployments[0]!.modules.length, SELECTED)
  assert.equal(cold.modules.length, SELECTED)

  const samples: number[] = []
  for (let run = 0; run < RUNS; run++) {
    const before = performance.now()
    const warm = await resolveWorkspace(declaration, options)
    samples.push(performance.now() - before)
    assert.equal(warm.deployments[0]!.modules.length, SELECTED)
  }
  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)] as number
  const p95 = samples[Math.floor(samples.length * 0.95)] as number

  console.log(`module-path candidates=${CANDIDATES} selected=${SELECTED}`)
  console.log(`cold resolve : ${coldMs.toFixed(2)} ms`)
  console.log(`warm median : ${median.toFixed(2)} ms`)
  console.log(`warm p95    : ${p95.toFixed(2)} ms`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
