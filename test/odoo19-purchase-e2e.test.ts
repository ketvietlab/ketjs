import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from 'ketjs'
import { createTestApp } from 'ketjs/testing'
import { ketsuite } from '../apps/ketsuite/app.ts'

async function bootPurchase(t: TestContext) {
  const e2e = await createTestApp(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', { id: 'vendor', kind: 'company', name: 'Nhà cung cấp ABC' })
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
    name: 'Bàn làm việc',
    type: 'goods',
    uomId: 'unit',
    listPrice: '2000000',
    purchaseOk: true,
  })
  await call('product.saveVariant', {
    id: 'desk',
    templateId: 'goods',
    defaultCode: 'BAN-01',
    combinationKey: '',
  })
  await call('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await call('stock.saveLocation', { id: 'supplier', name: 'Nhà cung cấp', usage: 'supplier' })
  await call('stock.saveLocation', { id: 'stock', name: 'Kho chính', usage: 'internal' })
  await call('stock.savePickingType', {
    id: 'incoming',
    name: 'Nhập hàng',
    code: 'incoming',
    defaultLocationSrcId: 'supplier',
    defaultLocationDestId: 'stock',
  })
  for (const [id, code, name, accountType] of [
    ['expense', '6421', 'Chi phí mua hàng', 'expense'],
    ['payable', '331', 'Phải trả nhà cung cấp', 'liability_payable'],
    ['tax', '1331', 'Thuế GTGT được khấu trừ', 'asset_current'],
  ])
    await call('account.saveAccount', { id, code, name, accountType })
  await call('account.saveJournal', {
    id: 'purchase-journal',
    name: 'Mua hàng',
    code: 'PUR',
    type: 'purchase',
  })
  await call('account.saveTax', {
    id: 'vat10',
    name: 'GTGT 10%',
    typeTaxUse: 'purchase',
    amountType: 'percent',
    amount: '10',
  })
  return { e2e, call }
}

test('e2e purchase 19: RFQ to receipt and vendor bill crosses real HTTP', async (t) => {
  const { e2e, call } = await bootPurchase(t)
  await call('purchase.saveSupplierInfo', {
    id: 'vendor:desk',
    partnerId: 'vendor',
    productTemplateId: 'goods',
    productId: 'desk',
    productUomId: 'unit',
    minQty: '1',
    price: '1500000',
    discount: '5',
    delay: 2,
  })
  const created = (
    await call<Row>('purchase.createOrder', {
      id: 'po-1',
      partnerId: 'vendor',
      partnerRef: 'NCC/2026/01',
      pickingTypeId: 'incoming',
      dateOrder: '2026-08-20T00:00:00.000Z',
    })
  ).value
  assert.equal(created.name, 'PO00001')
  await call('purchase.addLine', {
    id: 'po-1:line',
    orderId: 'po-1',
    productId: 'desk',
    productQty: '2',
    productUomId: 'unit',
    taxId: 'vat10',
  })
  await call('purchase.sendRfq', { id: 'po-1' })
  const confirmed = (await call<Row>('purchase.confirmOrder', { id: 'po-1' })).value
  assert.equal(confirmed.pickingId, 'po-1:receipt')
  await call('stock.confirmPicking', { id: 'po-1:receipt' })
  await call('stock.saveMoveLine', {
    id: 'receipt-line',
    moveId: 'po-1:line:receipt',
    quantity: '2',
    picked: true,
  })
  await call('stock.completePicking', { id: 'po-1:receipt' })
  await call('purchase.syncReceipts', { id: 'po-1' })
  const bill = (
    await call<Row>('purchase.createVendorBill', {
      id: 'bill-1',
      orderId: 'po-1',
      journalId: 'purchase-journal',
      expenseAccountId: 'expense',
      payableAccountId: 'payable',
      taxAccountId: 'tax',
    })
  ).value
  assert.equal(bill.amountTotal, '3135000')
  assert.equal((await call<Row>('purchase.getOrder', { id: 'po-1' })).value.invoiceStatus, 'invoiced')

  await call('purchase.createOrder', {
    id: 'ui-rfq',
    partnerId: 'vendor',
    partnerRef: 'UI/RFQ',
    pickingTypeId: 'incoming',
  })
  await call('purchase.addLine', {
    id: 'ui-rfq:line',
    orderId: 'ui-rfq',
    productId: 'desk',
    productQty: '1',
    productUomId: 'unit',
  })
  const confirmedInUi = await e2e.client.post(
    '/admin/purchase/rfqs/ui-rfq?lang=vi',
    new URLSearchParams({ action: 'confirm' }),
    { headers: { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' } },
  )
  assert.equal(confirmedInUi.status, 200)
  assert.match(confirmedInUi.url, /\/admin\/purchase\/orders\/ui-rfq\?lang=vi$/)
  assert.match(await confirmedInUi.text(), /Chi tiết đơn mua/)

  const pages: Array<[string, RegExp]> = [
    ['/admin/purchase', /Tổng quan mua hàng/],
    ['/admin/purchase/rfqs', /Yêu cầu báo giá/],
    ['/admin/purchase/orders', /PO00001/],
    ['/admin/purchase/orders/po-1', /Nhà cung cấp ABC/],
    ['/admin/purchase/vendor-pricelists', /Bảng giá nhà cung cấp/],
  ]
  for (const [path, expected] of pages) {
    const response = await e2e.client.get(path, { headers: { accept: 'text/html' } })
    assert.equal(response.status, 200, path)
    const html = await response.text()
    assert.match(html, expected, path)
    assert.doesNotMatch(html, /purchase_backend\.[A-Za-z]/, path)
  }
  const purchaseDashboard = await e2e.client.get('/admin/purchase?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const purchaseDashboardHtml = await purchaseDashboard.text()
  assert.match(purchaseDashboardHtml, /Tạo yêu cầu báo giá/)
  assert.match(purchaseDashboardHtml, /href="\/admin\/purchase\/rfqs\?lang=vi#rfq-create-form"/)
  assert.match(purchaseDashboardHtml, /href="\/admin\/purchase\/orders\?lang=vi"/)

  const rfqsPage = await e2e.client.get('/admin/purchase/rfqs?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const rfqsHtml = await rfqsPage.text()
  assert.match(rfqsHtml, /id="rfq-create-form"/)
  assert.match(rfqsHtml, /data-scope="purchase-rfq-create"/)
  assert.match(rfqsHtml, /action="\/admin\/purchase\/rfqs\?lang=vi"/)

  const englishDashboard = await e2e.client.get('/admin/purchase?lang=en', {
    headers: { accept: 'text/html' },
  })
  const englishDashboardHtml = await englishDashboard.text()
  assert.match(englishDashboardHtml, /Create RFQ/)
  assert.match(englishDashboardHtml, /href="\/admin\/purchase\/rfqs\?lang=en#rfq-create-form"/)
  const english = await e2e.client.get('/admin/purchase/orders/po-1?lang=en', {
    headers: { accept: 'text/html' },
  })
  assert.equal(english.status, 200)
  const html = await english.text()
  assert.match(html, /Purchase Order/)
  assert.doesNotMatch(html, /purchase_backend\.[A-Za-z]/)
})
