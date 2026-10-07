// Run independently built framework benchmarks serially and preserve their evidence.
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { cpus, arch, platform, release, totalmem } from 'node:os'
import { join } from 'node:path'

const output = 'packages/docs/measurements'
mkdirSync(output, { recursive: true })
const hash = createHash('sha256')
const digest = (path) => {
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const file = join(path, entry.name)
    if (entry.isDirectory()) digest(file)
    else {
      hash.update(file)
      hash.update(readFileSync(file))
    }
  }
}
for (const path of ['packages/ketjs/src', 'packages/ketjs-view/src', 'packages/ketjs-postgres/src', 'bench'])
  digest(path)
writeFileSync(
  `${output}/environment.json`,
  JSON.stringify(
    {
      date: new Date().toISOString(),
      version: JSON.parse(readFileSync('packages/ketjs/package.json')).version,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sourceSha256: hash.digest('hex'),
      node: process.version,
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0].model,
      logicalCPUs: cpus().length,
      memoryBytes: totalmem(),
      independentRuns: 3,
    },
    null,
    2,
  ) + '\n',
)
for (const name of ['view', 'framework', 'i18n', 'module-path', 'queue']) {
  const path = `.build/bench/${name}.bench.js`
  if (!existsSync(path)) throw new Error(`Missing ${path}; build the framework first`)
  for (let run = 1; run <= 3; run++) {
    const result = spawnSync(process.execPath, [path], {
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, KET_BENCH_DRIVER: 'sqlite' },
    })
    writeFileSync(`${output}/${name}-${run}.txt`, result.stdout)
    writeFileSync(`${output}/${name}-${run}.stderr.txt`, result.stderr)
    if (result.status !== 0) throw new Error(`${name} run ${run} failed (${result.status}): ${result.stderr}`)
    console.log(`${name} run ${run}: passed`)
  }
}
