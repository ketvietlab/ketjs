// PostgreSQL benchmark for the Company/Branch slice of the identity stack.
// Schema setup, fixture creation and password hashing are excluded from timings.

import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { callFn, compose, planMigration, registerFunctions, renderSql, schemaFromManifest } from 'ketjs'
import { postgresAdapter } from 'ketjs-postgres'
import * as shippedSuite from 'ketsuite'

const url = process.env.KET_BENCH_PG
if (!url) throw new Error('set KET_BENCH_PG to an explicit PostgreSQL benchmark database')

type Suite = typeof shippedSuite
const suite = process.env.KET_BENCH_KETSUITE_MODULE
  ? ((await import(pathToFileURL(process.env.KET_BENCH_KETSUITE_MODULE).href)) as Suite)
  : shippedSuite
const modules = [suite.address, suite.partner, suite.company, suite.user]
const manifest = compose(modules, { headless: true })
const scope = { company: 'company-a', branch: 'root:company-a', branches: null }
const adapter = postgresAdapter(url)
const call = (name: string, args: Record<string, unknown>) =>
  callFn(name, args, { adapter, manifest, scope, actor: 'bench-user' })

const percentile = (samples: number[], ratio: number): number => {
  const ordered = [...samples].sort((a, b) => a - b)
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))] ?? 0
}

const measure = async (label: string, count: number, run: (index: number) => Promise<void>) => {
  for (let index = 0; index < Math.min(20, count); index++) await run(index)
  const samples: number[] = []
  const started = performance.now()
  for (let index = 0; index < count; index++) {
    const before = performance.now()
    await run(index)
    samples.push(performance.now() - before)
  }
  const elapsed = performance.now() - started
  console.log(
    `${label.padEnd(38)} p50=${percentile(samples, 0.5).toFixed(3)}ms  p95=${percentile(samples, 0.95).toFixed(3)}ms  throughput=${((count / elapsed) * 1000).toFixed(0)} ops/s`,
  )
}

await adapter.open()
try {
  const schema = schemaFromManifest(manifest)
  for (const tableName of Object.keys(schema.tables))
    await adapter.exec(`DROP TABLE IF EXISTS "${tableName}" CASCADE`)
  for (const sql of renderSql(planMigration(null, schema), adapter)) await adapter.exec(sql)
  registerFunctions(modules)

  for (const [id, code, name] of [
    ['company-a', 'KET', 'Kết Việt'],
    ['company-b', 'GLX', 'Globex'],
  ] as const) {
    await call('partner.savePartner', { id: `partner:${id}`, kind: 'company', name })
    await call('company.saveCompany', {
      id,
      ...('code' in (manifest.functions['company.saveCompany']?.input ?? {}) ? { code } : {}),
      partnerId: `partner:${id}`,
      currency: 'VND',
    })
  }
  await call('user.createUser', {
    id: 'bench-user',
    login: 'bench-admin',
    password: 'benchmark-password',
    name: 'Benchmark administrator',
    defaultCompanyId: 'company-a',
    ...('defaultBranchId' in (manifest.functions['user.createUser']?.input ?? {})
      ? { defaultBranchId: 'root:company-a' }
      : {}),
  })
  await call('user.grantCompany', {
    id: 'membership:a',
    userId: 'bench-user',
    companyId: 'company-a',
  })
  await call('user.grantCompany', {
    id: 'membership:b',
    userId: 'bench-user',
    companyId: 'company-b',
  })

  await measure('list two companies', 300, async () => {
    await call('company.listCompanies', {})
  })
  await measure('authenticate with two companies', 30, async () => {
    await call('user.authenticate', { login: 'bench-admin', password: 'benchmark-password' })
  })
  await measure('idempotent company grant', 300, async (index) => {
    await call('user.grantCompany', {
      id: `repeat-membership:${index}`,
      userId: 'bench-user',
      companyId: 'company-a',
    })
  })

  if (manifest.functions['user.resolveSessionContext']) {
    const context = {
      userId: 'bench-user',
      companyId: 'company-a',
      branchId: 'root:company-a',
      companies: ['company-a', 'company-b'],
      branches: ['root:company-a', 'root:company-b'],
    }
    await measure('resolve live session context', 300, async () => {
      await call('user.resolveSessionContext', context)
    })
    await measure('validate requested context', 300, async () => {
      await call('user.prepareContext', context)
    })
  } else {
    console.log('live session context'.padEnd(38), 'not available in baseline')
  }
} finally {
  await adapter.close()
}
