import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { renderToString } from '@ketvietlab/ketjs-view'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import { vendorPricelistCreateScreen } from '../packages/ketsuite/src/modules/purchase_backend/screens/vendor-pricelist-create.tsx'
import { vendorPricelistsListScreen } from '../packages/ketsuite/src/modules/purchase_backend/screens/vendor-pricelists-list.tsx'

const messages: Record<string, string> = {
  'backend.chrome.next': 'Trang sau',
  'backend.chrome.previous': 'Trang trước',
  'purchase_backend.action.addVendorPrice': 'Thêm giá nhà cung cấp',
  'purchase_backend.action.cancel': 'Huỷ',
  'purchase_backend.action.saveMethod': 'Lưu chính sách',
  'purchase_backend.dashboard.records': 'Bản ghi',
  'purchase_backend.empty': 'Chưa có dữ liệu.',
  'purchase_backend.emptyHint': 'Tạo bản ghi đầu tiên để bắt đầu.',
  'purchase_backend.feedback.rejected': 'Chưa lưu được',
  'purchase_backend.feedback.rejectedField': 'Trường "{field}" không hợp lệ.',
  'purchase_backend.feedback.rejectedHint': 'Kiểm tra các trường bắt buộc.',
  'purchase_backend.field.dateEnd': 'Ngày kết thúc',
  'purchase_backend.field.dateStart': 'Ngày bắt đầu',
  'purchase_backend.field.delay': 'Thời gian giao hàng',
  'purchase_backend.field.discount': 'Chiết khấu',
  'purchase_backend.field.minQty': 'Số lượng tối thiểu',
  'purchase_backend.field.priceUnit': 'Đơn giá',
  'purchase_backend.field.product': 'Sản phẩm',
  'purchase_backend.field.productCode': 'Mã sản phẩm NCC',
  'purchase_backend.field.productName': 'Tên sản phẩm NCC',
  'purchase_backend.field.purchaseMethod': 'Chính sách kiểm soát',
  'purchase_backend.field.sequence': 'Ưu tiên',
  'purchase_backend.field.template': 'Mẫu sản phẩm',
  'purchase_backend.field.uom': 'Đơn vị',
  'purchase_backend.field.variant': 'Biến thể',
  'purchase_backend.field.vendor': 'Nhà cung cấp',
  'purchase_backend.method.title': 'Chính sách lập hoá đơn sản phẩm',
  'purchase_backend.pricelists.title': 'Bảng giá nhà cung cấp',
}

const translate = ((key: string, params?: Record<string, unknown>) => {
  let value = messages[key] ?? key
  for (const [name, replacement] of Object.entries(params ?? {}))
    value = value.replaceAll(`{${name}}`, String(replacement))
  return value
}) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('purchase vendor pricelists list: keeps policy action, price columns, currency and list controls', () => {
  const html = renderToString(
    vendorPricelistsListScreen(translate, {
      frame: {
        chrome: {
          search: { name: 'q', value: 'bàn', placeholder: 'Tìm bảng giá…' },
          pager: { from: 1, to: 1, total: 8, next: '/vi/admin/purchase/vendor-pricelists?page=2' },
        },
      },
      action: '/vi/admin/purchase/vendor-pricelists',
      createHref: '/vi/admin/purchase/vendor-pricelists/new',
      currency: 'VND',
      methodFields: [
        {
          name: 'templateId',
          label: 'Mẫu sản phẩm',
          type: 'select',
          options: [{ value: 'desk', label: 'Bàn làm việc' }],
          required: true,
        },
        {
          name: 'purchaseMethod',
          label: 'Chính sách kiểm soát',
          type: 'select',
          options: [{ value: 'purchase', label: 'Theo số lượng đặt' }],
        },
      ],
      rows: [
        {
          id: 'price-1',
          partnerId: 'vendor',
          partnerName: 'NCC An Phú',
          productTemplateId: 'desk',
          productNameDisplay: 'Bàn làm việc',
          minQty: '5',
          price: '1500000',
          discount: '3',
          delay: '2',
        },
      ],
    }),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /href="\/vi\/admin\/purchase\/vendor-pricelists\/new"/)
  assert.match(html, /data-ui="chrome-search"[\s\S]*?name="q"[\s\S]*?value="bàn"/)
  assert.match(html, /data-ui="pager-range"[^>]*>[\s\S]*?1-1 \/ 8/)
  assert.match(html, /name="action" value="method"/)
  assert.match(html, /action="\/vi\/admin\/purchase\/vendor-pricelists"/)
  assert.match(html, /name="templateId"[\s\S]*?name="purchaseMethod"/)
  assert.match(html, /data-col="vendor"[\s\S]*?NCC An Phú/)
  assert.match(html, /data-col="product"[\s\S]*?Bàn làm việc/)
  assert.match(html, /data-col="min"[\s\S]*?>5</)
  assert.match(html, /data-col="price"[\s\S]*?1\.500\.000/)
  assert.match(html, /data-col="discount"[\s\S]*?3%/)
  assert.match(html, /data-col="delay"[\s\S]*?>2</)
  assert.doesNotMatch(html, /purchase-vendor-pricelist-create|data-ui="form-page"/)
  assert.doesNotMatch(html, /mail\.chatter|data-ui="form-page-aside"/)
})

test('purchase vendor pricelist create: keeps all fields, defaults, scope, locale and company currency context', () => {
  const html = renderToString(
    vendorPricelistCreateScreen(translate, {
      frame: {},
      action: '/vi/admin/purchase/vendor-pricelists/new',
      cancelHref: '/vi/admin/purchase/vendor-pricelists',
      companyLabel: 'Kết Việt Hà Nội',
      currency: 'VND',
      invalid: 'price',
      fields: [
        { name: 'partnerId', label: 'Nhà cung cấp', type: 'select', required: true },
        {
          name: 'productTemplateId',
          label: 'Mẫu sản phẩm',
          control: (
            <div data-island="backend.relation-select">
              <input type="hidden" name="productTemplateId" value="desk" />
              Template relation
            </div>
          ),
          required: true,
        },
        { name: 'productId', label: 'Biến thể', type: 'select' },
        { name: 'productUomId', label: 'Đơn vị', type: 'select', required: true },
        { name: 'minQty', label: 'Số lượng tối thiểu', type: 'decimal', value: 0 },
        { name: 'price', label: 'Đơn giá', type: 'decimal', value: 0, required: true },
        { name: 'discount', label: 'Chiết khấu', type: 'decimal', value: 0 },
        { name: 'delay', label: 'Thời gian giao hàng', type: 'number', value: 1 },
        { name: 'productCode', label: 'Mã sản phẩm NCC' },
        { name: 'productName', label: 'Tên sản phẩm NCC' },
        { name: 'sequence', label: 'Ưu tiên', type: 'number', value: 1 },
        { name: 'dateStart', label: 'Ngày bắt đầu', type: 'date' },
        { name: 'dateEnd', label: 'Ngày kết thúc', type: 'date' },
      ],
    }),
  )

  assert.match(
    html,
    /data-ui="form-page" data-scope="purchase-vendor-pricelist-create" data-has-aside="false"/,
  )
  assert.match(html, /data-ui="form-page-meta"[\s\S]*?Kết Việt Hà Nội[\s\S]*?VND/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?form="purchase-vendor-pricelist-create"/)
  assert.match(html, /href="\/vi\/admin\/purchase\/vendor-pricelists"/)
  assert.match(html, /id="purchase-vendor-pricelist-create"/)
  assert.match(html, /action="\/vi\/admin\/purchase\/vendor-pricelists\/new"/)
  assert.match(html, /data-island="backend\.relation-select"/)
  assert.match(
    html,
    /name="partnerId"[\s\S]*?productTemplateId[\s\S]*?name="productId"[\s\S]*?name="productUomId"[\s\S]*?name="minQty"[\s\S]*?name="price"[\s\S]*?name="discount"[\s\S]*?name="delay"[\s\S]*?name="productCode"[\s\S]*?name="productName"[\s\S]*?name="sequence"[\s\S]*?name="dateStart"[\s\S]*?name="dateEnd"/,
  )
  assert.match(html, /name="minQty"[^>]*value="0"/)
  assert.match(html, /name="price"[^>]*value="0"/)
  assert.match(html, /name="discount"[^>]*value="0"/)
  assert.match(html, /name="delay"[^>]*value="1"/)
  assert.match(html, /name="sequence"[^>]*value="1"/)
  assert.match(html, /Trường &quot;price&quot; không hợp lệ/)
  assert.doesNotMatch(html, /mail\.chatter|data-ui="form-page-aside"/)
})

async function bootVendorPricelist(t: TestContext) {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', { id: 'vendor', kind: 'company', name: 'NCC An Phú' })
  await fixture('company.saveCompany', {
    id: 'acme',
    partnerId: 'acme-party',
    code: 'KVHN',
    currency: 'VND',
  })
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
  const call = (name: string, input: Record<string, unknown> = {}) => e2e.client.call(name, input)
  await call('uom.saveUnit', { id: 'unit', name: 'Đơn vị', relativeFactor: '1' })
  await call('product.saveTemplate', {
    id: 'desk',
    name: 'Bàn làm việc',
    type: 'goods',
    uomId: 'unit',
    listPrice: '2000000',
    purchaseOk: true,
  })
  await call('product.saveVariant', {
    id: 'desk-default',
    templateId: 'desk',
    defaultCode: 'BAN-01',
    combinationKey: '',
  })
  await call('stock.savePickingType', { id: 'incoming', name: 'Nhập hàng', code: 'incoming' })
  return { e2e, call }
}

test('purchase vendor pricelist routes: /new keeps locale, POST redirect and legacy endpoint compatibility', async (t) => {
  const { e2e, call } = await bootVendorPricelist(t)
  const list = await e2e.client.get('/admin/purchase/vendor-pricelists?lang=vi', {
    headers: { accept: 'text/html' },
  })
  assert.equal(list.status, 200)
  const listHtml = await list.text()
  assert.match(listHtml, /href="\/admin\/purchase\/vendor-pricelists\/new\?lang=vi"/)
  assert.doesNotMatch(listHtml, /purchase-vendor-pricelist-create/)

  const create = await e2e.client.get('/admin/purchase/vendor-pricelists/new?lang=vi', {
    headers: { accept: 'text/html' },
  })
  assert.equal(create.status, 200)
  const createHtml = await create.text()
  assert.match(createHtml, /action="\/admin\/purchase\/vendor-pricelists\/new\?lang=vi"/)
  assert.match(createHtml, /KVHN/)
  assert.match(createHtml, /VND/)

  const saved = await e2e.client.post(
    '/admin/purchase/vendor-pricelists/new?lang=vi',
    new URLSearchParams({
      partnerId: 'vendor',
      productTemplateId: 'desk',
      productId: 'desk-default',
      productUomId: 'unit',
      minQty: '5',
      price: '1500000',
      discount: '3',
      delay: '2',
      sequence: '1',
    }),
    { headers: { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' } },
  )
  assert.equal(saved.status, 200)
  assert.match(saved.url, /\/admin\/purchase\/vendor-pricelists\?lang=vi$/)
  assert.equal(((await call('purchase.listSupplierInfo')) as { value: unknown[] }).value.length, 1)

  const legacy = await e2e.client.post(
    '/admin/purchase/vendor-pricelists?lang=vi',
    new URLSearchParams({
      partnerId: 'vendor',
      productTemplateId: 'desk',
      productUomId: 'unit',
      price: '1400000',
    }),
    { headers: { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' } },
  )
  assert.equal(legacy.status, 200)
  assert.match(legacy.url, /\/admin\/purchase\/vendor-pricelists\?lang=vi$/)
  assert.equal(((await call('purchase.listSupplierInfo')) as { value: unknown[] }).value.length, 2)

  const invalid = await e2e.client.post(
    '/admin/purchase/vendor-pricelists/new?lang=vi',
    new URLSearchParams({}),
    { headers: { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' } },
  )
  assert.equal(invalid.status, 200)
  assert.match(invalid.url, /\/admin\/purchase\/vendor-pricelists\/new\?lang=vi&invalid=partnerId$/)
  assert.match(await invalid.text(), /data-ui="notice" data-tone="danger"[\s\S]*?Chưa lưu được/)

  const refused = await e2e.client.post(
    '/admin/purchase/vendor-pricelists/new?lang=vi',
    new URLSearchParams({}),
    {
      headers: {
        accept: 'text/html',
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://outside.example',
      },
    },
  )
  assert.equal(refused.status, 403)
})
