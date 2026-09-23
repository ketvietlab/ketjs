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

test('product attributes list preserves translated context, errors and explicit create permission', () => {
  const html = renderToString(
    attributesScreen(
      translate,
      [],
      {
        chrome: {
          create: { label: 'Tạo', path: '/admin/product/attributes?lang=vi&record=product.attribute%3Anew' },
        },
      },
      ['Tên thuộc tính là bắt buộc'],
      '?lang=vi',
    ),
  )
  assert.match(html, /Tên thuộc tính là bắt buộc/)
  assert.match(html, /data-ui="list-page"[^>]*data-variant="operational"/)
  assert.match(html, /data-ui="list-page-header"[\s\S]*?record=product.attribute%3Anew[\s\S]*?<\/header>/)
  assert.match(html, /data-ui="ket-table"/)
  assert.doesNotMatch(html, /data-ui="record-form"|data-ui="card-grid"/)
})

test('product attributes list sorts compact value previews like the modal and preserves record links', () => {
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
            { id: 'red', name: 'Đỏ', sequence: 2 },
            { id: 'blue', name: 'Xanh', sequence: 1 },
          ],
        },
        { id: 'material', name: 'Chất liệu', displayType: 'select', createVariant: 'no_variant', values: [] },
      ],
      {},
      undefined,
      '?lang=vi',
    ),
  )
  assert.match(html, /record=product.attribute%3Acolor/)
  assert.match(html, /record=product.attribute%3Amaterial/)
  assert.match(html, /Xanh[\s\S]*?Đỏ/)
  assert.ok(html.indexOf('Xanh') < html.indexOf('Đỏ'))
  assert.match(html, /Nút dạng thẻ[\s\S]*?Luôn tạo biến thể/)
  assert.match(html, /Danh sách chọn[\s\S]*?Không tạo biến thể/)
  assert.match(html, /Chưa có giá trị/)
  assert.doesNotMatch(html, /data-ui="record-form"|>pills<|>no_variant</)
})

test('attribute filters combine with search before pagination without a legacy search fallback', () => {
  const rows = Array.from({ length: 35 }, (_, index) => ({
    id: `attr-${index}`,
    name: `Attribute ${index}`,
    displayType: index === 34 ? 'color' : 'select',
    createVariant: 'always',
    values: [],
  }))
  const html = renderToString(
    attributesScreen(translate, rows, {
      collectionUrl:
        '/admin/product/attributes?lang=vi&q=Attribute&displayType=color&createVariant=always&page=8&columns=name,values&record=product.attribute%3Aattr-34',
    }),
  )
  assert.match(html, /1-1 \/ 1/)
  assert.match(html, /record=product.attribute%3Aattr-34/)
  assert.doesNotMatch(html, /record=product.attribute%3Aattr-0(?:&|"|%)/)
  assert.doesNotMatch(html, /data-ui="chrome-search"|data-ui="facet"/)
})
