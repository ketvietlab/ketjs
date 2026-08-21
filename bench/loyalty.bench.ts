// Loyalty benchmark through the public function boundary. Setup and migration
// are excluded. Each workload gets one warm-up pass and at least seven measured
// passes; the default fixture is the PR acceptance fixture, not a smoke sample.

import { mkdtempSync, rmSync } from 'node:fs'
import { cpus, platform, release, tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { company, loyalty, partner, pricing, product, uom } from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'

const driver = process.env.KET_BENCH_DRIVER ?? 'sqlite'
const measuredRuns = Math.max(7, Number(process.env.KET_BENCH_RUNS ?? 7))
const cartCount = Number(process.env.KET_BENCH_CARTS ?? 1000)
const finalizeCount = Number(process.env.KET_BENCH_ORDERS ?? 1000)
const mutationCount = Number(process.env.KET_BENCH_MUTATIONS ?? 1000)
const raceCount = Number(process.env.KET_BENCH_RACES ?? 100)
const membershipCount = Number(process.env.KET_BENCH_MEMBERSHIPS ?? 1000)
if (!['sqlite', 'postgres'].includes(driver)) throw new Error('KET_BENCH_DRIVER must be sqlite or postgres')
for (const [name, value] of Object.entries({
  cartCount,
  finalizeCount,
  mutationCount,
  raceCount,
  membershipCount,
}))
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)

const modules = [address, partner, company, uom, product, pricing, loyalty]
const manifest = compose(modules, { headless: true })
const scope = { company: 'bench', branches: null }
registerFunctions(modules)

const pgConfigured = process.env.KET_BENCH_PG ?? 'postgres://dev:devpassword@127.0.0.1:5435/postgres'
const pgAdminUrl = new URL(pgConfigured)
pgAdminUrl.pathname = '/postgres'
const pgDatabase = `ket_loyalty_bench_${process.pid}`
const pgDatabaseUrl = new URL(pgAdminUrl)
pgDatabaseUrl.pathname = `/${pgDatabase}`
const localDir = driver === 'sqlite' ? mkdtempSync(join(tmpdir(), 'ket-loyalty-bench-')) : null
let admin: Adapter | null = null
let adapter: Adapter
let contender: Adapter | null = null

if (driver === 'postgres') {
  admin = postgresAdapter(pgAdminUrl.toString(), { max: 1 })
  await admin.open()
  await admin.exec(`DROP DATABASE IF EXISTS "${pgDatabase}" WITH (FORCE)`)
  await admin.exec(`CREATE DATABASE "${pgDatabase}"`)
  adapter = postgresAdapter(pgDatabaseUrl.toString(), { max: 4 })
  contender = postgresAdapter(pgDatabaseUrl.toString(), { max: 2 })
} else {
  const sqlitePath = join(localDir!, 'loyalty.db')
  adapter = sqliteAdapter(sqlitePath)
  contender = sqliteAdapter(sqlitePath)
}

const callWith = (target: Adapter, name: string, input: Record<string, unknown>) =>
  callFn(name, input, { adapter: target, manifest, scope })
const call = (name: string, input: Record<string, unknown>) => callWith(adapter, name, input)

const percentile = (samples: readonly number[], ratio: number) => {
  const ordered = [...samples].sort((a, b) => a - b)
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))] ?? 0
}

type Metric = {
  label: string
  operations: number
  runs: number
  medianMs: number
  p95Ms: number
  throughput: number
}

const metrics: Metric[] = []
const measure = async (
  label: string,
  operationsPerRun: number,
  workload: (pass: number, sample: ((elapsed: number) => void) | null) => Promise<void>,
) => {
  await workload(-1, null)
  const samples: number[] = []
  let totalMs = 0
  for (let pass = 0; pass < measuredRuns; pass++) {
    const started = performance.now()
    await workload(pass, (elapsed) => samples.push(elapsed))
    totalMs += performance.now() - started
  }
  metrics.push({
    label,
    operations: operationsPerRun * measuredRuns,
    runs: measuredRuns,
    medianMs: Number(percentile(samples, 0.5).toFixed(3)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
    throughput: Math.round((operationsPerRun * measuredRuns * 1000) / totalMs),
  })
}

const timed = async (sample: ((elapsed: number) => void) | null, body: () => Promise<unknown>) => {
  const started = performance.now()
  await body()
  sample?.(performance.now() - started)
}

const snapshot = (orderId: string, partnerId = 'customer', orderType: 'sale' | 'pos' = 'sale') => ({
  orderType,
  orderId,
  partnerId,
  currency: 'VND',
  pricelistId: 'retail',
  date: '2026-08-20T00:00:00.000Z',
  lines: Array.from({ length: 10 }, (_, line) => ({
    id: `${orderId}:line:${line}`,
    productId: `product:${line}`,
    quantity: 1,
    untaxed: 100 + line,
    total: 100 + line,
    lineKind: 'product',
  })),
})

await adapter.open()
if (contender) await contender.open()
try {
  await migrateOne(adapter, manifest)
  await call('partner.savePartner', { id: 'company-party', kind: 'company', name: 'Benchmark' })
  await call('partner.savePartner', { id: 'customer', kind: 'person', name: 'Benchmark customer' })
  await call('partner.savePartner', { id: 'member', kind: 'person', name: 'Benchmark member' })
  await call('company.saveCompany', {
    id: 'bench',
    code: 'BENCH',
    partnerId: 'company-party',
    currency: 'VND',
  })
  await call('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' })
  await call('pricing.savePricelist', { id: 'retail', name: 'Retail' })
  for (let index = 0; index < 10; index++) {
    await call('product.saveTemplate', {
      id: `template:${index}`,
      name: `Benchmark product ${index}`,
      type: 'goods',
      uomId: 'unit',
      listPrice: String(100 + index),
      saleOk: true,
    })
    await call('product.saveVariant', {
      id: `product:${index}`,
      templateId: `template:${index}`,
      combinationKey: '',
    })
  }
  for (let program = 0; program < 50; program++) {
    await call('loyalty.program.save', {
      id: `program:${program}`,
      name: `Benchmark program ${program}`,
      programType: 'loyalty',
      sequence: program,
      currency: 'VND',
      appliesOn: 'future',
      trigger: 'auto',
      pointName: 'Points',
      availableSale: true,
      availablePos: true,
    })
    for (let rule = 0; rule < 5; rule++)
      await call('loyalty.rule.save', {
        id: `rule:${program}:${rule}`,
        programId: `program:${program}`,
        priority: rule,
        productId: `product:${(program + rule) % 10}`,
        pointAmount: '1',
        pointMode: 'unit',
        minimumQuantity: '1',
        minimumAmount: '0',
        taxMode: 'excl',
        mode: 'auto',
      })
  }
  await call('loyalty.reward.save', {
    id: 'reward',
    programId: 'program:0',
    description: 'Benchmark reward',
    rewardType: 'discount',
    discount: '10',
    discountMode: 'per_order',
    discountApplicability: 'order',
    requiredPoints: '5',
  })
  await call('loyalty.reward.save', {
    id: 'race-reward',
    programId: 'program:0',
    description: 'Concurrent benchmark reward',
    rewardType: 'discount',
    discount: '10',
    discountMode: 'per_order',
    discountApplicability: 'order',
    requiredPoints: '7',
  })
  await call('loyalty.wallet.create', {
    id: 'main-wallet',
    programId: 'program:0',
    partnerId: 'customer',
    initialBalance: '1000000',
  })

  await measure(
    `evaluate ${cartCount.toLocaleString('en-US')} carts × 10 lines / 50 programs / 250 rules`,
    cartCount,
    async (pass, sample) => {
      for (let index = 0; index < cartCount; index++)
        await timed(sample, () =>
          call('loyalty.evaluateOrder', { order: snapshot(`evaluate:${pass}:${index}`) }),
        )
    },
  )

  for (let program = 1; program < 50; program++)
    await call('loyalty.program.archive', { id: `program:${program}`, active: false })

  await measure('apply and remove reward', mutationCount, async (pass, sample) => {
    for (let index = 0; index < mutationCount; index++) {
      const order = snapshot(`mutation:${pass}:${index}`)
      await timed(sample, async () => {
        const applied = (
          await call('loyalty.applyReward', {
            order,
            programId: 'program:0',
            rewardId: 'reward',
          })
        ).value as Row
        if (applied.ok !== true) throw new Error(`reward apply failed at ${pass}:${index}`)
        await call('loyalty.removeReward', {
          orderType: order.orderType,
          orderId: order.orderId,
          programId: 'program:0',
        })
      })
    }
  })

  await measure(
    'finalize Sale/POS orders with earn and redeem ledger',
    finalizeCount,
    async (pass, sample) => {
      for (let index = 0; index < finalizeCount; index++) {
        const order = snapshot(`finalize:${pass}:${index}`, 'customer', index % 2 === 0 ? 'sale' : 'pos')
        const applied = (
          await call('loyalty.applyReward', {
            order,
            programId: 'program:0',
            rewardId: 'reward',
          })
        ).value as Row
        if (applied.ok !== true) throw new Error(`reward reservation failed at ${pass}:${index}`)
        await timed(sample, () => call('loyalty.order.finalize', { order }))
      }
    },
  )

  await measure('ledger reversal', finalizeCount, async (pass, sample) => {
    const finalizedPass = pass
    for (let index = 0; index < finalizeCount; index++)
      await timed(sample, () =>
        call('loyalty.order.reverse', {
          orderType: index % 2 === 0 ? 'sale' : 'pos',
          orderId: `finalize:${finalizedPass}:${index}`,
        }),
      )
  })

  await measure('concurrent wallet redemption', raceCount, async (pass, sample) => {
    for (let index = 0; index < raceCount; index++) {
      const walletId = `race-wallet:${pass}:${index}`
      await call('loyalty.wallet.create', {
        id: walletId,
        programId: 'program:0',
        initialBalance: '10',
      })
      const firstOrder = { ...snapshot(`race-a:${pass}:${index}`, ''), codes: [] as string[] }
      const secondOrder = { ...snapshot(`race-b:${pass}:${index}`, ''), codes: [] as string[] }
      // Anonymous wallets are selected by code, which also proves the code path.
      const wallet = (await call('loyalty.wallet.get', { id: walletId })).value as Row
      firstOrder.codes = [String(wallet.code)]
      secondOrder.codes = [String(wallet.code)]
      await timed(sample, async () => {
        const attempts = await Promise.allSettled([
          callWith(adapter, 'loyalty.applyReward', {
            order: firstOrder,
            programId: 'program:0',
            rewardId: 'race-reward',
          }),
          callWith(contender ?? adapter, 'loyalty.applyReward', {
            order: secondOrder,
            programId: 'program:0',
            rewardId: 'race-reward',
          }),
        ])
        const winners = attempts.filter(
          (attempt) => attempt.status === 'fulfilled' && (attempt.value.value as Row).ok === true,
        ).length
        if (winners !== 1) throw new Error(`concurrent redeem had ${winners} winners`)
      })
    }
  })

  await call('loyalty.tier.save', {
    id: 'tier',
    name: 'Benchmark tier',
    code: 'benchmark',
    minimumSpend: '0',
    redeemPercent: '100',
  })
  await call('loyalty.membership.config.save', {
    id: 'membership-config',
    programId: 'program:0',
    windowMonths: 12,
    pointValue: '1',
    minimumRedeemStep: '1',
    fallbackCurrencyPerPoint: '10',
    fallbackEnabled: true,
  })
  await call('loyalty.order.finalize', { order: snapshot('member-order', 'member') })
  await measure('membership refresh', membershipCount, async (_pass, sample) => {
    for (let index = 0; index < membershipCount; index++)
      await timed(sample, () => call('loyalty.membership.refresh', { partnerId: 'member' }))
  })

  const database =
    driver === 'postgres'
      ? `${pgDatabaseUrl.hostname}:${pgDatabaseUrl.port || '5432'}/${pgDatabase}`
      : 'isolated SQLite file'
  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        commit: process.env.KET_BENCH_COMMIT ?? null,
        driver,
        database,
        node: process.version,
        os: `${platform()} ${release()}`,
        cpu: cpus()[0]?.model ?? 'unknown',
        fixture: {
          programs: 50,
          rules: 250,
          cartLines: 10,
          cartsPerRun: cartCount,
          ordersPerRun: finalizeCount,
          warmupRuns: 1,
          measuredRuns,
        },
        metrics,
      },
      null,
      2,
    ),
  )
} finally {
  await contender?.close().catch(() => {})
  await adapter.close().catch(() => {})
  if (admin) {
    await admin.exec(`DROP DATABASE IF EXISTS "${pgDatabase}" WITH (FORCE)`).catch(() => {})
    await admin.close().catch(() => {})
  }
  if (localDir) rmSync(localDir, { recursive: true, force: true })
}
