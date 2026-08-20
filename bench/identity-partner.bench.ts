// PostgreSQL benchmark for the Partner slice of the identity stack.
// Setup and migration are excluded; only public function calls are measured.

import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { callFn, compose, registerFunctions, renderSql, planMigration, schemaFromManifest } from 'ketjs'
import { postgresAdapter } from 'ketjs-postgres'
import { partner as shippedPartner } from 'ketsuite'

const url = process.env.KET_BENCH_PG
if (!url) throw new Error('set KET_BENCH_PG to an explicit PostgreSQL benchmark database')

const partner = process.env.KET_BENCH_PARTNER_MODULE
  ? (await import(pathToFileURL(process.env.KET_BENCH_PARTNER_MODULE).href)).default
  : shippedPartner
const modules = [partner]
const manifest = compose(modules, { headless: true })
const scope = { company: 'bench', branch: 'main', branches: null }
const adapter = postgresAdapter(url)
const call = (name: string, args: Record<string, unknown>) => callFn(name, args, { adapter, manifest, scope })

const percentile = (samples: number[], ratio: number): number => {
  const ordered = [...samples].sort((a, b) => a - b)
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))] ?? 0
}

const measure = async (label: string, count: number, run: (index: number) => Promise<void>) => {
  for (let index = 0; index < 20; index++) await run(index)
  const samples: number[] = []
  const started = performance.now()
  for (let index = 0; index < count; index++) {
    const before = performance.now()
    await run(index)
    samples.push(performance.now() - before)
  }
  const elapsed = performance.now() - started
  console.log(
    `${label.padEnd(34)} p50=${percentile(samples, 0.5).toFixed(3)}ms  p95=${percentile(samples, 0.95).toFixed(3)}ms  throughput=${((count / elapsed) * 1000).toFixed(0)} ops/s`,
  )
}

await adapter.open()
try {
  const schema = schemaFromManifest(manifest)
  for (const tableName of Object.keys(schema.tables))
    await adapter.exec(`DROP TABLE IF EXISTS "${tableName}" CASCADE`)
  for (const sql of renderSql(planMigration(null, schema), adapter)) await adapter.exec(sql)
  registerFunctions(modules)

  for (let index = 0; index < 500; index++)
    await call('partner.savePartner', {
      id: `partner-${index}`,
      kind: index % 4 === 0 ? 'person' : 'company',
      name: `Partner ${String(index).padStart(4, '0')}`,
      email: `partner-${index}@example.test`,
      phone: `0900${String(index).padStart(6, '0')}`,
    })
  await call('partner.saveAddress', {
    id: 'invoice-a',
    partnerId: 'partner-1',
    use: 'invoice',
    street: 'A',
    city: 'Hà Nội',
    country: 'VN',
    isDefault: true,
  })
  await call('partner.saveAddress', {
    id: 'invoice-b',
    partnerId: 'partner-1',
    use: 'invoice',
    street: 'B',
    city: 'Hà Nội',
    country: 'VN',
    isDefault: true,
  })
  await call('partner.grantRole', {
    id: 'customer-role',
    partnerId: 'partner-1',
    role: 'customer',
  })

  const listInput = manifest.functions['partner.listPartners']?.input ?? {}
  const listArgs = 'limit' in listInput ? { limit: 30, offset: 0 } : {}
  await measure('list first page / 500 seeded', 100, async () => {
    await call('partner.listPartners', listArgs)
  })
  await measure('read partner detail', 300, async () => {
    await call('partner.getPartner', { id: 'partner-1' })
  })
  await measure('idempotent role grant', 300, async (index) => {
    await call('partner.grantRole', {
      id: `repeat-role-${index}`,
      partnerId: 'partner-1',
      role: 'customer',
    })
  })
  await measure('switch default address', 300, async (index) => {
    const id = index % 2 === 0 ? 'invoice-a' : 'invoice-b'
    await call('partner.saveAddress', {
      id,
      partnerId: 'partner-1',
      use: 'invoice',
      street: id,
      city: 'Hà Nội',
      country: 'VN',
      isDefault: true,
    })
  })
} finally {
  await adapter.close()
}
