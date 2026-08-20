import { cpus, platform, release } from 'node:os'
import { performance } from 'node:perf_hooks'
import { tableNameFor } from 'ketjs'
import type { Adapter, Row } from 'ketjs'
import { postgresAdapter } from 'ketjs-postgres'
import { createTestApp } from 'ketjs/testing'
import { ketsuite } from '../apps/ketsuite/app.ts'

const driver = process.env.KET_BENCH_DRIVER ?? 'sqlite'
const runs = Math.max(7, Number(process.env.KET_BENCH_RUNS ?? 7))
const caseCount = Number(process.env.KET_BENCH_CASES ?? 20_000)
if (!['sqlite', 'postgres'].includes(driver)) throw new Error('KET_BENCH_DRIVER must be sqlite or postgres')

type Metric = { label: string; operations: number; medianMs: number; p95Ms: number; throughput: number }
const metrics: Metric[] = []
const percentile = (values: number[], ratio: number) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * ratio))] ?? 0
const measure = async (label: string, operations: number, workload: (slot: number) => Promise<void>) => {
  await workload(0)
  const samples: number[] = []
  let elapsedTotal = 0
  for (let slot = 1; slot <= runs; slot++) {
    const started = performance.now()
    await workload(slot)
    const elapsed = performance.now() - started
    elapsedTotal += elapsed
    samples.push(elapsed / operations)
  }
  metrics.push({
    label,
    operations: operations * runs,
    medianMs: Number(percentile(samples, 0.5).toFixed(3)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
    throughput: Math.round((operations * runs * 1000) / elapsedTotal),
  })
}
const bulkInsert = async (adapter: Adapter, model: string, columns: string[], rows: unknown[][]) => {
  const quoted = columns.map((column) => adapter.quoteIdent(column)).join(', ')
  const target = adapter.quoteIdent(tableNameFor(model))
  const chunkSize = Math.max(1, Math.floor(20_000 / columns.length))
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize)
    let parameter = 0
    const placeholder = () => (adapter.name === 'postgres' ? `$${++parameter}` : (parameter++, '?'))
    const values = chunk.map((row) => `(${row.map(placeholder).join(', ')})`).join(', ')
    await adapter.run(`INSERT INTO ${target} (${quoted}) VALUES ${values}`, chunk.flat())
  }
}

const configured = process.env.KET_BENCH_PG ?? 'postgres://dev:devpassword@127.0.0.1:5435/postgres'
const adminUrl = new URL(configured)
adminUrl.pathname = '/postgres'
const database = `ket_crm_bench_${process.pid}`
const databaseUrl = new URL(adminUrl)
databaseUrl.pathname = `/${database}`
let admin: Adapter | null = null
if (driver === 'postgres') {
  admin = postgresAdapter(adminUrl.toString(), { max: 1 })
  await admin.open()
  await admin.exec(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
  await admin.exec(`CREATE DATABASE "${database}"`)
}
const appDefinition =
  driver === 'postgres'
    ? {
        ...ketsuite,
        serve: {
          ...ketsuite.serve,
          openStore: async (config: { databaseUrl?: string | null }) => {
            if (!config.databaseUrl) throw new Error('DATABASE_URL is required')
            const adapter = postgresAdapter(config.databaseUrl, { max: 1 })
            await adapter.open()
            return adapter
          },
        },
      }
    : ketsuite
const app = await createTestApp(appDefinition, {
  env: driver === 'postgres' ? { DATABASE_URL: databaseUrl.toString() } : {},
})
const scope = { company: 'bench', branches: null }
const fixture = (name: string, input: Record<string, unknown>) =>
  app.fixture.call<Row>(name, input, { scope })

try {
  await fixture('partner.savePartner', { id: 'bench-party', kind: 'company', name: 'Benchmark' })
  await fixture('partner.savePartner', { id: 'customer', kind: 'person', name: 'Benchmark customer' })
  await fixture('company.saveCompany', {
    id: 'bench',
    code: 'BENCH',
    partnerId: 'bench-party',
    currency: 'VND',
  })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    partnerId: 'customer',
    defaultCompanyId: 'bench',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:bench', userId: 'admin', companyId: 'bench' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  const call = async <T = Row>(name: string, input: Record<string, unknown> = {}) =>
    (await app.client.call<T>(name, input)).value
  await call('crm.bootstrap.defaults', { idempotencyKey: 'bench-defaults' })
  const adapter = app.adapter!
  const now = '2026-08-21T00:00:00.000Z'
  const rows = Array.from({ length: caseCount }, (_, index) => [
    'bench',
    `case:${index}`,
    index % 3 === 0 ? 'lead' : 'opportunity',
    `CRM record ${index}`,
    'customer',
    'crm-team-sales',
    index % 5 === 0 ? 'crm-stage-qualified' : 'crm-stage-new',
    String(index % 4),
    index % 11 === 0 ? `buyer${index}@example.test` : null,
    'open',
    1,
    1,
    String(index % 100),
    `thread:case:${index}`,
    'admin',
    now,
    now,
  ])
  await bulkInsert(
    adapter,
    'crm.Case',
    [
      'companyId',
      'id',
      'kind',
      'name',
      'partnerId',
      'teamId',
      'stageId',
      'priority',
      'email',
      'terminalState',
      'active',
      'version',
      'score',
      'threadId',
      'createdByUserId',
      'createdAt',
      'updatedAt',
    ],
    rows,
  )

  await measure('case list/filter page', 50, async (slot) => {
    await call('crm.case.list', { search: `CRM record ${slot}`, cursor: '0', limit: 50 })
  })
  await measure('case count', caseCount, async () => {
    await call('crm.case.count', { kind: 'opportunity' })
  })
  await measure('case grouping', caseCount, async () => {
    await call('crm.case.group', {
      listState: {
        presets: [],
        filters: [],
        groupBy: [{ key: 'kind' }],
        sort: [],
        openGroups: [],
        groupPages: {},
        page: 1,
        includeArchived: false,
      },
      timezone: 'Asia/Ho_Chi_Minh',
    })
  })
  await measure('pipeline stage page', 100, async () => {
    await call('crm.case.list', { stageId: 'crm-stage-new', cursor: '0', limit: 100 })
  })
  const sample = await call<Row>('crm.case.get', { id: 'case:1' })
  await measure('case detail', 1, async () => {
    await call('crm.case.get', { id: sample.id })
  })
  await measure('scoring refresh', 100, async (slot) => {
    for (let index = 0; index < 100; index++)
      await call('crm.case.refreshScore', {
        id: `case:${slot * 100 + index}`,
        idempotencyKey: `score:${slot}:${index}`,
      })
  })
  console.log(
    JSON.stringify(
      {
        benchmark: 'crm',
        driver,
        fixture: { cases: caseCount, warmup: 1, measuredRuns: runs },
        environment: {
          node: process.version,
          os: `${platform()} ${release()}`,
          cpu: cpus()[0]?.model ?? 'unknown',
        },
        metrics,
      },
      null,
      2,
    ),
  )
} finally {
  await app.close()
  if (admin) {
    await admin.exec(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
    await admin.close()
  }
}
