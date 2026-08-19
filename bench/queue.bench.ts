// Multi-database queue benchmark. This deliberately uses the public AppSpec,
// tenant and worker APIs rather than calling scheduler internals, so its numbers
// include the same pool, registry and round-robin path a deployment runs.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootWorker, createQueue, defineApp, defineModule, sqliteAdapter } from 'ketjs'
import { postgresAdapter } from 'ketjs-postgres'
import type { Adapter, JobContext } from 'ketjs'

const driver = process.env.KET_BENCH_DRIVER ?? 'sqlite'
const databaseCount = Number(process.env.KET_BENCH_DATABASES ?? (driver === 'postgres' ? 8 : 32))
const jobsPerDatabase = Number(process.env.KET_BENCH_JOBS ?? 100)
const concurrency = Number(process.env.KET_BENCH_CONCURRENCY ?? 8)
if (!Number.isInteger(databaseCount) || databaseCount < 2) throw new Error('KET_BENCH_DATABASES must be >= 2')
if (!Number.isInteger(jobsPerDatabase) || jobsPerDatabase < 1) throw new Error('KET_BENCH_JOBS must be >= 1')

const keys = Array.from(
  { length: databaseCount },
  (_, index) => `queue_bench_${String(index).padStart(3, '0')}`,
)
const seen = new Map<string, number>()
const firstAt = new Map<string, number>()
const module = defineModule({
  name: 'queue_bench',
  app: true,
  jobs: {
    measure: {
      input: { n: 'int' },
      idempotent: true,
      handler: async (ctx: JobContext) => {
        // Tenant correctness is asserted from the scope captured at enqueue.
        const key = ctx.scope.company as string
        seen.set(key, (seen.get(key) ?? 0) + 1)
        if (!firstAt.has(key)) firstAt.set(key, performance.now())
      },
    },
  },
})

let localDir: string | null = null
let admin: Adapter | null = null
const pgUrl = process.env.KET_BENCH_PG ?? 'postgres://dev:devpassword@127.0.0.1:5435/postgres'
const pgBase = pgUrl.replace(/\/[^/]*$/, '')

const open = (key: string): Adapter =>
  driver === 'postgres'
    ? postgresAdapter(`${pgBase}/${key}`, { max: 2 })
    : sqliteAdapter(join(localDir as string, `${key}.db`))

const prepareDatabases = async () => {
  if (driver === 'sqlite') {
    localDir = mkdtempSync(join(tmpdir(), 'ket-queue-bench-'))
    return
  }
  if (driver !== 'postgres') throw new Error('KET_BENCH_DRIVER must be sqlite or postgres')
  admin = postgresAdapter(pgUrl, { max: 1 })
  await admin.open()
  for (const key of keys) {
    await admin.exec(`DROP DATABASE IF EXISTS "${key}" WITH (FORCE)`)
    await admin.exec(`CREATE DATABASE "${key}"`)
  }
}

const cleanup = async () => {
  if (admin) {
    for (const key of keys) await admin.exec(`DROP DATABASE IF EXISTS "${key}" WITH (FORCE)`)
    await admin.close()
  }
  if (localDir) rmSync(localDir, { recursive: true, force: true })
}

await prepareDatabases()
try {
  const app = defineApp({
    name: 'queue_benchmark',
    modules: [module],
    headless: true,
    serve: {
      bootstrap: ['queue_bench'],
      tenants: {
        resolve: () => null,
        open,
        list: async () => keys,
        max: concurrency,
      },
    },
    worker: { queues: { default: concurrency }, pollMinMs: 100, pollMaxMs: 2_000 },
  })
  const worker = await bootWorker(app, {
    env: { KET_QUEUE_NOTIFY: '0' },
    log: () => {},
  })

  // Warm migrations, app registries and pool before timing queue throughput.
  await worker.runOnce()
  const enqueueStarted = performance.now()
  for (const key of keys) {
    const adapter = open(key)
    await adapter.open()
    const queue = await createQueue(adapter, { notify: false })
    await Promise.all(
      Array.from({ length: jobsPerDatabase }, (_, n) =>
        queue.enqueue(
          'queue_bench.measure',
          { n },
          {
            queue: 'default',
            scope: { company: key },
            uniqueKey: String(n),
          },
        ),
      ),
    )
    await adapter.close()
  }
  const enqueueMs = performance.now() - enqueueStarted

  const runStarted = performance.now()
  const claimed = await worker.drain()
  const runMs = performance.now() - runStarted
  await worker.close()

  const expected = databaseCount * jobsPerDatabase
  if (claimed !== expected) throw new Error(`claimed ${claimed}/${expected} jobs`)
  for (const key of keys)
    if (seen.get(key) !== jobsPerDatabase)
      throw new Error(`${key} executed ${seen.get(key) ?? 0}/${jobsPerDatabase} jobs`)
  const first = [...firstAt.values()]
  const fairnessSpreadMs = Math.max(...first) - Math.min(...first)
  console.log(
    JSON.stringify(
      {
        driver,
        databases: databaseCount,
        jobs: expected,
        concurrency,
        enqueueMs: Number(enqueueMs.toFixed(1)),
        enqueuePerSecond: Math.round((expected * 1_000) / enqueueMs),
        executeMs: Number(runMs.toFixed(1)),
        executePerSecond: Math.round((expected * 1_000) / runMs),
        firstJobFairnessSpreadMs: Number(fairnessSpreadMs.toFixed(1)),
        perDatabaseComplete: true,
      },
      null,
      2,
    ),
  )
} finally {
  await cleanup()
}
