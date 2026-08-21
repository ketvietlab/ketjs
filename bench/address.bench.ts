// PostgreSQL benchmark for lazy catalog import, hierarchy reads, validation,
// formatting and the Partner integration. Migration and fixture setup are not
// included in request latency samples.

import { performance } from 'node:perf_hooks'
import {
  callFn,
  compose,
  planMigration,
  registerFunctions,
  renderSql,
  schemaFromManifest,
} from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { address, partner } from '@ketvietlab/ketsuite'

const url = process.env.KET_BENCH_PG
if (!url) throw new Error('set KET_BENCH_PG to an explicit PostgreSQL benchmark database')

const modules = [address, partner]
const manifest = compose(modules, { headless: true })
const scope = { company: 'bench', branch: 'main', branches: null }
const adapter = postgresAdapter(url, { max: 4 })
const call = (name: string, input: Record<string, unknown> = {}) =>
  callFn(name, input, { adapter, manifest, scope }).then((result) => result.value as Row)

const percentile = (samples: readonly number[], ratio: number): number => {
  const ordered = [...samples].sort((a, b) => a - b)
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))] ?? 0
}

const measure = async (label: string, count: number, run: () => Promise<unknown>) => {
  for (let index = 0; index < 20; index++) await run()
  const samples: number[] = []
  const started = performance.now()
  for (let index = 0; index < count; index++) {
    const before = performance.now()
    await run()
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

  const importStarted = performance.now()
  const installed = await call('address.installCatalog', { countryCode: 'VN' })
  const importMs = performance.now() - importStarted
  if (installed.ok !== true || installed.recordCount !== 3_355)
    throw new Error(`Vietnam catalog installation failed: ${JSON.stringify(installed)}`)
  console.log(`install VN / 3,355 divisions`.padEnd(38), `${importMs.toFixed(3)}ms setup`)

  await call('partner.savePartner', { id: 'partner', kind: 'company', name: 'Benchmark partner' })
  await call('partner.saveAddress', {
    id: 'address',
    partnerId: 'partner',
    use: 'delivery',
    street1: '12 Nguyễn Huệ',
    countryId: 'VN',
    divisionId: 'VN:2025-07-01:10101003',
    isDefault: true,
  })

  await measure('list 34 province-level roots', 200, () =>
    call('address.listDivisionChildren', { countryCode: 'VN', limit: 1000 }),
  )
  await measure('list Hanoi lower-level divisions', 200, () =>
    call('address.listDivisionChildren', {
      countryCode: 'VN',
      parentId: 'VN:2025-07-01:01',
      limit: 1000,
    }),
  )
  await measure('validate and format canonical address', 300, () =>
    call('address.format', {
      street1: '12 Nguyễn Huệ',
      countryId: 'VN',
      divisionId: 'VN:2025-07-01:10101003',
    }),
  )
  await measure('read partner with canonical address', 300, () =>
    call('partner.getPartner', { id: 'partner' }),
  )
} finally {
  await adapter.close()
}
