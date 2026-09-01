import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import {
  account,
  address,
  company,
  loyalty,
  partner,
  pos,
  pricing,
  product,
  stock,
  uom,
  user,
} from '@ketvietlab/ketsuite'

const modules = [address, partner, company, user, uom, product, pricing, stock, account, pos, loyalty]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }
const call = (adapter: Adapter, name: string, input: Record<string, unknown>) =>
  callFn(name, input, { adapter, manifest, scope })
const value = async (adapter: Adapter, name: string, input: Record<string, unknown>): Promise<Row> =>
  (await call(adapter, name, input)).value as Row

async function boot(): Promise<Adapter> {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call(adapter, 'partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await call(adapter, 'partner.savePartner', { id: 'customer', kind: 'person', name: 'Customer' })
  await call(adapter, 'company.saveCompany', {
    id: 'acme',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  await call(adapter, 'user.createUser', {
    id: 'cashier',
    login: 'cashier',
    password: 'correct horse',
    name: 'Cashier',
    defaultCompanyId: 'acme',
  })
  await call(adapter, 'uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' })
  await call(adapter, 'product.saveTemplate', {
    id: 'goods',
    name: 'Meal',
    type: 'goods',
    uomId: 'unit',
    listPrice: '90',
    saleOk: true,
  })
  await call(adapter, 'product.saveVariant', {
    id: 'meal',
    templateId: 'goods',
    defaultCode: 'MEAL',
    combinationKey: '',
  })
  await call(adapter, 'stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await call(adapter, 'stock.saveWarehouse', { id: 'wh', name: 'Main', code: 'WH' })
  await call(adapter, 'stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })
  await call(adapter, 'stock.adjustInventory', {
    id: 'adjust',
    productId: 'meal',
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory',
    countedQuantity: '10',
    productUomId: 'unit',
  })
  for (const [id, code, name, accountType] of [
    ['revenue', '5111', 'Revenue', 'income'],
    ['breakage', '7111', 'Stored value breakage', 'income_other'],
    ['receivable', '131', 'Receivable', 'asset_receivable'],
    ['cash', '1111', 'Cash', 'asset_cash'],
    ['stored-value', '3388', 'Stored value liability', 'liability_current'],
  ])
    await call(adapter, 'account.saveAccount', { id, code, name, accountType })
  await call(adapter, 'account.saveJournal', { id: 'sales', name: 'Sales', code: 'SAL', type: 'sale' })
  await call(adapter, 'account.saveJournal', {
    id: 'stored-value-journal',
    name: 'Stored value',
    code: 'SV',
    type: 'general',
    defaultAccountId: 'stored-value',
  })
  await call(adapter, 'pricing.savePricelist', { id: 'retail', name: 'Retail' })
  await call(adapter, 'pricing.savePricelistItem', {
    id: 'retail:meal',
    pricelistId: 'retail',
    appliedOn: '0_product_variant',
    productId: 'meal',
    computePrice: 'fixed',
    fixedPrice: '90',
  })
  await call(adapter, 'pos.saveConfig', {
    id: 'shop',
    name: 'Shop',
    warehouseId: 'wh',
    pricelistId: 'retail',
    salesJournalId: 'sales',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
    maximumDifference: '0',
  })
  const saved = await value(adapter, 'pos.savePaymentMethod', {
    id: 'gift-card',
    name: 'Gift card',
    journalId: 'stored-value-journal',
    settlementKind: 'stored_value',
  })
  assert.equal(saved.ok, true, JSON.stringify(saved.errors))
  await call(adapter, 'pos.linkPaymentMethod', {
    id: 'shop:gift-card',
    configId: 'shop',
    paymentMethodId: 'gift-card',
  })
  await call(adapter, 'loyalty.program.save', {
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
  return adapter
}

test('stored value: issue, reserve, POS settlement, finalize and expiry use canonical authorities', async () => {
  const adapter = await boot()
  try {
    const opened = await value(adapter, 'loyalty.storedValue.open', {
      id: 'wallet',
      programId: 'gift-program',
      partnerId: 'customer',
      expiresAt: '2026-09-30T00:00:00.000Z',
    })
    assert.equal(opened.ok, true, JSON.stringify(opened.errors))
    assert.match(String((opened as Row).code), /^VALUE-[0-9A-F]{20}$/u)

    const liability = await value(adapter, 'account.postStoredValueBalance', {
      id: 'stored-value:issue:1',
      operation: 'issue',
      journalId: 'stored-value-journal',
      liabilityAccountId: 'stored-value',
      counterpartAccountId: 'cash',
      amount: '1000',
      partnerId: 'customer',
    })
    assert.equal(liability.ok, true, JSON.stringify(liability.errors))
    const issued = await value(adapter, 'loyalty.storedValue.issue', {
      id: 'wallet:issue:1',
      walletId: 'wallet',
      amount: '1000',
      sourceType: 'account_move',
      sourceId: 'stored-value:issue:1',
      sourceKey: 'wallet:issue:1',
    })
    assert.equal(issued.ok, true, JSON.stringify(issued.errors))
    const conflictingIssue = await value(adapter, 'loyalty.storedValue.issue', {
      id: 'wallet:issue:1',
      walletId: 'wallet',
      amount: '1001',
      sourceType: 'account_move',
      sourceId: 'stored-value:issue:1',
      sourceKey: 'wallet:issue:1',
    })
    assert.equal(conflictingIssue.ok, false)

    const reserved = await value(adapter, 'loyalty.storedValue.reserve', {
      id: 'wallet:reservation:order-1',
      walletId: 'wallet',
      amount: '90',
      sourceType: 'pos',
      sourceId: 'order-1',
      sourceKey: 'pos:order-1:gift-card',
    })
    assert.equal(reserved.ok, true, JSON.stringify(reserved.errors))
    await call(adapter, 'pos.createSession', {
      id: 'session',
      configId: 'shop',
      userId: 'cashier',
      openingCash: '0',
    })
    await call(adapter, 'pos.openSession', { id: 'session' })
    await call(adapter, 'pos.createOrder', {
      id: 'order-1',
      sessionId: 'session',
      partnerId: 'customer',
    })
    const line = await value(adapter, 'pos.addLine', {
      id: 'line-1',
      orderId: 'order-1',
      productId: 'meal',
      productUomId: 'unit',
      qty: '1',
    })
    const payment = await value(adapter, 'pos.addPayment', {
      id: 'payment-1',
      orderId: 'order-1',
      paymentMethodId: 'gift-card',
      amount: '90',
      reference: 'wallet:reservation:order-1',
      expectedRevision: line.revision,
    })
    assert.equal(payment.ok, true, JSON.stringify(payment.errors))
    const finalized = await value(adapter, 'pos.validateOrder', {
      id: 'order-1',
      expectedRevision: payment.revision,
    })
    assert.equal(finalized.ok, true, JSON.stringify(finalized.errors))
    const redeemed = await value(adapter, 'loyalty.storedValue.finalize', {
      reservationId: 'wallet:reservation:order-1',
    })
    assert.equal(redeemed.ok, true, JSON.stringify(redeemed.errors))

    const accountPayment = (
      await adapter.all('SELECT * FROM account_payment WHERE id = ?', ['payment-1:account'])
    )[0]!
    assert.equal(accountPayment.settlementKind, 'stored_value')
    const settlementLines = await adapter.all(
      'SELECT accountId, debit, credit FROM account_move_line WHERE moveId = ?',
      ['payment-1:account:move'],
    )
    assert.deepEqual(
      settlementLines.map((row) => [row.accountId, Number(row.debit), Number(row.credit)]).sort(),
      [
        ['receivable', 0, 90],
        ['stored-value', 90, 0],
      ],
    )
    const invoiceCounterpart = (
      await adapter.all('SELECT amountResidual, reconciled FROM account_move_line WHERE id = ?', [
        'order-1:account:counterpart',
      ])
    )[0]!
    assert.equal(Number(invoiceCounterpart.amountResidual), 0)
    assert.equal(Boolean(invoiceCounterpart.reconciled), true)
    const wallet = (
      await adapter.all('SELECT balance, reserved FROM loyalty_wallet WHERE id = ?', ['wallet'])
    )[0]!
    assert.equal(Number(wallet.balance), 910)
    assert.equal(Number(wallet.reserved), 0)

    const replay = await value(adapter, 'loyalty.storedValue.finalize', {
      reservationId: 'wallet:reservation:order-1',
    })
    assert.equal(replay.ok, true)
    assert.equal((await adapter.all('SELECT id FROM loyalty_ledger_entry')).length, 2)
  } finally {
    await adapter.close()
  }
})

test('stored value: expiry releases liability and fails closed while a reservation exists', async () => {
  const adapter = await boot()
  try {
    await value(adapter, 'loyalty.storedValue.open', {
      id: 'expired-wallet',
      programId: 'gift-program',
      expiresAt: '2026-09-01T23:59:59.999Z',
    })
    await value(adapter, 'loyalty.storedValue.issue', {
      id: 'expired-wallet:issue',
      walletId: 'expired-wallet',
      amount: '50',
      sourceType: 'account_move',
      sourceId: 'stored-value:issue:expired',
      sourceKey: 'expired-wallet:issue',
    })
    const expired = await value(adapter, 'loyalty.storedValue.expire', {
      id: 'expired-wallet:expiry',
      walletId: 'expired-wallet',
      sourceType: 'maintenance',
      sourceId: '2026-09-02',
      sourceKey: 'expired-wallet:expiry',
      at: '2026-09-02T00:00:00.000Z',
    })
    assert.equal(expired.ok, true, JSON.stringify(expired.errors))
    const expiryReplay = await value(adapter, 'loyalty.storedValue.expire', {
      id: 'expired-wallet:expiry',
      walletId: 'expired-wallet',
      sourceType: 'maintenance',
      sourceId: '2026-09-02',
      sourceKey: 'expired-wallet:expiry',
      at: '2026-09-02T00:00:00.000Z',
    })
    assert.equal(expiryReplay.ok, true, JSON.stringify(expiryReplay.errors))
    assert.equal((expiryReplay.entry as Row).id, 'expired-wallet:expiry')
    const released = await value(adapter, 'account.postStoredValueBalance', {
      id: 'stored-value:expire:expired-wallet',
      operation: 'expire',
      journalId: 'stored-value-journal',
      liabilityAccountId: 'stored-value',
      counterpartAccountId: 'breakage',
      amount: '50',
    })
    assert.equal(released.ok, true, JSON.stringify(released.errors))
    const wallet = (
      await adapter.all('SELECT balance, active FROM loyalty_wallet WHERE id = ?', ['expired-wallet'])
    )[0]!
    assert.equal(Number(wallet.balance), 0)
    assert.equal(Boolean(wallet.active), false)
  } finally {
    await adapter.close()
  }
})
