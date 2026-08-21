import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestApp } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/app.ts'

async function bootPos(t: TestContext) {
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
    ['cash', '1111', 'Tiền mặt', 'asset_cash'],
  ])
    await call('account.saveAccount', { id, code, name, accountType })
  await call('account.saveJournal', { id: 'sales', name: 'Bán hàng', code: 'SAL', type: 'sale' })
  await call('account.saveJournal', {
    id: 'cash-journal',
    name: 'Tiền mặt',
    code: 'CSH',
    type: 'cash',
    defaultAccountId: 'cash',
  })
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
  await call('pos.saveConfig', {
    id: 'shop',
    name: 'Cửa hàng chính',
    warehouseId: 'wh',
    pricelistId: 'retail',
    salesJournalId: 'sales',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
    taxAccountId: 'tax',
  })
  await call('pos.savePaymentMethod', {
    id: 'cash-method',
    name: 'Tiền mặt',
    journalId: 'cash-journal',
    isCash: true,
  })
  await call('pos.linkPaymentMethod', { id: 'shop:cash', configId: 'shop', paymentMethodId: 'cash-method' })
  await call('pos.createSession', {
    id: 'session-1',
    configId: 'shop',
    userId: 'admin',
    openingCash: '100000',
  })
  await call('pos.openSession', { id: 'session-1' })
  return { e2e, call }
}

test('e2e pos 19: real HTTP session carries a register sale through stock and accounting', async (t) => {
  const { e2e, call } = await bootPos(t)
  await call('pos.createOrder', {
    id: 'order-1',
    uuid: 'offline-order-1',
    sessionId: 'session-1',
    partnerId: 'customer',
  })
  await call('pos.addLine', {
    id: 'line-1',
    orderId: 'order-1',
    productId: 'chair',
    productUomId: 'unit',
    qty: '1',
    taxId: 'vat10',
  })
  await call('pos.addPayment', {
    id: 'payment-1',
    orderId: 'order-1',
    paymentMethodId: 'cash-method',
    amount: '3080000',
  })
  const paid = (await call<Row>('pos.validateOrder', { id: 'order-1' })).value
  assert.equal(paid.state, 'paid')
  const pages: Array<[string, RegExp]> = [
    ['/admin/pos', /Tổng quan điểm bán hàng/],
    ['/admin/pos/configurations', /Cửa hàng chính/],
    ['/admin/pos/payment-methods', /Tiền mặt/],
    ['/admin/pos/sessions', /POS\/session-1/],
    ['/admin/pos/sessions/session-1', /Đang hoạt động/],
    ['/admin/pos/register/session-1', /Máy tính tiền/],
    ['/admin/pos/orders', /POS\/00001/],
    ['/admin/pos/orders/order-1', /Khách hàng Minh Anh/],
  ]
  for (const [path, expected] of pages) {
    const response = await e2e.client.get(path, { headers: { accept: 'text/html' } })
    assert.equal(response.status, 200, path)
    const html = await response.text()
    assert.match(html, expected, path)
    assert.doesNotMatch(html, /pos_backend\.[A-Za-z]/, path)
  }
  const english = await e2e.client.get('/admin/pos/orders/order-1?lang=en', {
    headers: { accept: 'text/html' },
  })
  assert.equal(english.status, 200)
  assert.match(await english.text(), /Paid/)
  await e2e.client.logout()
  const denied = await e2e.client.get('/admin/pos/orders', { headers: { accept: 'application/json' } })
  assert.equal(denied.status, 401)
})
