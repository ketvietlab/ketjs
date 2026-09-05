import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { company, loyalty, partner, pricing, product, uom } from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'

const configured =
  process.env.KET_TEST_PG ?? process.env.DATABASE_URL ?? 'postgres://dev:devpassword@127.0.0.1:5435/ketjs_dev'
const adminUrl = new URL(configured)
adminUrl.pathname = '/postgres'

const reachable = await (async () => {
  const adapter = postgresAdapter(adminUrl.toString())
  try {
    await adapter.open()
    await adapter.all('SELECT 1')
    await adapter.close()
    return true
  } catch {
    await adapter.close().catch(() => {})
    return false
  }
})()

const live = { skip: reachable ? false : `no PostgreSQL at ${adminUrl.toString()}` }
const modules = [address, partner, company, uom, product, pricing, loyalty]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }

const publicCall = (adapter: Adapter, name: string, input: Record<string, unknown>) =>
  callFn(name, input, { adapter, manifest, scope })

test(
  'loyalty PostgreSQL: concurrent reservation has one winner and finalize is idempotent',
  live,
  async () => {
    const database = `ket_loyalty_${process.pid}_${Date.now()}`
    const databaseUrl = new URL(adminUrl)
    databaseUrl.pathname = `/${database}`
    const admin = postgresAdapter(adminUrl.toString(), { max: 1 })
    const first = postgresAdapter(databaseUrl.toString(), { max: 2 })
    const second = postgresAdapter(databaseUrl.toString(), { max: 2 })
    await admin.open()
    await admin.exec(`CREATE DATABASE "${database}"`)
    try {
      await Promise.all([first.open(), second.open()])
      await migrateOne(first, manifest)
      registerFunctions(modules)

      const seed = (name: string, input: Record<string, unknown>) => publicCall(first, name, input)
      await seed('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
      await seed('partner.savePartner', { id: 'customer', kind: 'person', name: 'Customer' })
      await seed('company.saveCompany', {
        id: 'acme',
        code: 'ACME',
        partnerId: 'acme-party',
        currency: 'VND',
      })
      await seed('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' })
      await seed('product.saveTemplate', {
        id: 'template',
        name: 'Fruit box',
        type: 'goods',
        uomId: 'unit',
        listPrice: '100',
        saleOk: true,
      })
      await seed('product.saveVariant', {
        id: 'fruit-box',
        templateId: 'template',
        combinationKey: '',
      })
      await seed('loyalty.program.save', {
        id: 'program',
        name: 'PostgreSQL Loyalty',
        programType: 'loyalty',
        currency: 'VND',
        appliesOn: 'future',
        trigger: 'auto',
        pointName: 'Points',
        availableSale: true,
        availablePos: true,
      })
      await seed('loyalty.rule.save', {
        id: 'rule',
        programId: 'program',
        pointAmount: '1',
        pointMode: 'order',
        minimumQuantity: '1',
        minimumAmount: '0',
        taxMode: 'excl',
        mode: 'auto',
      })
      await seed('loyalty.reward.save', {
        id: 'reward',
        programId: 'program',
        description: 'Seven point reward',
        rewardType: 'discount',
        discount: '10',
        discountMode: 'per_order',
        discountApplicability: 'order',
        requiredPoints: '7',
      })
      await seed('loyalty.wallet.create', {
        id: 'wallet',
        programId: 'program',
        partnerId: 'customer',
        initialBalance: '10',
      })

      const order = (id: string) => ({
        orderType: 'sale',
        orderId: id,
        partnerId: 'customer',
        currency: 'VND',
        date: new Date().toISOString(),
        lines: [
          {
            id: `${id}:line`,
            productId: 'fruit-box',
            quantity: 1,
            untaxed: '100',
            total: '100',
            lineKind: 'product',
          },
        ],
      })
      const results = await Promise.all([
        publicCall(first, 'loyalty.applyReward', {
          order: order('race-a'),
          programId: 'program',
          rewardId: 'reward',
        }),
        publicCall(second, 'loyalty.applyReward', {
          order: order('race-b'),
          programId: 'program',
          rewardId: 'reward',
        }),
      ])
      const values = results.map((result) => result.value as Row)
      assert.equal(values.filter((value) => value.ok).length, 1)
      assert.equal(values.filter((value) => !value.ok).length, 1)
      const winner = values[0]!.ok ? 'race-a' : 'race-b'

      const held = (await publicCall(second, 'loyalty.wallet.get', { id: 'wallet' })).value as Row
      assert.equal(Number(held.balance), 10)
      assert.equal(Number(held.reserved), 7)
      assert.ok(Number(held.available) >= 0)

      await publicCall(first, 'loyalty.order.finalize', { order: order(winner) })
      await publicCall(second, 'loyalty.order.finalize', { order: order(winner) })
      const finalized = (await publicCall(first, 'loyalty.wallet.get', { id: 'wallet' })).value as Row
      assert.equal(Number(finalized.balance), 4)
      assert.equal(Number(finalized.reserved), 0)
      assert.equal(
        (finalized.ledger as Row[]).filter(
          (entry) => entry.sourceId === winner && ['earn', 'redeem'].includes(String(entry.operation)),
        ).length,
        2,
      )
    } finally {
      await Promise.all([first.close().catch(() => {}), second.close().catch(() => {})])
      await admin.exec(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(() => {})
      await admin.close()
    }
  },
)
