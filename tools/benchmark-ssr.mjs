// One process per framework: run.mjs rotates the order, so each framework runs once in every position.
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { arch, cpus, platform, release, totalmem } from 'node:os'

const destination = '.artifacts/benchmarks'
const processes = 6
mkdirSync(destination, { recursive: true })
/**
 * One JSON line printed by bench/ssr-comparison/run.mjs, tagged with its run.
 * @typedef {{
 *   framework: string,
 *   version: string,
 *   rows: number,
 *   iterations: number,
 *   perSecond: number,
 *   millisecondsPerRender: number,
 *   outputBytes: number,
 *   run: number,
 * }} Sample
 */
/** @type {Sample[]} */
const raw = []
for (let run = 0; run < processes; run++) {
  const result = spawnSync(process.execPath, ['bench/ssr-comparison/run.mjs', String(run)], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production' },
    timeout: 120000,
  })
  writeFileSync(`${destination}/ssr-comparison-${run + 1}.txt`, result.stdout)
  writeFileSync(`${destination}/ssr-comparison-${run + 1}.stderr.txt`, result.stderr)
  if (result.status !== 0)
    throw new Error(`SSR comparison ${run + 1} failed: ${result.stderr.slice(0, 1000)}`)
  raw.push(
    ...result.stdout
      .trim()
      .split('\n')
      .map((line) => ({ ...JSON.parse(line), run: run + 1 })),
  )
  console.log(`SSR comparison ${run + 1}: output equivalence and timing passed`)
}
const median = (/** @type {number[]} */ numbers) => {
  const sorted = [...numbers].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
/** @type {Map<string, Sample[]>} */
const groups = new Map()
for (const sample of raw) {
  const key = `${sample.framework}:${sample.rows}`
  const group = groups.get(key)
  if (group) group.push(sample)
  else groups.set(key, [sample])
}
const measurements = [...groups.values()].map((samples) => ({
  framework: samples[0].framework,
  version: samples[0].version,
  rows: samples[0].rows,
  iterations: samples[0].iterations,
  medianPerSecond: median(samples.map((sample) => sample.perSecond)),
  medianMillisecondsPerRender: median(samples.map((sample) => sample.millisecondsPerRender)),
  minMillisecondsPerRender: Math.min(...samples.map((sample) => sample.millisecondsPerRender)),
  maxMillisecondsPerRender: Math.max(...samples.map((sample) => sample.millisecondsPerRender)),
  outputBytes: samples[0].outputBytes,
}))
const hash = createHash('sha256')
for (const path of [
  'bench/ssr-comparison/run.mjs',
  'bench/ssr-comparison/components/ProductList.svelte',
  'bench/ssr-comparison/components/ProductList.astro',
  'bench/ssr-comparison/package.json',
  'bench/ssr-comparison/package-lock.json',
  'packages/ketjs-view/dist/jsx-runtime.js',
  'packages/ketjs-view/dist/index.js',
])
  hash.update(readFileSync(path))
const report = {
  date: new Date().toISOString(),
  node: process.version,
  platform: platform(),
  release: release(),
  arch: arch(),
  cpu: cpus()[0].model,
  logicalCPUs: cpus().length,
  memoryBytes: totalmem(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  fixtureSha256: hash.digest('hex'),
  processes,
  mode: 'production',
  metric:
    'SSR element creation, escaping and full HTML serialization; awaited public render API; warm imports; no HTTP or browser work',
  measurements,
}
writeFileSync(`${destination}/ssr-comparison.json`, JSON.stringify(report, null, 2) + '\n')
console.log('Saved SSR medians, ranges, versions and environment')
