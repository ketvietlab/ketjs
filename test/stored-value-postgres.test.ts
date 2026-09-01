import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { address, company, loyalty, partner, pricing, product, uom } from '@ketvietlab/ketsuite'

const configured =
  process.env.KET_TEST_PG ?? process.env.DATABASE_URL ?? 'postgres://dev:devpassword@127.0.0.1:5435/ketjs_dev'
const adminUrl = new URL(configured)
adminUrl.pathname = '/postgres'
const reachable = await (async () => {
  const adapter = postgresAdapter(adminUrl.toString())
  try {
    await adapter.open()
    const role = (await adapter.all('SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user'))[0]
    await adapter.close()
    return Boolean(role?.rolcreatedb)
  } catch {
    await adapter.close().catch(() => {})
    return false
  }
})()
const live = { skip: reachable ? false : `no PostgreSQL CREATE DATABASE role at ${adminUrl.toString()}` }
const modules = [address, partner, company, uom, product, pricing, loyalty]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }
const call = (adapter: Adapter, name: string, input: Record<string, unknown>) =>
  callFn(name, input, { adapter, manifest, scope })

test(
  'stored value PostgreSQL: competing reservations cannot overspend one currency wallet',
  live,
  async () => {
    const database = `ket_stored_value_${process.pid}_${Date.now()}`
    const databaseUrl = new URL(adminUrl)
    databaseUrl.pathname = `/${database}`
    const admin = postgresAdapter(adminUrl.toString(), { max: 1 })
    const first = postgresAdapter(databaseUrl.toString(), { max: 2 })
    const second = postgresAdapter(databaseUrl.toString(), { max: 2 })
    await admin.open()
    let created = false
    try {
      await admin.exec(`CREATE DATABASE "${database}"`)
      created = true
      await Promise.all([first.open(), second.open()])
      await migrateOne(first, manifest)
      registerFunctions(modules)
      await call(first, 'partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
      await call(first, 'company.saveCompany', {
        id: 'acme',
        partnerId: 'acme-party',
        currency: 'VND',
      })
      await call(first, 'loyalty.program.save', {
        id: 'gift-program',
        name: 'Gift card',
        programType: 'gift_card',
        currency: 'VND',
        appliesOn: 'future',
        trigger: 'with_code',
        pointName: 'VND',
        availableSale: true,
        availablePos: true,
      })
      await call(first, 'loyalty.storedValue.open', { id: 'wallet', programId: 'gift-program' })
      await call(first, 'loyalty.storedValue.issue', {
        id: 'wallet:issue',
        walletId: 'wallet',
        amount: '100',
        sourceType: 'account_move',
        sourceId: 'issue-move',
        sourceKey: 'wallet:issue',
      })
      const results = await Promise.all([
        call(first, 'loyalty.storedValue.reserve', {
          id: 'reserve-a',
          walletId: 'wallet',
          amount: '80',
          sourceType: 'pos',
          sourceId: 'order-a',
          sourceKey: 'wallet:reserve:a',
        }),
        call(second, 'loyalty.storedValue.reserve', {
          id: 'reserve-b',
          walletId: 'wallet',
          amount: '80',
          sourceType: 'pos',
          sourceId: 'order-b',
          sourceKey: 'wallet:reserve:b',
        }),
      ])
      const values = results.map((result) => result.value as Row)
      assert.equal(values.filter((value) => value.ok === true).length, 1)
      assert.equal(values.filter((value) => value.ok !== true).length, 1)
      const wallet = (
        await first.all('SELECT balance, reserved FROM loyalty_wallet WHERE id = $1', ['wallet'])
      )[0]!
      assert.equal(Number(wallet.balance), 100)
      assert.equal(Number(wallet.reserved), 80)
    } finally {
      await Promise.all([first.close().catch(() => {}), second.close().catch(() => {})])
      if (created) await admin.exec(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(() => {})
      await admin.close()
    }
  },
)
