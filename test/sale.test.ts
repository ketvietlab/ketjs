import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import {
  account,
  company,
  partner,
  pricing,
  product,
  sale,
  SALE_STATES,
  stock,
  uom,
} from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'

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

test('sale: quotation pricing, confirmation and delivery integrate with Stock', async () => {
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

test('sale: delivered quantity creates a balanced multi-line customer invoice', async () => {
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

test('sale: service orders invoice ordered quantities without an empty delivery', async () => {
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

/** A session that reads two companies but writes to one — the scope that tells narrowing apart. */
const bothCompanies = { company: 'acme', companies: ['acme', 'globex'], branches: null }
const callAs = (
  name: string,
  args: Record<string, unknown>,
  adapter: Adapter,
  as: { company: string; companies?: string[]; branches: null } = scope,
) => callFn(name, args, { adapter, manifest, scope: as })

test('sale: a second company can raise its own orders', async () => {
  const adapter = await boot()
  try {
    const globex = { company: 'globex', branches: null }
    await call('partner.savePartner', { id: 'globex-party', kind: 'company', name: 'Globex' }, adapter)
    await callAs(
      'company.saveCompany',
      { id: 'globex', partnerId: 'globex-party', currency: 'VND' },
      adapter,
      bothCompanies,
    )
    await callAs('stock.saveWarehouse', { id: 'wh-g', name: 'Globex', code: 'WH' }, adapter, globex)

    const first = await call(
      'sale.createOrder',
      { id: 'so-acme', partnerId: 'customer', warehouseId: 'wh' },
      adapter,
    )
    assert.equal((first.value as Row).ok, true)

    // The sequence row used to be keyed by the constant 'sale', a tenant-wide
    // primary key — so this call either threw on an undefined row or span out
    // against a row it could never write.
    const second = await callAs(
      'sale.createOrder',
      { id: 'so-globex', partnerId: 'customer', warehouseId: 'wh-g' },
      adapter,
      globex,
    )
    assert.equal((second.value as Row).ok, true, JSON.stringify(second.value))
    assert.equal((second.value as Row).name, 'S00001', 'numbering restarts per company')

    // And neither company's list shows the other's order.
    const mine = (await call('sale.listOrders', {}, adapter)).value as Row[]
    assert.deepEqual(
      mine.map((row) => row.id),
      ['so-acme'],
    )
  } finally {
    await adapter.close()
  }
})

test('sale: an order line refuses a unit the product cannot measure', async () => {
  const adapter = await boot()
  try {
    await call('uom.saveUnit', { id: 'kg', name: 'Kilogram', relativeFactor: '1' }, adapter)
    const order = await call(
      'sale.createOrder',
      { id: 'so-1', partnerId: 'customer', warehouseId: 'wh' },
      adapter,
    )
    assert.equal((order.value as Row).ok, true)

    // No pricelist and an explicit price: the path that never reached
    // pricing.priceFor, which was the only thing validating the unit.
    const foreign = await call(
      'sale.addLine',
      {
        id: 'line-kg',
        orderId: 'so-1',
        productId: 'goods-1',
        productUomId: 'kg',
        productUomQty: '2',
        priceUnit: '100',
      },
      adapter,
    )
    assert.equal((foreign.value as Row).ok, false)
    assert.equal(((foreign.value as Row).errors as Row[])[0]!.field, 'productUomId')

    const missing = await call(
      'sale.addLine',
      {
        id: 'line-x',
        orderId: 'so-1',
        productId: 'goods-1',
        productUomId: 'does-not-exist',
        productUomQty: '2',
        priceUnit: '100',
      },
      adapter,
    )
    assert.equal((missing.value as Row).ok, false)
  } finally {
    await adapter.close()
  }
})

test('sale: an invoice falls due on its payment term, not on the day it is raised', async () => {
  const adapter = await boot()
  try {
    await call('account.savePaymentTerm', { id: 'net30', name: 'Net 30' }, adapter)
    await call(
      'account.savePaymentTermLine',
      {
        id: 'net30-1',
        paymentId: 'net30',
        value: 'percent',
        valueAmount: '100',
        nbDays: 30,
        delayType: 'days_after',
      },
      adapter,
    )
    await call(
      'sale.createOrder',
      { id: 'so-1', partnerId: 'customer', warehouseId: 'wh', paymentTermId: 'net30' },
      adapter,
    )
    await call(
      'sale.addLine',
      {
        id: 'line-1',
        orderId: 'so-1',
        productId: 'goods-1',
        productUomId: 'unit',
        productUomQty: '1',
        priceUnit: '100',
      },
      adapter,
    )
    await call('sale.confirmOrder', { id: 'so-1' }, adapter)
    const invoice = await call(
      'sale.createInvoice',
      {
        id: 'inv-1',
        orderId: 'so-1',
        journalId: 'sales-journal',
        revenueAccountId: 'revenue',
        receivableAccountId: 'receivable',
        invoiceDate: '2026-01-10T00:00:00.000Z',
      },
      adapter,
    )
    assert.equal((invoice.value as Row).ok, true, JSON.stringify(invoice.value))
    const move = (
      await adapter.all('SELECT "invoiceDate", "invoiceDateDue" FROM account_move WHERE id = ?', ['inv-1'])
    )[0]!
    assert.equal(String(move.invoiceDate).slice(0, 10), '2026-01-10')
    assert.equal(String(move.invoiceDateDue).slice(0, 10), '2026-02-09', 'thirty days after the invoice date')
  } finally {
    await adapter.close()
  }
})

test('sale: a refused quotation line leaves no order behind', async (t) => {
  const { createTestApp } = await import('@ketvietlab/ketjs/testing')
  const { ketsuite } = await import('../apps/ketsuite/app.ts')
  const app = await createTestApp(ketsuite, { worker: false })
  t.after(() => app.close())
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope, actor: 'user-1' })

  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', { id: 'customer', kind: 'company', name: 'Customer' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await fixture('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' })
  await fixture('product.saveTemplate', {
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    uomId: 'unit',
    listPrice: '100',
    saleOk: true,
  })
  await fixture('product.saveVariant', { id: 'goods-1', templateId: 'goods', combinationKey: '' })
  await fixture('stock.saveWarehouse', { id: 'wh', name: 'Main', code: 'WH' })
  // A purchase-only tax, which addLine refuses on a sales line.
  await fixture('account.saveTax', {
    id: 'vat-in',
    name: 'VAT in',
    typeTaxUse: 'purchase',
    amountType: 'percent',
    amount: '10',
  })
  await fixture('crm.bootstrap.defaults', { idempotencyKey: 'crm-defaults' })
  await fixture('crm.case.save', {
    id: 'opp-1',
    kind: 'opportunity',
    name: 'Opportunity',
    partnerId: 'customer',
    idempotencyKey: 'seed-opp',
  })

  const result = await fixture('crm_sale.sale.createQuotation', {
    id: 'so-crm',
    caseId: 'opp-1',
    warehouseId: 'wh',
    idempotencyKey: 'quotation-1',
    products: [
      { productId: 'goods-1', productUomId: 'unit', quantity: '1', priceUnit: '100' },
      // Refused, after the first line has already been written.
      { productId: 'goods-1', productUomId: 'unit', quantity: '1', priceUnit: '100', taxId: 'vat-in' },
    ],
  })
  // fixture.call answers with an envelope; the domain's own answer is inside it.
  const answer = (result as unknown as { value: Row }).value
  assert.equal(answer.ok, false, JSON.stringify(result))

  // Nothing may survive: not the order, not the line that did succeed.
  const listed = (await fixture('sale.listOrders', {})) as unknown as { value: Row[] }
  assert.deepEqual(listed.value, [], 'a refused quotation rolls its order back')
})

test('sale: a line can be taken back off a quotation', async () => {
  const adapter = await boot()
  try {
    await call('sale.createOrder', { id: 'so', partnerId: 'customer', warehouseId: 'wh' }, adapter)
    for (const [id, qty] of [
      ['so:a', '2'],
      ['so:b', '3'],
    ])
      await call(
        'sale.addLine',
        {
          id,
          orderId: 'so',
          productId: 'goods-1',
          productUomQty: qty,
          productUomId: 'unit',
          priceUnit: '100',
        },
        adapter,
      )
    assert.equal((await adapter.all('SELECT "amountTotal" FROM sale_order'))[0]!.amountTotal, '500')

    // Lines used to be add-only: a wrong product meant abandoning the quotation.
    const removed = (await call('sale.removeLine', { id: 'so:a' }, adapter)).value as Row
    assert.equal(removed.ok, true)
    assert.deepEqual(
      (await adapter.all('SELECT id FROM sale_order_line')).map((row) => row.id),
      ['so:b'],
    )
    assert.equal((await adapter.all('SELECT "amountTotal" FROM sale_order'))[0]!.amountTotal, '300')

    // A confirmed order is settled: its lines back deliveries and cannot vanish.
    await call('sale.confirmOrder', { id: 'so' }, adapter)
    const refused = (await call('sale.removeLine', { id: 'so:b' }, adapter)).value as Row
    assert.equal(refused.ok, false)
    assert.equal((await adapter.all('SELECT COUNT(*) c FROM sale_order_line'))[0]!.c, 1)
  } finally {
    await adapter.close()
  }
})

test('sale: a cancelled order can be set back to draft', async () => {
  const adapter = await boot()
  try {
    await call('sale.createOrder', { id: 'so', partnerId: 'customer', warehouseId: 'wh' }, adapter)
    await call(
      'sale.addLine',
      { id: 'so:line', orderId: 'so', productId: 'goods-1', productUomQty: '1', productUomId: 'unit' },
      adapter,
    )

    // Cancelling was terminal: the detail screen rendered no actions at all, so
    // one mis-click spent an order number and stranded its lines for good.
    const early = (await call('sale.resetOrder', { id: 'so' }, adapter)).value as Row
    assert.equal(early.ok, false, 'only a cancelled order comes back')

    await call('sale.cancelOrder', { id: 'so' }, adapter)
    assert.equal((await call('sale.resetOrder', { id: 'so' }, adapter)).value !== null, true)
    const order = (await adapter.all('SELECT state, locked FROM sale_order'))[0]!
    assert.equal(order.state, 'draft')

    // Back in draft it is a working quotation again, not a husk.
    const line = (
      await call(
        'sale.addLine',
        { id: 'so:two', orderId: 'so', productId: 'goods-1', productUomQty: '1', productUomId: 'unit' },
        adapter,
      )
    ).value as Row
    assert.equal(line.ok, true)
  } finally {
    await adapter.close()
  }
})
