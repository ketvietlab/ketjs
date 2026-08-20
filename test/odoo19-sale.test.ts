import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from 'ketjs'
import type { Adapter, Row } from 'ketjs'
import { account, company, partner, pricing, product, sale, SALE_STATES, stock, uom } from 'ketsuite'
import { address } from 'ketsuite'

const modules = [address, partner, company, uom, product, pricing, stock, account, sale]
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
  await call('partner.savePartner', { id: 'customer', kind: 'company', name: 'Customer' }, adapter)
  await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }, adapter)
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
  ])
    await call('account.saveAccount', { id, code, name, accountType }, adapter)
  await call(
    'account.saveJournal',
    { id: 'sales-journal', name: 'Sales', code: 'SAL', type: 'sale' },
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
  return adapter
}

test('sale 19: quotation pricing, confirmation and delivery integrate with Stock', async () => {
  const adapter = await boot()
  try {
    await call('sale.setInvoicePolicy', { templateId: 'goods', invoicePolicy: 'delivery' }, adapter)
    await call(
      'sale.createOrder',
      { id: 'so', partnerId: 'customer', warehouseId: 'wh', pricelistId: 'retail' },
      adapter,
    )
    const line = (
      await call(
        'sale.addLine',
        {
          id: 'so:line',
          orderId: 'so',
          productId: 'goods-1',
          productUomQty: '4',
          productUomId: 'unit',
          taxId: 'vat10',
        },
        adapter,
      )
    ).value as Row
    assert.equal(line.priceUnit, '90')
    assert.deepEqual(
      Object.values(
        (await adapter.all('SELECT "amountUntaxed", "amountTax", "amountTotal" FROM sale_order'))[0]!,
      ),
      ['360', '36', '396'],
    )
    const confirmed = (await call('sale.confirmOrder', { id: 'so' }, adapter)).value as Row
    assert.equal(confirmed.pickingId, 'so:delivery')
    await call('stock.confirmPicking', { id: 'so:delivery' }, adapter)
    await call('stock.reserveMove', { id: 'so:line:delivery' }, adapter)
    const moveLine = (
      await adapter.all('SELECT id FROM stock_move_line WHERE "moveId" = ?', ['so:line:delivery'])
    )[0]!
    await call(
      'stock.completePicking',
      { id: 'so:delivery', quantities: [{ moveLineId: moveLine.id, quantity: 3 }], createBackorder: true },
      adapter,
    )
    assert.equal(
      ((await call('sale.syncDeliveries', { id: 'so' }, adapter)).value as Row).invoiceStatus,
      'to invoice',
    )
    assert.equal((await adapter.all('SELECT "qtyDelivered" FROM sale_order_line'))[0]!.qtyDelivered, '3')
  } finally {
    await adapter.close()
  }
})

test('sale 19: delivered quantity creates a balanced multi-line customer invoice', async () => {
  const adapter = await boot()
  try {
    await call('sale.setInvoicePolicy', { templateId: 'goods', invoicePolicy: 'delivery' }, adapter)
    await call('sale.createOrder', { id: 'so', partnerId: 'customer', warehouseId: 'wh' }, adapter)
    await call(
      'sale.addLine',
      {
        id: 'so:line',
        orderId: 'so',
        productId: 'goods-1',
        productUomQty: '2',
        productUomId: 'unit',
        priceUnit: '100',
        taxId: 'vat10',
      },
      adapter,
    )
    await call('sale.confirmOrder', { id: 'so' }, adapter)
    await call('stock.confirmPicking', { id: 'so:delivery' }, adapter)
    await call('stock.reserveMove', { id: 'so:line:delivery' }, adapter)
    await call('stock.completePicking', { id: 'so:delivery' }, adapter)
    await call('sale.syncDeliveries', { id: 'so' }, adapter)
    const invoiced = (
      await call(
        'sale.createInvoice',
        {
          id: 'invoice',
          orderId: 'so',
          journalId: 'sales-journal',
          revenueAccountId: 'revenue',
          receivableAccountId: 'receivable',
          taxAccountId: 'tax',
        },
        adapter,
      )
    ).value as Row
    assert.equal(invoiced.amountTotal, '220')
    const lines = await adapter.all(
      'SELECT debit, credit, "saleLineId" FROM account_move_line WHERE "moveId" = ?',
      ['invoice'],
    )
    assert.equal(
      lines.reduce((sum, line) => sum + Number(line.debit), 0),
      220,
    )
    assert.equal(
      lines.reduce((sum, line) => sum + Number(line.credit), 0),
      220,
    )
    assert.equal((await adapter.all('SELECT "invoiceStatus" FROM sale_order'))[0]!.invoiceStatus, 'invoiced')
  } finally {
    await adapter.close()
  }
})

test('sale 19: service orders invoice ordered quantities without an empty delivery', async () => {
  const adapter = await boot()
  try {
    await call(
      'product.saveTemplate',
      { id: 'service', name: 'Consulting', type: 'service', uomId: 'unit', listPrice: '100', saleOk: true },
      adapter,
    )
    await call('product.saveVariant', { id: 'service-1', templateId: 'service', combinationKey: '' }, adapter)
    await call('sale.createOrder', { id: 'so', partnerId: 'customer', warehouseId: 'wh' }, adapter)
    await call(
      'sale.addLine',
      { id: 'so:line', orderId: 'so', productId: 'service-1', productUomQty: '1', productUomId: 'unit' },
      adapter,
    )
    const confirmed = (await call('sale.confirmOrder', { id: 'so' }, adapter)).value as Row
    assert.equal('pickingId' in confirmed, false)
    assert.equal(
      (await adapter.all('SELECT COUNT(*) AS n FROM stock_picking WHERE id = ?', ['so:delivery']))[0]!.n,
      0,
    )
    assert.equal(
      (await adapter.all('SELECT "invoiceStatus" FROM sale_order'))[0]!.invoiceStatus,
      'to invoice',
    )
    assert.deepEqual(SALE_STATES, ['draft', 'sent', 'sale', 'cancel'])
  } finally {
    await adapter.close()
  }
})
