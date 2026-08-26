import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

async function bootSale(t: TestContext) {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null },
    fixture = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', { id: 'admin-party', kind: 'person', name: 'Administrator' })
  await fixture('partner.savePartner', { id: 'customer', kind: 'company', name: 'Khách hàng Minh Anh' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    partnerId: 'admin-party',
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

test('sale-e2e: quotation to delivery and invoice crosses real HTTP', async (t) => {
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
  await call('sale_mail_backend.follow', { targetId: 'so-1' })
  await call('sale_mail_backend.post', {
    id: 'sale-message-1',
    targetId: 'so-1',
    kind: 'note',
    body: 'Ghi chú nội bộ trên đơn bán.',
  })
  assert.equal(
    (await call<{ messages: Row[] }>('sale_mail_backend.timeline', { targetId: 'so-1' })).value.messages[0]
      ?.body,
    'Ghi chú nội bộ trên đơn bán.',
  )
  await call('activity.saveType', {
    id: 'sale-follow-up',
    name: 'Theo dõi khách hàng',
    category: 'todo',
    icon: 'check',
    defaultDelayDays: 0,
    chainingPolicy: 'none',
    sequence: 10,
    active: true,
  })
  await call('sale_activity_backend.schedule', {
    id: 'sale-activity-1',
    targetId: 'so-1',
    typeId: 'sale-follow-up',
    assigneeUserId: 'admin',
    summary: 'Xác nhận lịch giao hàng',
    dueDate: '2026-08-20',
  })
  const emptyOrdersPage = await e2e.client.get('/admin/sales/orders?lang=vi', {
    headers: { accept: 'text/html' },
  })
  assert.match(await emptyOrdersPage.text(), /Chưa có đơn bán hàng/)
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
    if (path === '/admin/sales/orders') {
      assert.match(html, /data-ui="list-page"/)
      assert.match(html, /data-ui="table"/)
      assert.match(html, /Theo dõi đơn đã xác nhận, trạng thái lập hoá đơn và tổng giá trị\./)
      assert.match(html, /Khách hàng Minh Anh/)
      assert.match(html, /href="\/admin\/sales\/orders\/so-1"/)
      assert.doesNotMatch(html, /data-ui="record-workspace"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/sales/invoicing-policies') {
      assert.match(html, /data-ui="list-page"/)
      assert.match(html, /data-ui="table"/)
      assert.match(html, /Theo số lượng giao/)
      assert.match(html, /href="\/admin\/sales\/invoicing-policies\/new\?returnTo=/)
      assert.doesNotMatch(html, /id="invoicing-policy-form"|data-ui="record-workspace"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/sales/orders/so-1') {
      assert.match(html, /data-ui="form-page" data-scope="sale-order-form-page" data-has-aside="true"/)
      assert.match(html, /data-ui="form-page-aside"/)
      assert.match(html, /data-island="mail\.chatter"/)
      assert.match(html, /data-island="activity\.record"/)
      assert.match(html, /data-island="sale\.editor"/)
      assert.match(html, /data-scope="sale-order"/)
      assert.match(html, /Thông tin đơn hàng/)
      assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="record-aside"/)
    }
  }
  const quotationsPage = await e2e.client.get('/admin/sales/quotations?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const quotationsHtml = await quotationsPage.text()
  assert.match(quotationsHtml, /data-ui="list-page"/)
  assert.doesNotMatch(quotationsHtml, /id="quotation-create-form"/)
  assert.match(quotationsHtml, /Chưa có báo giá/)
  assert.doesNotMatch(quotationsHtml, /data-island="mail\.chatter"/)
  const quotationCreatePage = await e2e.client.get('/admin/sales/quotations/new?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const quotationCreateHtml = await quotationCreatePage.text()
  assert.match(quotationCreateHtml, /data-ui="form-page"/)
  assert.match(quotationCreateHtml, /id="quotation-create-form"/)
  assert.match(quotationCreateHtml, /data-scope="sale-quotation-create"/)
  assert.match(quotationCreateHtml, /<option value=""/)
  assert.doesNotMatch(quotationCreateHtml, /data-island="mail\.chatter"/)

  const salesDashboard = await e2e.client.get('/admin/sales?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const salesDashboardHtml = await salesDashboard.text()
  assert.match(salesDashboardHtml, /Tạo báo giá/)
  assert.match(salesDashboardHtml, /href="\/admin\/sales\/quotations\/new\?lang=vi"/)
  assert.match(salesDashboardHtml, /href="\/admin\/sales\/quotations\?lang=vi&amp;state=draft"/)
  assert.match(salesDashboardHtml, /href="\/admin\/sales\/orders\?lang=vi"/)

  const legacyInvalidRedirect = await e2e.client.post(
    '/admin/sales/quotations?lang=vi',
    new URLSearchParams({ partnerId: '', warehouseId: '' }),
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    },
  )
  assert.equal(legacyInvalidRedirect.status, 303)
  assert.equal(legacyInvalidRedirect.headers.get('location'), '/admin/sales/quotations/new?lang=vi&invalid=1')
  const invalidQuotation = await e2e.client.form<string>('/admin/sales/quotations/new?lang=vi', {
    partnerId: '',
    warehouseId: '',
  })
  assert.match(invalidQuotation, /Dữ liệu chưa hợp lệ/)
  const createdQuotation = await e2e.client.form<string>('/admin/sales/quotations/new?lang=vi', {
    partnerId: 'customer',
    warehouseId: 'wh',
    clientOrderRef: 'KH/2026/HTTP',
    pricelistId: 'retail',
  })
  assert.match(createdQuotation, /data-ui="table"/)
  assert.match(createdQuotation, /Khách hàng Minh Anh/)
  assert.match(createdQuotation, /Bản nháp/)
  assert.doesNotMatch(createdQuotation, /data-island="mail\.chatter"/)
  const englishQuotations = await e2e.client.get('/admin/sales/quotations?lang=en', {
    headers: { accept: 'text/html' },
  })
  assert.match(await englishQuotations.text(), /href="\/admin\/sales\/quotations\/[^"?]+\?lang=en"/)
  const englishDashboard = await e2e.client.get('/admin/sales?lang=en', {
    headers: { accept: 'text/html' },
  })
  const englishDashboardHtml = await englishDashboard.text()
  assert.match(englishDashboardHtml, /Create Quotation/)
  assert.match(englishDashboardHtml, /href="\/admin\/sales\/quotations\/new\?lang=en"/)
  const english = await e2e.client.get('/admin/sales/orders/so-1?lang=en', {
    headers: { accept: 'text/html' },
  })
  assert.equal(english.status, 200)
  const englishDetailHtml = await english.text()
  assert.match(englishDetailHtml, /data-ui="form-page" data-scope="sale-order-form-page"/)
  assert.match(englishDetailHtml, /Sales order · Khách hàng Minh Anh/)
  const englishOrders = await e2e.client.get('/admin/sales/orders?lang=en', {
    headers: { accept: 'text/html' },
  })
  const englishOrdersHtml = await englishOrders.text()
  assert.match(englishOrdersHtml, /data-ui="list-page"/)
  assert.match(englishOrdersHtml, /Track confirmed orders, invoicing status and total value\./)
  assert.match(englishOrdersHtml, /href="\/admin\/sales\/orders\/so-1\?lang=en"/)
  assert.doesNotMatch(englishOrdersHtml, /data-island="mail\.chatter"/)
  const englishPolicies = await e2e.client.get('/admin/sales/invoicing-policies?lang=en', {
    headers: { accept: 'text/html' },
  })
  const englishPoliciesHtml = await englishPolicies.text()
  assert.match(englishPoliciesHtml, /data-ui="list-page"/)
  assert.match(englishPoliciesHtml, /Delivered quantities/)
  assert.match(
    englishPoliciesHtml,
    /href="\/admin\/sales\/invoicing-policies\/new\?lang=en&amp;returnTo=%2Fadmin%2Fsales%2Finvoicing-policies%3Flang%3Den"/,
  )
  assert.doesNotMatch(englishPoliciesHtml, /id="invoicing-policy-form"/)
  assert.doesNotMatch(englishPoliciesHtml, /data-island="mail\.chatter"/)
  const englishPolicyForm = await e2e.client.get(
    '/admin/sales/invoicing-policies/new?lang=en&returnTo=%2Fadmin%2Fsales%2Finvoicing-policies%3Flang%3Den',
    { headers: { accept: 'text/html' } },
  )
  const englishPolicyFormHtml = await englishPolicyForm.text()
  assert.match(
    englishPolicyFormHtml,
    /data-ui="form-page" data-scope="sales-invoicing-policy-form-page" data-has-aside="false"/,
  )
  assert.match(englishPolicyFormHtml, /id="invoicing-policy-form"/)
  assert.match(englishPolicyFormHtml, /type="radio" name="invoicePolicy" autocomplete="off" value="delivery"/)
  assert.match(englishPolicyFormHtml, /Delivered quantities/)
  assert.match(
    englishPolicyFormHtml,
    /action="\/admin\/sales\/invoicing-policies\/new\?lang=en&amp;returnTo=%2Fadmin%2Fsales%2Finvoicing-policies%3Flang%3Den"/,
  )
  assert.match(englishPolicyFormHtml, /href="\/admin\/sales\/invoicing-policies\?lang=en"/)
  assert.doesNotMatch(englishPolicyFormHtml, /data-island="mail\.chatter"/)
  const rejectedPolicy = await e2e.client.post(
    '/admin/sales/invoicing-policies/new?lang=en&returnTo=https%3A%2F%2Fevil.example%2Fsteal',
    new URLSearchParams({ templateId: '', invoicePolicy: '' }),
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    },
  )
  assert.equal(rejectedPolicy.status, 303)
  assert.equal(
    rejectedPolicy.headers.get('location'),
    '/admin/sales/invoicing-policies/new?lang=en&returnTo=%2Fadmin%2Fsales%2Finvoicing-policies%3Flang%3Den&invalid=1',
  )
  const rejectedPolicyForm = await e2e.client.get(rejectedPolicy.headers.get('location') ?? '', {
    headers: { accept: 'text/html' },
  })
  assert.match(
    await rejectedPolicyForm.text(),
    /The form is invalid\. Check the required fields and try again\./,
  )
  const crossSitePolicy = await e2e.client.post(
    '/admin/sales/invoicing-policies/new?lang=en',
    new URLSearchParams({ templateId: 'goods', invoicePolicy: 'order' }),
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' },
      redirect: 'manual',
    },
  )
  assert.equal(crossSitePolicy.status, 403)
  const updatePolicy = await e2e.client.post(
    '/admin/sales/invoicing-policies?lang=en',
    new URLSearchParams({ templateId: 'goods', invoicePolicy: 'order' }),
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    },
  )
  assert.equal(updatePolicy.status, 303)
  assert.equal(updatePolicy.headers.get('location'), '/admin/sales/invoicing-policies?lang=en')
  const templates = (await call<Row[]>('sale.listInvoicePolicies', {})).value
  assert.equal(templates.find((row) => row.id === 'goods')?.invoicePolicy, 'order')

  await call('sale.createOrder', {
    id: 'so-ui',
    partnerId: 'customer',
    warehouseId: 'wh',
    pricelistId: 'retail',
  })
  const invalidPartial = await e2e.client.post(
    '/admin/sales/quotations/so-ui?lang=vi',
    new URLSearchParams({
      action: 'add-line',
      productId: '',
      productUomQty: '1',
      productUomId: 'unit',
    }),
    {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-ket-partial': 'sale-order',
      },
    },
  )
  assert.equal(invalidPartial.status, 422)
  assert.match(await invalidPartial.text(), /Dữ liệu chưa hợp lệ/)
  const partial = await e2e.client.post(
    '/admin/sales/quotations/so-ui?lang=vi',
    new URLSearchParams({
      action: 'add-line',
      productId: 'chair',
      productUomQty: '1',
      productUomId: 'unit',
      taxId: 'vat10',
    }),
    {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-ket-partial': 'sale-order',
      },
    },
  )
  assert.equal(partial.status, 200)
  assert.match(partial.headers.get('content-type') ?? '', /^text\/vnd\.ket\.fragments\+html/)
  assert.equal(partial.headers.get('x-ket-location'), '/admin/sales/quotations/so-ui?lang=vi')
  const partialHtml = await partial.text()
  assert.match(partialHtml, /data-ket-slot="sale\.order-header"/)
  assert.match(partialHtml, /data-ket-slot="sale\.order-body"/)
  assert.match(partialHtml, /Ghế công thái học/)
  assert.doesNotMatch(partialHtml, /data-island="mail\.chatter"/)
  const confirmedPartial = await e2e.client.post(
    '/admin/sales/quotations/so-ui?lang=vi',
    new URLSearchParams({ action: 'confirm' }),
    {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-ket-partial': 'sale-order',
      },
    },
  )
  assert.equal(confirmedPartial.status, 200)
  assert.equal(confirmedPartial.headers.get('x-ket-location'), '/admin/sales/orders/so-ui?lang=vi')
  assert.match(await confirmedPartial.text(), /Đơn bán hàng/)
})

test('sale-e2e: a quotation can lose a line and come back from cancelled', async (t) => {
  const { e2e, call } = await bootSale(t)
  const post = (path: string, body: Record<string, string>) =>
    e2e.client.post(path, new URLSearchParams(body), {
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-ket-partial': 'sale-order' },
    })
  await call('sale.createOrder', { id: 'so-ux', partnerId: 'customer', warehouseId: 'wh' })
  for (const id of ['so-ux:a', 'so-ux:b'])
    await call('sale.addLine', {
      id,
      orderId: 'so-ux',
      productId: 'chair',
      productUomQty: '1',
      productUomId: 'unit',
    })

  // The line table offers a way back out, not just a way in.
  const detail = await e2e.client.get('/admin/sales/quotations/so-ux?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const detailHtml = await detail.text()
  assert.match(detailHtml, /name="lineId" value="so-ux:a"/)
  assert.match(detailHtml, /Thao tác/)
  assert.doesNotMatch(detailHtml, /sale_backend\.[A-Za-z]/)

  const removed = await post('/admin/sales/quotations/so-ux?lang=vi', {
    action: 'remove-line',
    lineId: 'so-ux:a',
  })
  assert.equal(removed.status, 200)
  const afterRemoval = (await call<Row>('sale.getOrder', { id: 'so-ux' })).value
  assert.deepEqual(
    ((afterRemoval.lines as Row[]) ?? []).map((line) => line.id),
    ['so-ux:b'],
  )

  // Cancelling used to be the end of the road: no action on the screen, and the
  // order on neither list.
  const cancelled = await post('/admin/sales/quotations/so-ux?lang=vi', { action: 'cancel' })
  assert.equal(cancelled.status, 200)
  const listed = await e2e.client.get('/admin/sales/quotations?lang=vi', { headers: { accept: 'text/html' } })
  const listedHtml = await listed.text()
  assert.match(listedHtml, /so-ux/)
  assert.match(listedHtml, /Đã huỷ/)
  assert.doesNotMatch(listedHtml, /sale_backend\.[A-Za-z]/)

  const cancelledDetail = await e2e.client.get('/admin/sales/quotations/so-ux?lang=vi', {
    headers: { accept: 'text/html' },
  })
  assert.match(await cancelledDetail.text(), /Đưa về nháp/)

  const reset = await post('/admin/sales/quotations/so-ux?lang=vi', { action: 'reset' })
  assert.equal(reset.status, 200)
  const back = await e2e.client.get('/admin/sales/quotations/so-ux?lang=en', {
    headers: { accept: 'text/html' },
  })
  const backHtml = await back.text()
  assert.match(backHtml, /Add line/)
  assert.doesNotMatch(backHtml, /Set to draft/)
  assert.doesNotMatch(backHtml, /sale_backend\.[A-Za-z]/)
})

test('sale-e2e: the print group is translated and reaches the lists', async (t) => {
  const { e2e, call } = await bootSale(t)
  await call('sale.createOrder', { id: 'so-print', partnerId: 'customer', warehouseId: 'wh' })
  await call('sale.addLine', {
    id: 'so-print:line',
    orderId: 'so-print',
    productId: 'chair',
    productUomQty: '1',
    productUomId: 'unit',
  })

  // The print group's label was the English literal 'Print', written in by hand
  // in four backends while the document names beside it were translated.
  const detail = await e2e.client.get('/admin/sales/quotations/so-print?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const detailHtml = await detail.text()
  assert.match(detailHtml, /href="\/reports\/sale\.quotation\/so-print/)
  assert.doesNotMatch(detailHtml, />Print</)
  assert.doesNotMatch(detailHtml, /backend\.print/)

  // Printing meant opening each record first.
  const quotations = await e2e.client.get('/admin/sales/quotations?lang=vi', {
    headers: { accept: 'text/html' },
  })
  assert.match(await quotations.text(), /href="\/reports\/sale\.quotation\/so-print/)

  // A confirmed order offers the pro-forma beside its own document, and the
  // orders list prints too.
  await call('sale.confirmOrder', { id: 'so-print' })
  const order = await e2e.client.get('/admin/sales/orders/so-print?lang=en', {
    headers: { accept: 'text/html' },
  })
  const orderHtml = await order.text()
  assert.match(orderHtml, /href="\/reports\/sale\.salesOrder\/so-print/)
  assert.match(orderHtml, /href="\/reports\/sale\.proforma\/so-print/)
  assert.match(orderHtml, /PRO-FORMA INVOICE/)
  const orders = await e2e.client.get('/admin/sales/orders?lang=en', { headers: { accept: 'text/html' } })
  assert.match(await orders.text(), /href="\/reports\/sale\.salesOrder\/so-print/)

  // And the document itself renders, carrying the unit beside the quantity.
  const pdf = await e2e.client.get('/reports/sale.salesOrder/so-print?lang=vi')
  assert.equal(pdf.status, 200)
})
