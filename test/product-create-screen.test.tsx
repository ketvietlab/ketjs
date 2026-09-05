import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { newProductScreen } from '../packages/ketsuite/src/modules/product_backend/screens/create.tsx'

const messages: Record<string, string> = {
  'product_backend.action.actions': 'Thao tác sản phẩm',
  'product_backend.action.cancel': 'Hủy',
  'product_backend.action.create': 'Tạo sản phẩm',
  'product_backend.create.subtitle': 'Hình ảnh, biến thể và trao đổi sẽ có sau khi tạo.',
  'product_backend.create.title': 'Tạo sản phẩm',
  'product_backend.field.category': 'Nhóm sản phẩm',
  'product_backend.field.description': 'Mô tả',
  'product_backend.field.isStorable': 'Theo dõi tồn kho',
  'product_backend.field.listPrice': 'Giá bán',
  'product_backend.field.name': 'Tên sản phẩm',
  'product_backend.field.productKind': 'Loại sản phẩm',
  'product_backend.field.purchaseOk': 'Có thể mua',
  'product_backend.field.saleOk': 'Có thể bán',
  'product_backend.field.tracking': 'Truy xuất',
  'product_backend.field.uom': 'Đơn vị tính',
  'product_backend.tabs.general': 'Thông tin chung',
  'product_backend.tracking.lot': 'Theo lô',
  'product_backend.tracking.none': 'Không theo dõi',
  'product_backend.tracking.serial': 'Theo sê-ri',
  'product_backend.type.goods': 'Hàng hóa',
  'product_backend.type.service': 'Dịch vụ',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('product create: keeps product and stock semantics in the public FormPage baseline', () => {
  const html = renderToString(
    newProductScreen(
      translate,
      {
        uoms: [{ value: 'unit', label: 'Đơn vị' }],
        categories: [{ value: 'coffee', label: 'Cà phê' }],
        stockEnabled: true,
        errors: ['Dữ liệu chưa hợp lệ'],
        controls: {
          uom: <span data-test-control="uom">Đơn vị relation</span>,
          category: <span data-test-control="category">Nhóm relation</span>,
        },
      },
      {},
      '?lang=vi',
    ),
  )

  assert.equal(html.match(/data-ui="form-page"/g)?.length, 1)
  assert.match(html, /data-scope="product-create-form-page"/)
  assert.match(html, /data-ui="form-page-title"[^>]*>[\s\S]*?Tạo sản phẩm/)
  assert.match(html, /data-ui="form-page-description"[^>]*>[\s\S]*?Hình ảnh, biến thể và trao đổi/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?type="submit"[^>]*form="product-create-form"/)
  assert.match(
    html,
    /href="\/admin\/product\/templates\?lang=vi"[^>]*data-variant="secondary"|data-variant="secondary"[^>]*href="\/admin\/product\/templates\?lang=vi"/,
  )
  assert.match(html, /id="product-create-form"/)
  assert.match(html, /data-scope="product-create"/)
  assert.match(html, /action="\/admin\/product\/templates\/new\?lang=vi"/)
  assert.match(html, /data-ui="form-errors"[^>]*role="alert"[\s\S]*?Dữ liệu chưa hợp lệ/)
  assert.match(html, /name="saleOk"(?=[^>]*form="product-create-form")(?=[^>]*checked)[^>]*>/)
  assert.match(html, /name="purchaseOk"(?=[^>]*form="product-create-form")(?=[^>]*checked)[^>]*>/)
  assert.match(html, /name="isStorable"(?=[^>]*form="product-create-form")(?=[^>]*checked)[^>]*>/)
  assert.match(
    html,
    /name="type"[\s\S]*?name="name"[\s\S]*?data-test-control="uom"[\s\S]*?data-test-control="category"[\s\S]*?name="listPrice"[\s\S]*?name="tracking"[\s\S]*?name="description"/,
  )
  assert.equal(html.match(/name="type"/g)?.length, 2)
  assert.match(html, /name="type"[^>]*value="goods"[^>]*checked/)
  assert.match(
    html,
    /name="tracking"[\s\S]*?value="none"[^>]*selected[\s\S]*?value="lot"[\s\S]*?value="serial"/,
  )
  assert.match(html, /data-test-control="uom"[\s\S]*?Đơn vị relation/)
  assert.match(html, /data-test-control="category"[\s\S]*?Nhóm relation/)
  assert.doesNotMatch(html, /data-ui="form-actions"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="form-page-aside"/)
  assert.doesNotMatch(html, /data-island="mail\.chatter"|data-ui="media"/)
})

test('product create: omits stock-only controls when the stock module is disabled', () => {
  const html = renderToString(
    newProductScreen(
      translate,
      {
        uoms: [{ value: 'unit', label: 'Đơn vị' }],
        categories: [{ value: 'service', label: 'Dịch vụ' }],
      },
      {},
      '?lang=vi',
    ),
  )

  assert.match(html, /name="saleOk"[^>]*checked/)
  assert.match(html, /name="purchaseOk"[^>]*checked/)
  assert.doesNotMatch(html, /name="isStorable"|name="tracking"/)
  assert.match(html, /name="uomId"[\s\S]*?value=""[^>]*selected[\s\S]*?value="unit"/)
  assert.match(html, /name="categoryId"[\s\S]*?value=""[^>]*selected[\s\S]*?value="service"/)
  assert.doesNotMatch(html, /data-ui="form-page-aside"|data-island="mail\.chatter"/)
})
