// Four processes balance each framework's position in the sequential measurement order.
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { arch, cpus, platform, release, totalmem } from 'node:os'

const destination = 'packages/docs/measurements'
const raw = []
for (let run = 0; run < 4; run++) {
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
const median = (numbers) => {
  const sorted = [...numbers].sort((a, b) => a - b)
  return (sorted[1] + sorted[2]) / 2
}
const groups = new Map()
for (const sample of raw) {
  const key = `${sample.framework}:${sample.rows}`
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(sample)
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
  processes: 4,
  mode: 'production',
  metric:
    'SSR element creation, escaping and full HTML serialization; awaited public render API; warm imports; no HTTP or browser work',
  measurements,
}
writeFileSync(`${destination}/ssr-comparison.json`, JSON.stringify(report, null, 2) + '\n')
console.log('Saved SSR medians, ranges, versions and environment')
