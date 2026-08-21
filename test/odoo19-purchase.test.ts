import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import {
  account,
  company,
  partner,
  product,
  purchase,
  PURCHASE_STATES,
  stock,
  uom,
} from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'

const modules = [address, partner, company, uom, product, stock, account, purchase]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }
const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  callFn(name, args, { adapter, manifest, scope })

async function boot() {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, adapter)
  await call('partner.savePartner', { id: 'vendor', kind: 'company', name: 'Vendor ABC' }, adapter)
  await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }, adapter)
  await call('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' }, adapter)
  await call(
    'product.saveTemplate',
    { id: 'goods', name: 'Goods', type: 'goods', uomId: 'unit', listPrice: '100', purchaseOk: true },
    adapter,
  )
  await call(
    'product.saveVariant',
    { id: 'goods-1', templateId: 'goods', defaultCode: 'GOODS', combinationKey: '' },
    adapter,
  )
  await call('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' }, adapter)
  await call('stock.saveLocation', { id: 'supplier', name: 'Vendors', usage: 'supplier' }, adapter)
  await call('stock.saveLocation', { id: 'stock', name: 'Stock', usage: 'internal' }, adapter)
  await call(
    'stock.savePickingType',
    {
      id: 'incoming',
      name: 'Receipts',
      code: 'incoming',
      defaultLocationSrcId: 'supplier',
      defaultLocationDestId: 'stock',
      createBackorder: 'always',
    },
    adapter,
  )
  for (const [id, code, name, accountType] of [
    ['expense', '6421', 'Expense', 'expense'],
    ['payable', '331', 'Payable', 'liability_payable'],
    ['tax', '1331', 'Input VAT', 'asset_current'],
  ])
    await call('account.saveAccount', { id, code, name, accountType }, adapter)
  await call(
    'account.saveJournal',
    { id: 'purchase-journal', name: 'Purchases', code: 'PUR', type: 'purchase' },
    adapter,
  )
  await call(
    'account.saveTax',
    { id: 'vat10', name: 'VAT 10%', typeTaxUse: 'purchase', amountType: 'percent', amount: '10' },
    adapter,
  )
  await call(
    'purchase.saveSupplierInfo',
    {
      id: 'vendor:goods',
      partnerId: 'vendor',
      productTemplateId: 'goods',
      productId: 'goods-1',
      productUomId: 'unit',
      minQty: '5',
      price: '80',
      discount: '5',
      delay: 2,
    },
    adapter,
  )
  return adapter
}

test('purchase 19: supplier price, confirmation and receipt integrate with Stock', async () => {
  const adapter = await boot()
  try {
    await call(
      'purchase.createOrder',
      {
        id: 'po',
        partnerId: 'vendor',
        partnerRef: 'V-100',
        pickingTypeId: 'incoming',
        dateOrder: '2026-08-20T00:00:00.000Z',
      },
      adapter,
    )
    const line = await call(
      'purchase.addLine',
      {
        id: 'po:line',
        orderId: 'po',
        productId: 'goods-1',
        productQty: '5',
        productUomId: 'unit',
        taxId: 'vat10',
      },
      adapter,
    )
    assert.equal((line.value as Row).priceUnit, '80')
    const totals = (
      await adapter.all('SELECT "amountUntaxed", "amountTax", "amountTotal" FROM purchase_order')
    )[0]!
    assert.deepEqual([totals.amountUntaxed, totals.amountTax, totals.amountTotal], ['380', '38', '418'])
    const confirmed = (await call('purchase.confirmOrder', { id: 'po' }, adapter)).value as Row
    assert.equal(confirmed.state, 'purchase')
    assert.equal(confirmed.pickingId, 'po:receipt')
    const move = (await adapter.all('SELECT id FROM stock_move WHERE "purchaseLineId" = ?', ['po:line']))[0]!
    await call('stock.confirmPicking', { id: 'po:receipt' }, adapter)
    await call(
      'stock.saveMoveLine',
      { id: 'receipt:line', moveId: move.id, quantity: '5', picked: true },
      adapter,
    )
    await call('stock.completePicking', { id: 'po:receipt' }, adapter)
    const synced = (await call('purchase.syncReceipts', { id: 'po' }, adapter)).value as Row
    assert.equal(synced.invoiceStatus, 'to invoice')
    assert.equal((await adapter.all('SELECT "qtyReceived" FROM purchase_order_line'))[0]!.qtyReceived, '5')
  } finally {
    await adapter.close()
  }
})

test('purchase 19: received-quantity billing creates one balanced multi-line vendor bill', async () => {
  const adapter = await boot()
  try {
    await call(
      'purchase.createOrder',
      { id: 'po', partnerId: 'vendor', partnerRef: 'V-101', pickingTypeId: 'incoming' },
      adapter,
    )
    await call(
      'purchase.addLine',
      {
        id: 'po:line',
        orderId: 'po',
        productId: 'goods-1',
        productQty: '5',
        productUomId: 'unit',
        priceUnit: '80',
        taxId: 'vat10',
      },
      adapter,
    )
    await call('purchase.confirmOrder', { id: 'po' }, adapter)
    const move = (await adapter.all('SELECT id FROM stock_move WHERE "purchaseLineId" = ?', ['po:line']))[0]!
    await call('stock.confirmPicking', { id: 'po:receipt' }, adapter)
    await call(
      'stock.saveMoveLine',
      { id: 'receipt:line', moveId: move.id, quantity: '3', picked: true },
      adapter,
    )
    await call('stock.completePicking', { id: 'po:receipt', createBackorder: true }, adapter)
    await call('purchase.syncReceipts', { id: 'po' }, adapter)
    const billed = (
      await call(
        'purchase.createVendorBill',
        {
          id: 'bill',
          orderId: 'po',
          journalId: 'purchase-journal',
          expenseAccountId: 'expense',
          payableAccountId: 'payable',
          taxAccountId: 'tax',
        },
        adapter,
      )
    ).value as Row
    assert.equal(billed.amountTotal, '250.8')
    const journalItems = await adapter.all(
      'SELECT debit, credit, "purchaseLineId" FROM account_move_line WHERE "moveId" = ?',
      ['bill'],
    )
    assert.equal(
      journalItems.reduce((sum, row) => sum + Number(row.debit), 0),
      250.8,
    )
    assert.equal(
      journalItems.reduce((sum, row) => sum + Number(row.credit), 0),
      250.8,
    )
    assert.equal(journalItems.filter((row) => row.purchaseLineId === 'po:line').length, 2)
    assert.equal(
      (await adapter.all('SELECT "invoiceStatus" FROM purchase_order'))[0]!.invoiceStatus,
      'invoiced',
    )
  } finally {
    await adapter.close()
  }
})

test('purchase 19: approval, locking, idempotency and exact Odoo state codes', async () => {
  const adapter = await boot()
  try {
    const first = (
      await call(
        'purchase.createOrder',
        { id: 'po', partnerId: 'vendor', partnerRef: 'V-102', pickingTypeId: 'incoming' },
        adapter,
      )
    ).value as Row
    const retry = (
      await call(
        'purchase.createOrder',
        { id: 'po', partnerId: 'vendor', partnerRef: 'V-102', pickingTypeId: 'incoming' },
        adapter,
      )
    ).value as Row
    assert.equal(first.name, retry.name)
    await call(
      'purchase.addLine',
      { id: 'po:line', orderId: 'po', productId: 'goods-1', productQty: '5', productUomId: 'unit' },
      adapter,
    )
    assert.equal(
      ((await call('purchase.confirmOrder', { id: 'po', requiresApproval: true }, adapter)).value as Row)
        .state,
      'to approve',
    )
    assert.equal(
      ((await call('purchase.approveOrder', { id: 'po' }, adapter)).value as Row).state,
      'purchase',
    )
    await call('purchase.lockOrder', { id: 'po', locked: true }, adapter)
    assert.equal((await adapter.all('SELECT locked FROM purchase_order'))[0]!.locked, 1)
    assert.deepEqual(PURCHASE_STATES, ['draft', 'sent', 'to approve', 'purchase', 'cancel'])
  } finally {
    await adapter.close()
  }
})

test('purchase 19: services bill ordered quantities without an empty receipt and price-included tax stays included', async () => {
  const adapter = await boot()
  try {
    await call(
      'product.saveTemplate',
      { id: 'service', name: 'Service', type: 'service', uomId: 'unit', listPrice: '110', purchaseOk: true },
      adapter,
    )
    await call('product.saveVariant', { id: 'service-1', templateId: 'service', combinationKey: '' }, adapter)
    await call(
      'account.saveTax',
      {
        id: 'vat-included',
        name: 'VAT included',
        typeTaxUse: 'purchase',
        amountType: 'percent',
        amount: '10',
        priceInclude: true,
      },
      adapter,
    )
    await call(
      'purchase.createOrder',
      { id: 'service-po', partnerId: 'vendor', partnerRef: 'SVC-1', pickingTypeId: 'incoming' },
      adapter,
    )
    await call(
      'purchase.addLine',
      {
        id: 'service-line',
        orderId: 'service-po',
        productId: 'service-1',
        productQty: '1',
        productUomId: 'unit',
        priceUnit: '110',
        discount: '0',
        taxId: 'vat-included',
      },
      adapter,
    )
    const before = (
      await adapter.all(
        'SELECT "amountUntaxed", "amountTax", "amountTotal" FROM purchase_order WHERE id = ?',
        ['service-po'],
      )
    )[0]!
    assert.deepEqual([before.amountUntaxed, before.amountTax, before.amountTotal], ['100', '10', '110'])
    const confirmed = (await call('purchase.confirmOrder', { id: 'service-po' }, adapter)).value as Row
    assert.equal('pickingId' in confirmed, false)
    assert.equal(
      (await adapter.all('SELECT COUNT(*) AS n FROM stock_picking WHERE id = ?', ['service-po:receipt']))[0]!
        .n,
      0,
    )
    assert.equal(
      (await adapter.all('SELECT "invoiceStatus" FROM purchase_order WHERE id = ?', ['service-po']))[0]!
        .invoiceStatus,
      'to invoice',
    )
  } finally {
    await adapter.close()
  }
})

test('purchase 19: cancelling an unreceived PO also cancels its receipt', async () => {
  const adapter = await boot()
  try {
    await call(
      'purchase.createOrder',
      { id: 'po', partnerId: 'vendor', partnerRef: 'V-CANCEL', pickingTypeId: 'incoming' },
      adapter,
    )
    await call(
      'purchase.addLine',
      { id: 'po:line', orderId: 'po', productId: 'goods-1', productQty: '1', productUomId: 'unit' },
      adapter,
    )
    await call('purchase.confirmOrder', { id: 'po' }, adapter)
    assert.equal(((await call('purchase.cancelOrder', { id: 'po' }, adapter)).value as Row).ok, true)
    assert.equal(
      (await adapter.all('SELECT state FROM stock_picking WHERE id = ?', ['po:receipt']))[0]!.state,
      'cancel',
    )
    assert.equal(
      (await adapter.all('SELECT state FROM stock_move WHERE "purchaseLineId" = ?', ['po:line']))[0]!.state,
      'cancel',
    )
  } finally {
    await adapter.close()
  }
})
