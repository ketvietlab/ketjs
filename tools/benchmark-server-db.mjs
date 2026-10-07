// Own one disposable PostgreSQL container and only its uniquely named scratch databases.
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import postgres from 'postgres'

/**
 * One JSON line printed by a bench/ssr-comparison fixture, tagged with its run. The database fixture
 * prints millisecondsPerOperation and the server fixture the latencies; each is read only for its fixture.
 * @typedef {{
 *   framework: string,
 *   engine: string,
 *   operation?: string,
 *   path?: string,
 *   perSecond: number,
 *   millisecondsPerOperation: number,
 *   medianLatencyMs: number,
 *   p95LatencyMs: number,
 *   run: number,
 * }} Sample
 */

const name = `ketjs-benchmark-${process.pid}-${Date.now()}`
const destination = '.artifacts/benchmarks'
mkdirSync(destination, { recursive: true })
let created = false
try {
  execFileSync(
    'docker',
    [
      'run',
      '--pull=never',
      '--rm',
      '-d',
      '--name',
      name,
      '-e',
      'POSTGRES_PASSWORD=benchmark-only',
      '-p',
      '127.0.0.1::5432',
      'postgres:17.10-alpine',
    ],
    { stdio: 'pipe' },
  )
  created = true
  const port = execFileSync('docker', ['port', name, '5432/tcp'], { encoding: 'utf8' })
    .trim()
    .split(':')
    .at(-1)
  const url = `postgres://postgres:benchmark-only@127.0.0.1:${port}/postgres`
  let ready = false
  for (let attempt = 0; attempt < 40; attempt++) {
    const admin = postgres(url, { max: 1, connect_timeout: 1 })
    try {
      await admin.unsafe('SELECT 1')
      ready = true
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    } finally {
      await admin.end({ timeout: 1 })
    }
  }
  if (!ready) throw new Error('Owned PostgreSQL benchmark container did not become ready')
  for (const [fixture, runs] of /** @type {[string, number][]} */ ([
    ['database', 4],
    ['server', 4],
  ])) {
    /** @type {Sample[]} */
    const raw = []
    for (let run = 0; run < runs; run++) {
      const result = spawnSync(process.execPath, [`bench/ssr-comparison/${fixture}.mjs`, String(run)], {
        encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'production', KET_BENCH_PG: url },
        timeout: 120000,
      })
      writeFileSync(`${destination}/${fixture}-comparison-${run + 1}.txt`, result.stdout)
      writeFileSync(`${destination}/${fixture}-comparison-${run + 1}.stderr.txt`, result.stderr)
      if (result.status !== 0)
        throw new Error(`${fixture} run ${run + 1} failed: ${result.stderr.slice(0, 1500)}`)
      raw.push(
        ...result.stdout
          .trim()
          .split('\n')
          .map((line) => ({ ...JSON.parse(line), run: run + 1 })),
      )
      console.log(`${fixture} run ${run + 1}: passed`)
    }
    const median = (/** @type {number[]} */ values) => {
      const sorted = [...values].sort((a, b) => a - b)
      return (sorted[1] + sorted[2]) / 2
    }
    /** @type {Map<string, Sample[]>} */
    const groups = new Map()
    for (const sample of raw) {
      const key = `${sample.framework}:${sample.engine}:${sample.operation ?? sample.path}`
      const group = groups.get(key)
      if (group) group.push(sample)
      else groups.set(key, [sample])
    }
    const measurements = [...groups.values()].map((samples) => ({
      ...samples[0],
      run: undefined,
      milliseconds: undefined,
      perSecond: undefined,
      millisecondsPerOperation: undefined,
      medianPerSecond: median(samples.map((sample) => sample.perSecond)),
      medianMillisecondsPerOperation:
        fixture === 'database' ? median(samples.map((sample) => sample.millisecondsPerOperation)) : undefined,
      medianLatencyMs:
        fixture === 'server' ? median(samples.map((sample) => sample.medianLatencyMs)) : undefined,
      medianP95LatencyMs:
        fixture === 'server' ? median(samples.map((sample) => sample.p95LatencyMs)) : undefined,
      p95LatencyMs: undefined,
      minPerSecond: Math.min(...samples.map((sample) => sample.perSecond)),
      maxPerSecond: Math.max(...samples.map((sample) => sample.perSecond)),
    }))
    const hash = createHash('sha256')
    for (const path of [
      `bench/ssr-comparison/${fixture}.mjs`,
      'bench/ssr-comparison/database.mjs',
      'bench/ssr-comparison/package-lock.json',
      'packages/ketjs/dist/data/sqlite.js',
      'packages/ketjs/dist/server/http.js',
      'packages/ketjs-postgres/dist/postgres.js',
    ])
      hash.update(readFileSync(path))
    const report = {
      date: new Date().toISOString(),
      node: process.version,
      cpu: cpus()[0].model,
      logicalCPUs: cpus().length,
      memoryBytes: totalmem(),
      platform: platform(),
      release: release(),
      arch: arch(),
      fixtureSha256: hash.digest('hex'),
      processes: runs,
      postgresImage: 'postgres:17.10-alpine',
      metric:
        fixture === 'database'
          ? 'Actual on-disk database operations, not query compilation'
          : 'Loopback HTTP/1.1 with 16 keep-alive clients, same KetJS adapter and SQL for every server; includes client parsing and assertions; no authentication or domain functions',
      measurements,
    }
    writeFileSync(`${destination}/${fixture}-comparison.json`, JSON.stringify(report, null, 2) + '\n')
  }
  const admin = postgres(url, { max: 1 })
  try {
    const databases = await admin.unsafe("SELECT datname FROM pg_database WHERE datname LIKE 'ketjs_bench_%'")
    if (databases.length) throw new Error('Scratch database cleanup was incomplete')
  } finally {
    await admin.end({ timeout: 5 })
  }
} finally {
  if (created) {
    execFileSync('docker', ['stop', name], { stdio: 'pipe' })
    console.log('Owned PostgreSQL benchmark container removed')
  }
}
