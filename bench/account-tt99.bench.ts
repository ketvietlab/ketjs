import { performance } from 'node:perf_hooks'
import {
  callFn,
  compose,
  planMigration,
  registerFunctions,
  renderSql,
  schemaFromManifest,
} from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { account, address, company, partner, product, uom } from '@ketvietlab/ketsuite'

const url = process.env.KET_BENCH_PG
if (!url) throw new Error('set KET_BENCH_PG to an explicit PostgreSQL benchmark database')

const modules = [address, partner, company, uom, product, account]
const manifest = compose(modules, { headless: true })
const adapter = postgresAdapter(url, { max: 8 })

const percentile = (samples: readonly number[], ratio: number): number => {
  const ordered = [...samples].sort((a, b) => a - b)
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))] ?? 0
}

const report = (label: string, samples: readonly number[]) => {
  const elapsed = samples.reduce((sum, sample) => sum + sample, 0)
  console.log(
    `${label.padEnd(36)} p50=${percentile(samples, 0.5).toFixed(3)}ms  p95=${percentile(samples, 0.95).toFixed(3)}ms  throughput=${((samples.length / elapsed) * 1000).toFixed(1)} ops/s`,
  )
}

const call = (companyId: string, name: string, input: Record<string, unknown> = {}, db: Adapter = adapter) =>
  callFn(name, input, {
    adapter: db,
    manifest,
    scope: { company: companyId, branches: null },
    actor: 'benchmark-operator',
  })

const createCompany = async (companyId: string) => {
  await call(companyId, 'partner.savePartner', {
    id: `${companyId}:party`,
    kind: 'company',
    name: `Benchmark ${companyId}`,
  })
  await call(companyId, 'company.saveCompany', {
    id: companyId,
    partnerId: `${companyId}:party`,
    currency: 'VND',
  })
}

await adapter.open()
try {
  const schema = schemaFromManifest(manifest)
  for (const tableName of Object.keys(schema.tables))
    await adapter.exec(`DROP TABLE IF EXISTS "${tableName}" CASCADE`)
  for (const sql of renderSql(planMigration(null, schema), adapter)) await adapter.exec(sql)
  registerFunctions(modules)

  const setupSamples: number[] = []
  for (let index = 0; index < 20; index++) {
    const companyId = `setup-${index}`
    await createCompany(companyId)
    const before = performance.now()
    await call(companyId, 'account.initializeCompany')
    setupSamples.push(performance.now() - before)
  }
  report('initialize TT99 / 216 accounts', setupSamples)

  const warmSamples: number[] = []
  for (let index = 0; index < 100; index++) {
    const before = performance.now()
    await call('setup-0', 'account.listAccounts')
    warmSamples.push(performance.now() - before)
  }
  report('warm list / 216 accounts', warmSamples)

  const concurrentIds = Array.from({ length: 8 }, (_, index) => `parallel-${index}`)
  for (const companyId of concurrentIds) await createCompany(companyId)
  const concurrentStarted = performance.now()
  await Promise.all(concurrentIds.map((companyId) => call(companyId, 'account.initializeCompany')))
  const concurrentElapsed = performance.now() - concurrentStarted
  console.log(
    `${'initialize 8 companies concurrently'.padEnd(36)} total=${concurrentElapsed.toFixed(3)}ms  throughput=${((concurrentIds.length / concurrentElapsed) * 1000).toFixed(1)} companies/s`,
  )
} finally {
  await adapter.close()
}
