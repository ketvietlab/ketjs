import { performance } from 'node:perf_hooks'
import {
  defineDeployment,
  defineFn,
  defineModule,
  from,
  inArray,
  tableNameFor,
  type Adapter,
  type DeploymentSpec,
  type KetModule,
  type Row,
} from '@ketvietlab/ketjs'
import type { TestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

export const LEGO_EXTENSION_COUNTS = [0, 1, 5, 10] as const
export const LEGO_PARTNER_COUNTS = [10_000, 100_000] as const

const metricData = defineModule({
  name: 'lego_metric_data',
  version: '1.0.0',
  depends: ['partner'],
  models: {
    Metric: {
      scope: 'shared',
      fields: { id: 'id', partnerId: 'ref:partner.Partner', value: 'text' },
      indexes: { partner: { fields: ['partnerId'], unique: true } },
    },
  },
})

const metricProvider = (ordinal: number): KetModule => {
  const suffix = String(ordinal).padStart(2, '0')
  const name = `lego_metric_${suffix}`
  return defineModule({
    name,
    version: '1.0.0',
    depends: ['lego_metric_data', 'partner_backend'],
    functions: {
      values: defineFn({
        input: { ids: 'json' },
        output: { id: 'id', value: 'text' },
        effects: ['read:lego_metric_data.Metric'],
        handler: async (ctx, args) => {
          const ids = Array.isArray(args.ids) ? [...new Set(args.ids.map(String).filter(Boolean))] : []
          if (ids.length > 500) throw new Error(`${name}.values accepts at most 500 ids`)
          const M = ctx.table('lego_metric_data.Metric')
          const found = new Map<string, Row>()
          for (let at = 0; at < ids.length; at += 400)
            for (const row of await ctx.db.all(from(M).where(inArray(M.partnerId, ids.slice(at, at + 400)))))
              found.set(String(row.partnerId), row)
          return ids.map((id) => ({
            id,
            value: `${String(found.get(id)?.value ?? 'none')} · ${suffix}`,
          }))
        },
      }),
    },
    browser: {
      widgets: { value: { props: { value: 'text' }, builtin: 'text' } },
      resources: {
        values: {
          source: 'values',
          needs: 'values',
          phase: 'deferred',
          key: 'id',
          fields: { id: 'id', value: 'text' },
          batch: { input: 'ids', max: 100 },
          cache: { scope: 'context', ttlMs: 15_000 },
        },
      },
      fills: {
        'partner_backend.partners:columns': {
          compatible: '^1.0.0',
          columns: [
            {
              id: `metric-${suffix}`,
              label: 'field.value',
              resource: 'values',
              widget: 'value',
              bind: { value: 'value' },
              priority: 'optional',
              operations: ['display'],
            },
          ],
        },
      },
    },
    messages: {
      vi: { 'field.value': `Chỉ số ${suffix}` },
      en: { 'field.value': `Metric ${suffix}` },
    },
  })
}

const metricProviders = Array.from({ length: 9 }, (_, at) => metricProvider(at + 1))

export function legoDeployment(extensionCount: number): DeploymentSpec {
  if (!LEGO_EXTENSION_COUNTS.includes(extensionCount as never))
    throw new Error(`extensionCount must be one of ${LEGO_EXTENSION_COUNTS.join(', ')}`)
  const base = ketsuite.modules.filter((module) => module.name !== 'account_partner_backend')
  const accountBridge = ketsuite.modules.find((module) => module.name === 'account_partner_backend')!
  // The data fixture module has no screen fill and is present in every variant,
  // keeping the physical schema identical while release-time composition varies.
  const extras = [
    metricData,
    ...(extensionCount === 0 ? [] : [accountBridge, ...metricProviders.slice(0, extensionCount - 1)]),
  ]
  const modules = [...base, ...extras]
  const names = new Set(modules.map(({ name }) => name))
  const permissionModules = Object.fromEntries(
    Object.entries(ketsuite.permissions?.modules ?? {}).filter(([name]) => names.has(name)),
  )
  return defineDeployment({
    ...ketsuite,
    name: `lego_csr_${extensionCount}`,
    modules,
    permissions: { ...ketsuite.permissions, modules: permissionModules },
  })
}

const bulkInsert = async (
  adapter: Adapter,
  model: string,
  columns: string[],
  rows: unknown[][],
): Promise<void> => {
  if (!rows.length) return
  const quote = (value: string): string => adapter.quoteIdent(value)
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

export type LegoSeedResult = {
  partnerCount: number
  companyPartnerCount: number
  personPartnerCount: number
  customerCount: number
  supplierCount: number
  metricCount: number
  ledgerMoveCount: number
  ledgerLineCount: number
  ledgerPartnersWithBalance: number
  seedMs: number
}

/** Seed a fresh benchmark tenant; bulk fixture writes still use the real adapter and physical schema. */
export async function seedLegoFixture(
  deployment: TestDeployment,
  partnerCount: number,
): Promise<LegoSeedResult> {
  const started = performance.now()
  const scope = {
    company: 'bench-company',
    companies: ['bench-company'],
    branch: null,
    branches: null,
  }
  const call = async (name: string, input: Record<string, unknown>) => {
    const result = await deployment.fixture.call(name, input, { scope })
    if ((result.value as { ok?: boolean } | null)?.ok === false)
      throw new Error(`${name}: ${JSON.stringify(result.value)}`)
    return result.value
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
    password: 'lego-local-only',
    name: 'Benchmark Admin',
    defaultCompanyId: 'bench-company',
    superuser: true,
  })
  await call('user.grantCompany', {
    id: 'bench-admin:bench-company',
    userId: 'bench-admin',
    companyId: 'bench-company',
  })

  let customerCount = 1
  let supplierCount = 0
  let metricCount = 0
  await deployment.fixture.withTenant('', async ({ adapter, manifest }) => {
    await adapter.tx(async (tx) => {
      const partnerRows: unknown[][] = []
      const roleRows: unknown[][] = [['bench-company-party:customer', 'bench-company-party', 'customer']]
      const metricRows: unknown[][] = []
      for (let at = 1; at < partnerCount; at++) {
        const id = `partner-${String(at).padStart(6, '0')}`
        partnerRows.push([
          id,
          at % 5 === 0 ? 'person' : 'company',
          `Partner ${String(at).padStart(6, '0')}`,
          `P-${String(at).padStart(6, '0')}`,
          at % 7 === 0 ? `partner-${at}@example.test` : null,
          at % 11 === 0 ? `090${String(at).padStart(7, '0')}` : null,
          1,
        ])
        if (at % 2 === 0) {
          roleRows.push([`${id}:customer`, id, 'customer'])
          customerCount++
        }
        if (at % 3 === 0) {
          roleRows.push([`${id}:supplier`, id, 'supplier'])
          supplierCount++
        }
        if (manifest.models['lego_metric_data.Metric']) {
          metricRows.push([id, id, `M${at % 97}`])
          metricCount++
        }
      }
      if (manifest.models['lego_metric_data.Metric']) {
        metricRows.unshift(['bench-company-party', 'bench-company-party', 'M0'])
        metricCount++
      }
      await bulkInsert(
        tx,
        'partner.Partner',
        ['id', 'kind', 'name', 'ref', 'email', 'phone', 'active'],
        partnerRows,
      )
      await bulkInsert(tx, 'partner.Role', ['id', 'partnerId', 'role'], roleRows)
      if (metricRows.length)
        await bulkInsert(tx, 'lego_metric_data.Metric', ['id', 'partnerId', 'value'], metricRows)
    })
    await adapter.exec('ANALYZE')
  })

  await call('account.saveAccount', {
    id: 'bench-receivable',
    code: '131',
    name: 'Receivable',
    accountType: 'asset_receivable',
  })
  await call('account.saveAccount', {
    id: 'bench-payable',
    code: '331',
    name: 'Payable',
    accountType: 'liability_payable',
  })
  await call('account.saveAccount', {
    id: 'bench-cash',
    code: '111',
    name: 'Cash',
    accountType: 'asset_cash',
  })
  await call('account.saveJournal', {
    id: 'bench-journal',
    name: 'Benchmark Journal',
    code: 'BM',
    type: 'general',
  })
  await call('account.createMove', { id: 'bench-open-items', journalId: 'bench-journal' })
  const visible = [
    'bench-company-party',
    ...Array.from({ length: 29 }, (_, at) => `partner-${String(at + 1).padStart(6, '0')}`),
  ]
  let total = 0
  for (const [at, partnerId] of visible.entries()) {
    const amount = (at + 1) * 1_000
    total += amount
    await call('account.addMoveLine', {
      id: `bench-open-${at}`,
      moveId: 'bench-open-items',
      name: 'Open receivable',
      accountId: 'bench-receivable',
      partnerId,
      debit: String(amount),
    })
  }
  await call('account.addMoveLine', {
    id: 'bench-open-counterpart',
    moveId: 'bench-open-items',
    name: 'Counterpart',
    accountId: 'bench-cash',
    credit: String(total),
  })
  await call('account.postMove', { id: 'bench-open-items' })
  await deployment.client.login({ login: 'bench-admin', password: 'lego-local-only' })
  return {
    partnerCount,
    companyPartnerCount: partnerCount - Math.floor((partnerCount - 1) / 5),
    personPartnerCount: Math.floor((partnerCount - 1) / 5),
    customerCount,
    supplierCount,
    metricCount,
    ledgerMoveCount: 1,
    ledgerLineCount: visible.length + 1,
    ledgerPartnersWithBalance: visible.length,
    seedMs: performance.now() - started,
  }
}
