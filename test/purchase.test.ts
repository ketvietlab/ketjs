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

test('purchase: a pricelist row prices the order in its own unit', async () => {
  const adapter = await boot()
  try {
    await call(
      'uom.saveUnit',
      { id: 'box', name: 'Box', relativeFactor: '12', relativeUomId: 'unit' },
      adapter,
    )
    await call('uom.saveUnit', { id: 'kg', name: 'Kg', relativeFactor: '1' }, adapter)
    // The vendor quotes per piece; the buyer orders in boxes. The fixture row
    // (80 per unit from 5 units, 5% off) has to match an order of one box —
    // twelve pieces — and be charged per box, not per piece.
    await call(
      'purchase.createOrder',
      { id: 'po', partnerId: 'vendor', pickingTypeId: 'incoming', dateOrder: '2026-08-20T00:00:00.000Z' },
      adapter,
    )
    const line = (
      await call(
        'purchase.addLine',
        { id: 'po:line', orderId: 'po', productId: 'goods-1', productQty: '1', productUomId: 'box' },
        adapter,
      )
    ).value as Row
    assert.equal(line.priceUnit, '960')

    // A row in another measurement tree can never price a line, so it is
    // refused at save time instead of silently matching nothing.
    const wrongTree = (
      await call(
        'purchase.saveSupplierInfo',
        { id: 'si-kg', partnerId: 'vendor', productTemplateId: 'goods', productUomId: 'kg', price: '50' },
        adapter,
      )
    ).value as Row
    assert.equal(wrongTree.ok, false)
    const backwards = (
      await call(
        'purchase.saveSupplierInfo',
        {
          id: 'si-dates',
          partnerId: 'vendor',
          productTemplateId: 'goods',
          productUomId: 'unit',
          price: '70',
          dateStart: '2026-12-01T00:00:00.000Z',
          dateEnd: '2026-01-01T00:00:00.000Z',
        },
        adapter,
      )
    ).value as Row
    assert.equal(backwards.ok, false)
  } finally {
    await adapter.close()
  }
})

test('purchase: a locked order refuses cancellation until it is unlocked', async () => {
  const adapter = await boot()
  try {
    await call(
      'purchase.createOrder',
      { id: 'po', partnerId: 'vendor', pickingTypeId: 'incoming', dateOrder: '2026-08-20T00:00:00.000Z' },
      adapter,
    )
    await call(
      'purchase.addLine',
      { id: 'po:line', orderId: 'po', productId: 'goods-1', productQty: '1', productUomId: 'unit' },
      adapter,
    )
    await call('purchase.confirmOrder', { id: 'po' }, adapter)
    await call('purchase.lockOrder', { id: 'po', locked: true }, adapter)
    const refused = (await call('purchase.cancelOrder', { id: 'po' }, adapter)).value as Row
    assert.equal(refused.ok, false)
    await call('purchase.lockOrder', { id: 'po', locked: false }, adapter)
    const cancelled = (await call('purchase.cancelOrder', { id: 'po' }, adapter)).value as Row
    assert.equal(cancelled.ok, true)
  } finally {
    await adapter.close()
  }
})

test('purchase: a line is ordered in the vendor unit and received in the product unit', async () => {
  const adapter = await boot()
  try {
    await call(
      'uom.saveUnit',
      { id: 'box', name: 'Box', relativeFactor: '12', relativeUomId: 'unit' },
      adapter,
    )
    await call('uom.saveUnit', { id: 'kg', name: 'Kg', relativeFactor: '1' }, adapter)
    await call(
      'purchase.createOrder',
      { id: 'po', partnerId: 'vendor', pickingTypeId: 'incoming', dateOrder: '2026-08-20T00:00:00.000Z' },
      adapter,
    )
    // A unit from another measurement tree is not a unit for this product.
    const wrong = (
      await call(
        'purchase.addLine',
        { id: 'po:wrong', orderId: 'po', productId: 'goods-1', productQty: '5', productUomId: 'kg' },
        adapter,
      )
    ).value as Row
    assert.equal(wrong.ok, false)
    assert.equal((wrong.errors as Row[])[0]?.field, 'productUomId')

    await call(
      'purchase.addLine',
      {
        id: 'po:line',
        orderId: 'po',
        productId: 'goods-1',
        productQty: '2',
        productUomId: 'box',
        priceUnit: '1200',
      },
      adapter,
    )
    await call('purchase.confirmOrder', { id: 'po' }, adapter)
    // The warehouse counts pieces, so it is asked for twenty-four, not two.
    const move = (
      await adapter.all(
        'SELECT id, "productUomId", "productUomQty" FROM stock_move WHERE "purchaseLineId" = ?',
        ['po:line'],
      )
    )[0]!
    assert.equal(move.productUomId, 'unit')
    assert.equal(Number(move.productUomQty), 24)

    await call('stock.confirmPicking', { id: 'po:receipt' }, adapter)
    await call('stock.saveMoveLine', { id: 'rl', moveId: move.id, quantity: '24', picked: true }, adapter)
    await call('stock.completePicking', { id: 'po:receipt' }, adapter)
    await call('purchase.syncReceipts', { id: 'po' }, adapter)
    // …and comes back in the unit the buyer ordered.
    const line = (await adapter.all('SELECT "qtyReceived" FROM purchase_order_line'))[0]!
    assert.equal(Number(line.qtyReceived), 2)
  } finally {
    await adapter.close()
  }
})

test('purchase: a request line can be corrected and removed until it is confirmed', async () => {
  const adapter = await boot()
  try {
    await call(
      'purchase.createOrder',
      { id: 'po', partnerId: 'vendor', pickingTypeId: 'incoming', dateOrder: '2026-08-20T00:00:00.000Z' },
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
        priceUnit: '100',
        discount: '0',
      },
      adapter,
    )
    // Adding the same id again reports the line as it stands, never a price it
    // did not write.
    const repeat = (
      await call(
        'purchase.addLine',
        {
          id: 'po:line',
          orderId: 'po',
          productId: 'goods-1',
          productQty: '50',
          productUomId: 'unit',
          priceUnit: '999',
        },
        adapter,
      )
    ).value as Row
    assert.equal(repeat.existing, true)
    assert.equal(repeat.priceUnit, '100')

    const edited = (
      await call('purchase.updateLine', { id: 'po:line', productQty: '8', priceUnit: '90' }, adapter)
    ).value as Row
    assert.equal(edited.ok, true)
    assert.equal((await adapter.all('SELECT "amountTotal" FROM purchase_order'))[0]!.amountTotal, '720')

    await call('purchase.removeLine', { id: 'po:line' }, adapter)
    assert.equal((await adapter.all('SELECT id FROM purchase_order_line')).length, 0)
    assert.equal((await adapter.all('SELECT "amountTotal" FROM purchase_order'))[0]!.amountTotal, '0')

    // A confirmed order is no longer a request.
    await call(
      'purchase.addLine',
      { id: 'po:again', orderId: 'po', productId: 'goods-1', productQty: '1', productUomId: 'unit' },
      adapter,
    )
    await call('purchase.confirmOrder', { id: 'po' }, adapter)
    const late = (await call('purchase.updateLine', { id: 'po:again', productQty: '3' }, adapter))
      .value as Row
    assert.equal(late.ok, false)
  } finally {
    await adapter.close()
  }
})

test('purchase: cancelling a vendor bill releases the quantity it billed', async () => {
  const adapter = await boot()
  try {
    await call('purchase.setPurchaseMethod', { templateId: 'goods', purchaseMethod: 'purchase' }, adapter)
    await call(
      'purchase.createOrder',
      { id: 'po', partnerId: 'vendor', pickingTypeId: 'incoming', dateOrder: '2026-08-20T00:00:00.000Z' },
      adapter,
    )
    await call(
      'purchase.addLine',
      {
        id: 'po:line',
        orderId: 'po',
        productId: 'goods-1',
        productQty: '10',
        productUomId: 'unit',
        priceUnit: '100',
        discount: '0',
      },
      adapter,
    )
    await call('purchase.confirmOrder', { id: 'po' }, adapter)
    const billed = (
      await call(
        'purchase.createVendorBill',
        {
          id: 'bill-1',
          orderId: 'po',
          journalId: 'purchase-journal',
          expenseAccountId: 'expense',
          payableAccountId: 'payable',
        },
        adapter,
      )
    ).value as Row
    assert.equal(billed.ok, true)
    const invoiced = (await call('purchase.getOrder', { id: 'po' }, adapter)).value as Row
    assert.equal(Number((invoiced.lines as Row[])[0]?.qtyInvoiced), 10)
    assert.equal(invoiced.invoiceStatus, 'invoiced')

    // A bill drafted by mistake must not lock the order out of being billed.
    await call('account.cancelMove', { id: 'bill-1' }, adapter)
    const released = (await call('purchase.getOrder', { id: 'po' }, adapter)).value as Row
    assert.equal(Number((released.lines as Row[])[0]?.qtyInvoiced), 0)
    assert.equal(released.invoiceStatus, 'to invoice')
    const again = (
      await call(
        'purchase.createVendorBill',
        {
          id: 'bill-2',
          orderId: 'po',
          journalId: 'purchase-journal',
          expenseAccountId: 'expense',
          payableAccountId: 'payable',
        },
        adapter,
      )
    ).value as Row
    assert.equal(again.ok, true)
    assert.equal(again.amountTotal, '1000')
  } finally {
    await adapter.close()
  }
})

test('purchase: supplier price, confirmation and receipt integrate with Stock', async () => {
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

test('purchase: received-quantity billing creates one balanced multi-line vendor bill', async () => {
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
    // The source order can carry sub-đồng precision, but a VND ledger cannot.
    // Quantize once at the shared posting boundary: 228 + 22.8 VAT becomes 251 đồng.
    assert.equal(billed.amountTotal, '251')
    const journalItems = await adapter.all(
      'SELECT debit, credit, "purchaseLineId" FROM account_move_line WHERE "moveId" = ?',
      ['bill'],
    )
    assert.equal(
      journalItems.reduce((sum, row) => sum + Number(row.debit), 0),
      251,
    )
    assert.equal(
      journalItems.reduce((sum, row) => sum + Number(row.credit), 0),
      251,
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

test('purchase: approval, locking, idempotency and stable state codes', async () => {
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

test('purchase: services bill ordered quantities without an empty receipt and price-included tax stays included', async () => {
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

test('purchase: order totals and vendor bills stay exact above the JavaScript safe integer', async () => {
  const adapter = await boot()
  try {
    await call(
      'product.saveTemplate',
      { id: 'exact-service', name: 'Exact service', type: 'service', uomId: 'unit', purchaseOk: true },
      adapter,
    )
    await call(
      'product.saveVariant',
      { id: 'exact-service-1', templateId: 'exact-service', combinationKey: '' },
      adapter,
    )
    await call(
      'purchase.createOrder',
      { id: 'exact-po', partnerId: 'vendor', pickingTypeId: 'incoming' },
      adapter,
    )
    await call(
      'purchase.addLine',
      {
        id: 'exact-po:line',
        orderId: 'exact-po',
        productId: 'exact-service-1',
        productQty: '1',
        productUomId: 'unit',
        priceUnit: '9007199254740993',
      },
      adapter,
    )
    assert.equal(
      ((await call('purchase.getOrder', { id: 'exact-po' }, adapter)).value as Row).amountTotal,
      '9007199254740993',
    )
    await call('purchase.confirmOrder', { id: 'exact-po' }, adapter)
    const bill = (
      await call(
        'purchase.createVendorBill',
        {
          id: 'exact-bill',
          orderId: 'exact-po',
          journalId: 'purchase-journal',
          expenseAccountId: 'expense',
          payableAccountId: 'payable',
        },
        adapter,
      )
    ).value as Row
    assert.equal(bill.amountTotal, '9007199254740993')
    assert.equal(((await call('account.postMove', { id: 'exact-bill' }, adapter)).value as Row).ok, true)
  } finally {
    await adapter.close()
  }
})

test('purchase: cancelling an unreceived PO also cancels its receipt', async () => {
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
