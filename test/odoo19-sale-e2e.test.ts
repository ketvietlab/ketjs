import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from 'ketjs'
import { createTestApp } from 'ketjs/testing'
import { ketsuite } from '../apps/ketsuite/app.ts'

async function bootSale(t: TestContext) {
  const e2e = await createTestApp(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null },
    fixture = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', { id: 'customer', kind: 'company', name: 'Khách hàng Minh Anh' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  const call = <T = unknown>(name: string, input: Record<string, unknown> = {}) =>
    e2e.client.call<T>(name, input)
  await call('uom.saveUnit', { id: 'unit', name: 'Đơn vị', relativeFactor: '1' })
  await call('product.saveTemplate', {
    id: 'goods',
    name: 'Ghế công thái học',
    type: 'goods',
    uomId: 'unit',
    listPrice: '3000000',
    saleOk: true,
  })
  await call('product.saveVariant', {
    id: 'chair',
    templateId: 'goods',
    defaultCode: 'GHE-01',
    combinationKey: '',
  })
  await call('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await call('stock.saveWarehouse', { id: 'wh', name: 'Kho chính', code: 'WH' })
  await call('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })
  await call('stock.adjustInventory', {
    id: 'adjust',
    productId: 'chair',
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory',
    countedQuantity: '10',
    productUomId: 'unit',
  })
  for (const [id, code, name, accountType] of [
    ['revenue', '5111', 'Doanh thu', 'income'],
    ['receivable', '131', 'Phải thu khách hàng', 'asset_receivable'],
    ['tax', '3331', 'Thuế GTGT', 'liability_current'],
  ])
    await call('account.saveAccount', { id, code, name, accountType })
  await call('account.saveJournal', { id: 'sales-journal', name: 'Bán hàng', code: 'SAL', type: 'sale' })
  await call('account.saveTax', {
    id: 'vat10',
    name: 'GTGT 10%',
    typeTaxUse: 'sale',
    amountType: 'percent',
    amount: '10',
  })
  await call('pricing.savePricelist', { id: 'retail', name: 'Bán lẻ' })
  await call('pricing.savePricelistItem', {
    id: 'chair-price',
    pricelistId: 'retail',
    appliedOn: '0_product_variant',
    productId: 'chair',
    computePrice: 'fixed',
    fixedPrice: '2800000',
  })
  return { e2e, call }
}

test('e2e sale 19: quotation to delivery and invoice crosses real HTTP', async (t) => {
  const { e2e, call } = await bootSale(t)
  await call('sale.setInvoicePolicy', { templateId: 'goods', invoicePolicy: 'delivery' })
  await call('sale.createOrder', {
    id: 'so-1',
    partnerId: 'customer',
    warehouseId: 'wh',
    pricelistId: 'retail',
    clientOrderRef: 'KH/2026/01',
  })
  await call('sale.addLine', {
    id: 'so-1:line',
    orderId: 'so-1',
    productId: 'chair',
    productUomQty: '2',
    productUomId: 'unit',
    taxId: 'vat10',
  })
  await call('sale.sendQuotation', { id: 'so-1' })
  assert.equal((await call<Row>('sale.confirmOrder', { id: 'so-1' })).value.pickingId, 'so-1:delivery')
  await call('stock.confirmPicking', { id: 'so-1:delivery' })
  await call('stock.reserveMove', { id: 'so-1:line:delivery' })
  await call('stock.completePicking', { id: 'so-1:delivery' })
  await call('sale.syncDeliveries', { id: 'so-1' })
  assert.equal(
    (
      await call<Row>('sale.createInvoice', {
        id: 'invoice-1',
        orderId: 'so-1',
        journalId: 'sales-journal',
        revenueAccountId: 'revenue',
        receivableAccountId: 'receivable',
        taxAccountId: 'tax',
      })
    ).value.amountTotal,
    '6160000',
  )
  const pages: Array<[string, RegExp]> = [
    ['/admin/sales', /Tổng quan bán hàng/],
    ['/admin/sales/quotations', /Báo giá/],
    ['/admin/sales/orders', /S00001/],
    ['/admin/sales/orders/so-1', /Khách hàng Minh Anh/],
    ['/admin/sales/invoicing-policies', /Chính sách lập hoá đơn/],
  ]
  for (const [path, expected] of pages) {
    const response = await e2e.client.get(path, { headers: { accept: 'text/html' } })
    assert.equal(response.status, 200, path)
    const html = await response.text()
    assert.match(html, expected, path)
    assert.doesNotMatch(html, /sale_backend\.[A-Za-z]/, path)
  }
  const english = await e2e.client.get('/admin/sales/orders/so-1?lang=en', {
    headers: { accept: 'text/html' },
  })
  assert.equal(english.status, 200)
  assert.match(await english.text(), /Sales Order Detail/)
})
