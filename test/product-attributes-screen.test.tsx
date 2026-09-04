import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { attributesScreen } from '../packages/ketsuite/src/modules/product_backend/screens/attributes.tsx'

const messages: Record<string, string> = {
  'product_backend.action.add': 'Thêm',
  'product_backend.action.create': 'Tạo',
  'product_backend.attributes.always': 'Luôn tạo',
  'product_backend.attributes.configuredHint': 'Xem nhanh các giá trị và bổ sung ngay tại từng thuộc tính.',
  'product_backend.attributes.configuredTitle': 'Thuộc tính đã cấu hình',
  'product_backend.attributes.createHint': 'Khai báo cách hiển thị và thời điểm sinh biến thể.',
  'product_backend.attributes.createTitle': 'Thuộc tính mới',
  'product_backend.attributes.createVariant': 'Tạo biến thể',
  'product_backend.attributes.displayType': 'Kiểu hiển thị',
  'product_backend.attributes.empty': 'Chưa có thuộc tính sản phẩm',
  'product_backend.attributes.emptyHint': 'Tạo thuộc tính đầu tiên bằng biểu mẫu phía trên.',
  'product_backend.attributes.never': 'Không tạo',
  'product_backend.attributes.noValues': 'Chưa có giá trị',
  'product_backend.attributes.title': 'Thuộc tính sản phẩm',
  'product_backend.attributes.valueName': 'Tên giá trị',
  'product_backend.col.sequence': 'Thứ tự',
  'product_backend.createVariant.always': 'Luôn tạo biến thể',
  'product_backend.createVariant.no_variant': 'Không tạo biến thể',
  'product_backend.displayType.color': 'Màu sắc',
  'product_backend.displayType.multi': 'Chọn nhiều',
  'product_backend.displayType.pills': 'Nút dạng thẻ',
  'product_backend.displayType.radio': 'Nút chọn',
  'product_backend.displayType.select': 'Danh sách chọn',
  'product_backend.field.name': 'Tên',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('product attributes specialized surface: keeps the parent create form and selection semantics', () => {
  const html = renderToString(attributesScreen(translate, [], {}, ['Tên thuộc tính là bắt buộc'], '?lang=vi'))

  assert.match(html, /id="product-attribute-create"/)
  assert.match(html, /data-scope="product-attribute-create"/)
  assert.match(html, /action="\/admin\/product\/attributes\?lang=vi"/)
  assert.match(html, /Tên thuộc tính là bắt buộc/)
  assert.match(
    html,
    /name="name"[\s\S]*?name="sequence"[\s\S]*?name="displayType"[\s\S]*?name="createVariant"/,
  )
  assert.match(
    html,
    /name="displayType"[\s\S]*?value="radio"[\s\S]*?value="pills"[\s\S]*?value="select"[\s\S]*?value="color"[\s\S]*?value="multi"/,
  )
  assert.match(html, /name="createVariant"[\s\S]*?value="always"[\s\S]*?value="no_variant"/)
  assert.match(html, /Chưa có thuộc tính sản phẩm/)
  assert.match(html, /data-ui="list-page"[^>]*data-variant="operational"/)
  assert.doesNotMatch(html, /data-ui="form-page"/)
})

test('product attributes specialized surface: keeps values and one child form scoped to each card', () => {
  const html = renderToString(
    attributesScreen(
      translate,
      [
        {
          id: 'color',
          name: 'Màu sắc',
          displayType: 'pills',
          createVariant: 'always',
          values: [
            { id: 'red', name: 'Đỏ' },
            { id: 'blue', name: 'Xanh' },
          ],
        },
        {
          id: 'material',
          name: 'Chất liệu',
          displayType: 'select',
          createVariant: 'no_variant',
          values: [],
        },
      ],
      {},
      undefined,
      '?lang=vi',
    ),
  )

  assert.match(html, /data-ui="card-grid"/)
  assert.match(html, /Màu sắc[\s\S]*?Nút dạng thẻ · Luôn tạo biến thể/)
  assert.match(html, /Đỏ[\s\S]*?Xanh/)
  assert.match(html, /action="\/admin\/product\/attributes\/color\/values\?lang=vi"/)
  assert.match(html, /Chất liệu[\s\S]*?Danh sách chọn · Không tạo biến thể/)
  assert.match(html, /Chưa có giá trị/)
  assert.match(html, /action="\/admin\/product\/attributes\/material\/values\?lang=vi"/)
  assert.equal(html.match(/data-scope="product-attribute-value"/g)?.length, 2)
  assert.equal(html.match(/name="name"/g)?.length, 3)
  assert.equal(html.match(/name="sequence"/g)?.length, 3)
  assert.doesNotMatch(html, />pills<|>no_variant</)
  assert.match(html, /data-ui="list-page"[^>]*data-variant="operational"/)
  assert.doesNotMatch(html, /data-ui="form-page"/)
})
