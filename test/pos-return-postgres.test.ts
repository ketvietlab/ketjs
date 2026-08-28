import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { account, company, partner, pos, pricing, product, stock, uom, user } from '@ketvietlab/ketsuite'
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
const modules = [address, partner, company, user, uom, product, pricing, stock, account, pos]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }
const call = (adapter: Adapter, name: string, input: Record<string, unknown>) =>
  callFn(name, input, { adapter, manifest, scope })

const seed = async (adapter: Adapter) => {
  const run = (name: string, input: Record<string, unknown>) => call(adapter, name, input)
  await run('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await run('partner.savePartner', { id: 'customer', kind: 'person', name: 'Customer' })
  await run('company.saveCompany', {
    id: 'acme',
    code: 'ACME',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  await run('user.createUser', {
    id: 'cashier',
    login: 'cashier',
    password: 'correct horse',
    name: 'Cashier',
    defaultCompanyId: 'acme',
  })
  await run('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' })
  await run('product.saveTemplate', {
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    uomId: 'unit',
    listPrice: '100',
    saleOk: true,
  })
  await run('product.saveVariant', {
    id: 'goods-1',
    templateId: 'goods',
    combinationKey: '',
  })
  await run('stock.configureProduct', {
    templateId: 'goods',
    isStorable: true,
    tracking: 'none',
  })
  await run('stock.saveWarehouse', { id: 'wh', name: 'Main', code: 'WH' })
  await run('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })
  await run('stock.adjustInventory', {
    id: 'adjust',
    productId: 'goods-1',
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory',
    countedQuantity: '10',
    productUomId: 'unit',
  })
  for (const [id, code, name, accountType] of [
    ['revenue', '5111', 'Revenue', 'income'],
    ['receivable', '131', 'Receivable', 'asset_receivable'],
    ['tax', '3331', 'VAT', 'liability_current'],
    ['cash', '1111', 'Cash', 'asset_cash'],
  ])
    await run('account.saveAccount', { id, code, name, accountType })
  await run('account.saveJournal', { id: 'sales', name: 'Sales', code: 'SAL', type: 'sale' })
  await run('account.saveJournal', {
    id: 'cash-journal',
    name: 'Cash',
    code: 'CSH',
    type: 'cash',
    defaultAccountId: 'cash',
  })
  await run('pricing.savePricelist', { id: 'retail', name: 'Retail' })
  await run('pos.saveConfig', {
    id: 'shop',
    name: 'Main Shop',
    warehouseId: 'wh',
    pricelistId: 'retail',
    salesJournalId: 'sales',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
  })
  await run('pos.savePaymentMethod', {
    id: 'cash-method',
    name: 'Cash',
    journalId: 'cash-journal',
    isCash: true,
  })
  await run('pos.linkPaymentMethod', {
    id: 'shop:cash',
    configId: 'shop',
    paymentMethodId: 'cash-method',
  })
  await run('pos.createSession', { id: 'shift', configId: 'shop', userId: 'cashier' })
  await run('pos.openSession', { id: 'shift' })
  await run('pos.createOrder', { id: 'sale', sessionId: 'shift', partnerId: 'customer' })
  await run('pos.addLine', {
    id: 'sale-line',
    orderId: 'sale',
    productId: 'goods-1',
    productUomId: 'unit',
    qty: '1',
    priceUnit: '100',
  })
  await run('pos.addPayment', {
    id: 'sale-payment',
    orderId: 'sale',
    paymentMethodId: 'cash-method',
    amount: '100',
  })
  const finalized = (await run('pos.validateOrder', { id: 'sale' })).value as Row
  assert.equal(finalized.ok, true, JSON.stringify(finalized))
}

test('pos PostgreSQL: concurrent returns cannot reserve the same final quantity', live, async () => {
  const database = `ket_pos_return_${process.pid}_${Date.now()}`
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
    await seed(first)
    const eligibility = (await call(first, 'pos.getReturnEligibility', { id: 'sale' })).value as Row
    const command = (id: string) => ({
      id,
      originalOrderId: 'sale',
      sessionId: 'shift',
      expectedRevision: eligibility.revision,
      lines: [{ lineId: 'sale-line', quantity: '1' }],
    })
    const results = await Promise.all([
      call(first, 'pos.refundOrder', command('return-a')),
      call(second, 'pos.refundOrder', command('return-b')),
    ])
    const values = results.map((result) => result.value as Row)
    assert.equal(values.filter((value) => value.ok).length, 1)
    assert.equal(values.filter((value) => !value.ok).length, 1)
    assert.equal(
      values
        .filter((value) => !value.ok)
        .flatMap((value) => value.errors as Row[])
        .some((error) => error.field === 'expectedRevision'),
      true,
    )
    const linked = await first.all('SELECT id FROM pos_order WHERE "refundedOrderId" = ? AND state <> ?', [
      'sale',
      'cancel',
    ])
    assert.equal(linked.length, 1)

    const winningReturn = values.find((value) => value.ok)!
    const cancelled = (await call(first, 'pos.cancelOrder', { id: winningReturn.id })).value as Row
    assert.equal(cancelled.ok, true, JSON.stringify(cancelled))
    const exchangeEligibility = (await call(first, 'pos.getReturnEligibility', { id: 'sale' })).value as Row
    assert.equal(exchangeEligibility.refundable, true)
    const exchangeCommand = (id: string) => ({
      id,
      uuid: id,
      originalOrderId: 'sale',
      sessionId: 'shift',
      expectedRevision: exchangeEligibility.revision,
      lines: [{ lineId: 'sale-line', quantity: '1' }],
      reason: 'Customer chose another product',
      replacementPriceBookRevision: 'price-book-r1',
    })
    const exchangeResults = await Promise.all([
      call(first, 'pos.createExchange', exchangeCommand('exchange-a')),
      call(second, 'pos.createExchange', exchangeCommand('exchange-b')),
    ])
    const exchangeValues = exchangeResults.map((result) => result.value as Row)
    assert.equal(exchangeValues.filter((value) => value.ok).length, 1)
    assert.equal(exchangeValues.filter((value) => !value.ok).length, 1)
    assert.equal(
      exchangeValues
        .filter((value) => !value.ok)
        .flatMap((value) => value.errors as Row[])
        .some((error) => error.field === 'expectedRevision'),
      true,
    )
    const exchanges = await first.all('SELECT id FROM pos_exchange')
    assert.equal(exchanges.length, 1)
    const exchangeChildren = await first.all(
      'SELECT id FROM pos_order WHERE "exchangeId" IS NOT NULL ORDER BY id',
    )
    assert.deepEqual(exchangeChildren, [
      { id: `${String(exchanges[0]!.id)}:replacement` },
      { id: `${String(exchanges[0]!.id)}:return` },
    ])
  } finally {
    await Promise.all([first.close().catch(() => {}), second.close().catch(() => {})])
    await admin.exec(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(() => {})
    await admin.close()
  }
})
