import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import {
  account,
  company,
  partner,
  pos,
  POS_ORDER_STATES,
  POS_SESSION_STATES,
  pricing,
  product,
  stock,
  uom,
  user,
} from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'

const modules = [address, partner, company, user, uom, product, pricing, stock, account, pos]
const manifest = compose(modules, { headless: true }),
  scope = { company: 'acme', branches: null }
const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  callFn(name, args, { adapter, manifest, scope })
async function boot() {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, adapter)
  await call('partner.savePartner', { id: 'customer', kind: 'company', name: 'Customer' }, adapter)
  await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }, adapter)
  await call(
    'user.createUser',
    { id: 'cashier', login: 'cashier', password: 'correct horse', name: 'Cashier', defaultCompanyId: 'acme' },
    adapter,
  )
  await call('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' }, adapter)
  await call(
    'product.saveTemplate',
    { id: 'goods', name: 'Goods', type: 'goods', uomId: 'unit', listPrice: '100', saleOk: true },
    adapter,
  )
  await call(
    'product.saveVariant',
    { id: 'goods-1', templateId: 'goods', defaultCode: 'G1', combinationKey: '' },
    adapter,
  )
  await call('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' }, adapter)
  await call('stock.saveWarehouse', { id: 'wh', name: 'Main', code: 'WH' }, adapter)
  await call('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' }, adapter)
  await call(
    'stock.adjustInventory',
    {
      id: 'adjust',
      productId: 'goods-1',
      locationId: 'wh:stock',
      inventoryLocationId: 'inventory',
      countedQuantity: '10',
      productUomId: 'unit',
    },
    adapter,
  )
  for (const [id, code, name, accountType] of [
    ['revenue', '5111', 'Revenue', 'income'],
    ['receivable', '131', 'Receivable', 'asset_receivable'],
    ['tax', '3331', 'VAT', 'liability_current'],
    ['cash', '1111', 'Cash', 'asset_cash'],
  ])
    await call('account.saveAccount', { id, code, name, accountType }, adapter)
  await call('account.saveJournal', { id: 'sales', name: 'Sales', code: 'SAL', type: 'sale' }, adapter)
  await call(
    'account.saveJournal',
    { id: 'cash-journal', name: 'Cash', code: 'CSH', type: 'cash', defaultAccountId: 'cash' },
    adapter,
  )
  await call(
    'account.saveTax',
    { id: 'vat10', name: 'VAT 10%', typeTaxUse: 'sale', amountType: 'percent', amount: '10' },
    adapter,
  )
  await call('pricing.savePricelist', { id: 'retail', name: 'Retail' }, adapter)
  await call(
    'pricing.savePricelistItem',
    {
      id: 'retail:goods',
      pricelistId: 'retail',
      appliedOn: '0_product_variant',
      productId: 'goods-1',
      computePrice: 'fixed',
      fixedPrice: '90',
    },
    adapter,
  )
  await call(
    'pos.saveConfig',
    {
      id: 'shop',
      name: 'Main Shop',
      warehouseId: 'wh',
      pricelistId: 'retail',
      salesJournalId: 'sales',
      revenueAccountId: 'revenue',
      receivableAccountId: 'receivable',
      taxAccountId: 'tax',
      maximumDifference: '0',
    },
    adapter,
  )
  await call(
    'pos.savePaymentMethod',
    { id: 'cash-method', name: 'Cash', journalId: 'cash-journal', isCash: true },
    adapter,
  )
  await call(
    'pos.linkPaymentMethod',
    { id: 'shop:cash', configId: 'shop', paymentMethodId: 'cash-method' },
    adapter,
  )
  return adapter
}

test('pos: exact session/order states, pricing, payment, stock and accounting form one retail flow', async () => {
  const adapter = await boot()
  try {
    assert.deepEqual(POS_SESSION_STATES, ['opening_control', 'opened', 'closing_control', 'closed'])
    assert.deepEqual(POS_ORDER_STATES, ['draft', 'cancel', 'paid', 'done'])
    await call(
      'pos.createSession',
      { id: 'session-1', configId: 'shop', userId: 'cashier', openingCash: '10' },
      adapter,
    )
    await call('pos.openSession', { id: 'session-1' }, adapter)
    await call(
      'pos.createOrder',
      { id: 'order-1', uuid: 'offline-uuid-1', sessionId: 'session-1', partnerId: 'customer' },
      adapter,
    )
    const line = (
      await call(
        'pos.addLine',
        {
          id: 'line-1',
          orderId: 'order-1',
          productId: 'goods-1',
          productUomId: 'unit',
          qty: '1',
          taxId: 'vat10',
        },
        adapter,
      )
    ).value as Row
    assert.equal(line.priceUnit, '90')
    assert.deepEqual(
      Object.values(
        (
          await adapter.all(
            'SELECT "amountUntaxed", "amountTax", "amountTotal" FROM pos_order WHERE id = ?',
            ['order-1'],
          )
        )[0]!,
      ),
      ['90', '9', '99'],
    )
    let lineUpdates = 0
    let taxReads = 0
    const recording: Adapter = {
      ...adapter,
      async all(sql, params) {
        if (sql.includes('FROM account_tax')) taxReads++
        return adapter.all(sql, params)
      },
      async run(sql, params) {
        if (sql.startsWith('UPDATE pos_order_line')) lineUpdates++
        return adapter.run(sql, params)
      },
    }
    await call(
      'pos.addPayment',
      { id: 'payment-1', orderId: 'order-1', paymentMethodId: 'cash-method', amount: '99' },
      recording,
    )
    assert.equal(
      taxReads,
      0,
      'payment recomputation uses stored line totals instead of reloading tax per line',
    )
    assert.equal(lineUpdates, 0, 'payment recomputation does not rewrite every order line')
    const paid = (await call('pos.validateOrder', { id: 'order-1' }, adapter)).value as Row
    assert.equal(paid.state, 'paid')
    assert.equal(paid.pickingId, 'order-1:picking')
    assert.equal(
      (
        await adapter.all('SELECT quantity FROM stock_quant WHERE "productId" = ? AND "locationId" = ?', [
          'goods-1',
          'wh:stock',
        ])
      )[0]!.quantity,
      '9',
    )
    const move = (await adapter.all('SELECT state FROM account_move WHERE id = ?', ['order-1:account']))[0]!
    assert.equal(move.state, 'posted')
    const totals = await adapter.all('SELECT debit, credit FROM account_move_line WHERE "moveId" = ?', [
      'order-1:account',
    ])
    assert.equal(
      totals.reduce((sum, row) => sum + Number(row.debit), 0),
      99,
    )
    assert.equal(
      totals.reduce((sum, row) => sum + Number(row.credit), 0),
      99,
    )
    await call('pos.startClosing', { id: 'session-1' }, adapter)
    const closed = (await call('pos.closeSession', { id: 'session-1', closingCash: '109' }, adapter))
      .value as Row
    assert.equal(closed.difference, '0')
    assert.equal(
      (await adapter.all('SELECT state FROM pos_order WHERE id = ?', ['order-1']))[0]!.state,
      'done',
    )
  } finally {
    await adapter.close()
  }
})

test('pos: refunds use a new open session, reverse accounting and return stock', async () => {
  const adapter = await boot()
  try {
    await call('pos.createSession', { id: 's1', configId: 'shop', userId: 'cashier' }, adapter)
    await call('pos.openSession', { id: 's1' }, adapter)
    await call('pos.createOrder', { id: 'sale', sessionId: 's1' }, adapter)
    await call(
      'pos.addLine',
      {
        id: 'sale:line',
        orderId: 'sale',
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '1',
        priceUnit: '100',
      },
      adapter,
    )
    await call(
      'pos.addPayment',
      { id: 'sale:pay', orderId: 'sale', paymentMethodId: 'cash-method', amount: '100' },
      adapter,
    )
    await call('pos.validateOrder', { id: 'sale' }, adapter)
    await call('pos.startClosing', { id: 's1' }, adapter)
    await call('pos.closeSession', { id: 's1', closingCash: '100' }, adapter)
    await call('pos.createSession', { id: 's2', configId: 'shop', userId: 'cashier' }, adapter)
    await call('pos.openSession', { id: 's2' }, adapter)
    await call('pos.refundOrder', { id: 'refund', originalOrderId: 'sale', sessionId: 's2' }, adapter)
    assert.equal(
      (await adapter.all('SELECT "amountTotal" FROM pos_order WHERE id = ?', ['refund']))[0]!.amountTotal,
      '-100',
    )
    await call(
      'pos.addPayment',
      { id: 'refund:pay', orderId: 'refund', paymentMethodId: 'cash-method', amount: '-100' },
      adapter,
    )
    await call('pos.validateOrder', { id: 'refund' }, adapter)
    assert.equal(
      (
        await adapter.all('SELECT quantity FROM stock_quant WHERE "productId" = ? AND "locationId" = ?', [
          'goods-1',
          'wh:stock',
        ])
      )[0]!.quantity,
      '10',
    )
    const lines = await adapter.all('SELECT debit, credit FROM account_move_line WHERE "moveId" = ?', [
      'refund:account',
    ])
    assert.equal(
      lines.reduce((sum, row) => sum + Number(row.debit), 0),
      100,
    )
    assert.equal(
      lines.reduce((sum, row) => sum + Number(row.credit), 0),
      100,
    )
  } finally {
    await adapter.close()
  }
})

test('pos: customer invoice is posted and reconciled by the POS payment', async () => {
  const adapter = await boot()
  try {
    await call('pos.createSession', { id: 'session', configId: 'shop', userId: 'cashier' }, adapter)
    await call('pos.openSession', { id: 'session' }, adapter)
    await call(
      'pos.createOrder',
      { id: 'invoice-order', sessionId: 'session', partnerId: 'customer', toInvoice: true },
      adapter,
    )
    await call(
      'pos.addLine',
      {
        id: 'invoice-line',
        orderId: 'invoice-order',
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '1',
        priceUnit: '100',
      },
      adapter,
    )
    await call(
      'pos.addPayment',
      { id: 'invoice-payment', orderId: 'invoice-order', paymentMethodId: 'cash-method', amount: '100' },
      adapter,
    )
    await call('pos.validateOrder', { id: 'invoice-order' }, adapter)
    const invoice = (
      await adapter.all('SELECT "moveType", state, "paymentState" FROM account_move WHERE id = ?', [
        'invoice-order:account',
      ])
    )[0]!
    assert.equal(invoice.moveType, 'out_invoice')
    assert.equal(invoice.state, 'posted')
    assert.equal(invoice.paymentState, 'paid')
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM account_partial_reconcile'))[0]!.n, 1)
  } finally {
    await adapter.close()
  }
})
