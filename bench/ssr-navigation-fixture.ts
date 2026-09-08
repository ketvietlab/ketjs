import { performance } from 'node:perf_hooks'
import { tableNameFor, type Adapter, type Row } from '@ketvietlab/ketjs'
import type { TestDeployment } from '@ketvietlab/ketjs/testing'

export const SSR_NAVIGATION_PARTNER_COUNTS = [10_000, 100_000] as const

const bulkInsert = async (adapter: Adapter, model: string, columns: string[], rows: unknown[][]) => {
  const quote = (value: string) => adapter.quoteIdent(value)
  const chunkSize = Math.max(1, Math.floor(900 / columns.length))
  for (let at = 0; at < rows.length; at += chunkSize) {
    const chunk = rows.slice(at, at + chunkSize)
    const placeholders = chunk.map(() => `(${columns.map(() => '?').join(',')})`).join(',')
    await adapter.run(
      `INSERT INTO ${quote(tableNameFor(model))} (${columns.map(quote).join(',')}) VALUES ${placeholders}`,
      chunk.flat(),
    )
  }
}

export async function seedSsrNavigationFixture(deployment: TestDeployment, partnerCount: number) {
  const started = performance.now()
  const scope = { company: 'bench-company', branches: null }
  const call = async (name: string, input: Record<string, unknown>) => {
    const result = await deployment.fixture.call<Row>(name, input, { scope })
    if ((result.value as { ok?: boolean } | null)?.ok === false)
      throw new Error(`${name}: ${JSON.stringify(result.value)}`)
  }
  await call('partner.savePartner', {
    id: 'bench-company-party',
    kind: 'company',
    name: 'Benchmark Holding',
  })
  await call('company.saveCompany', {
    id: 'bench-company',
    partnerId: 'bench-company-party',
    currency: 'VND',
  })
  await call('user.createUser', {
    id: 'bench-admin',
    login: 'bench-admin',
    password: 'navigation-local-only',
    name: 'Benchmark Admin',
    defaultCompanyId: 'bench-company',
    superuser: true,
  })
  await call('user.grantCompany', {
    id: 'bench-admin:bench-company',
    userId: 'bench-admin',
    companyId: 'bench-company',
  })
  await deployment.fixture.withTenant('', async ({ adapter }) => {
    await adapter.tx(async (tx) => {
      const partners: unknown[][] = []
      const roles: unknown[][] = [['bench-company-party:customer', 'bench-company-party', 'customer']]
      for (let at = 1; at < partnerCount; at++) {
        const id = `partner-${String(at).padStart(6, '0')}`
        partners.push([
          id,
          at % 5 === 0 ? 'person' : 'company',
          `Partner ${String(at).padStart(6, '0')}`,
          `P-${String(at).padStart(6, '0')}`,
          at % 7 === 0 ? `partner-${at}@example.test` : null,
          at % 11 === 0 ? `090${String(at).padStart(7, '0')}` : null,
          1,
        ])
        if (at % 2 === 0) roles.push([`${id}:customer`, id, 'customer'])
        if (at % 3 === 0) roles.push([`${id}:supplier`, id, 'supplier'])
      }
      await bulkInsert(
        tx,
        'partner.Partner',
        ['id', 'kind', 'name', 'ref', 'email', 'phone', 'active'],
        partners,
      )
      await bulkInsert(tx, 'partner.Role', ['id', 'partnerId', 'role'], roles)
    })
    await adapter.exec('ANALYZE')
  })
  await deployment.client.login({ login: 'bench-admin', password: 'navigation-local-only' })
  return { partnerCount, seedMs: performance.now() - started }
}
