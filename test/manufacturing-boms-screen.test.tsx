import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { modalWorkspace } from '../packages/ketsuite/src/ui/index.ts'
import {
  bomCreateModal,
  bomsListScreen,
} from '../packages/ketsuite/src/modules/manufacturing_backend/screens/index.ts'

const messages: Record<string, string> = {
  'manufacturing_backend.action.cancel': 'Hủy',
  'manufacturing_backend.action.create': 'Tạo',
  'manufacturing_backend.boms.create': 'Tạo định mức cơ bản',
  'manufacturing_backend.boms.title': 'Định mức nguyên liệu',
  'manufacturing_backend.empty.boms': 'Chưa có định mức',
  'manufacturing_backend.empty.bomsHint': 'Tạo định mức nguyên liệu đầu tiên.',
  'manufacturing_backend.field.code': 'Mã',
  'manufacturing_backend.field.component': 'Nguyên liệu',
  'manufacturing_backend.field.duration': 'Phút dự kiến',
  'manufacturing_backend.field.operation': 'Công đoạn',
  'manufacturing_backend.field.product': 'Thành phẩm',
  'manufacturing_backend.field.quantity': 'Số lượng',
  'manufacturing_backend.field.uom': 'Đơn vị',
  'manufacturing_backend.field.workCenter': 'Trung tâm',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

const fields = [
  { name: 'code', label: 'Mã', value: 'BOM/INVALID' },
  {
    name: 'productId',
    label: 'Thành phẩm',
    type: 'select' as const,
    value: 'missing-product',
    options: [{ value: 'missing-product', label: 'missing-product' }],
    required: true,
  },
  { name: 'productQty', label: 'Số lượng', type: 'decimal' as const, value: '12.5', required: true },
  {
    name: 'productUomId',
    label: 'Đơn vị',
    type: 'select' as const,
    value: 'kg',
    options: [{ value: 'kg', label: 'kg' }],
    required: true,
  },
  {
    name: 'componentId',
    label: 'Nguyên liệu',
    type: 'select' as const,
    value: 'component',
    options: [{ value: 'component', label: 'Táo' }],
    required: true,
  },
  { name: 'componentQty', label: 'Số lượng', type: 'decimal' as const, value: '2', required: true },
  {
    name: 'componentUomId',
    label: 'Đơn vị',
    type: 'select' as const,
    value: 'kg',
    options: [{ value: 'kg', label: 'kg' }],
    required: true,
  },
  { name: 'operationName', label: 'Công đoạn', value: 'Đóng gói' },
  {
    name: 'workCenterId',
    label: 'Trung tâm',
    type: 'select' as const,
    value: '',
    options: [{ value: '', label: '—' }],
  },
  { name: 'durationExpected', label: 'Phút dự kiến', type: 'number' as const, value: '30' },
]

test('manufacturing BOM list: ListPage is collection-only with a localized modal URL', () => {
  const html = renderToString(
    bomsListScreen(
      translate,
      {
        createHref: '/admin/manufacturing/boms?create=1&lang=vi',
        rows: [{ id: 'bom-1', code: 'BOM/0001', product: 'Giỏ trái cây', quantity: '10' }],
      },
      {},
    ),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /href="\/admin\/manufacturing\/boms\?create=1&amp;lang=vi"/)
  assert.match(html, /BOM\/0001/)
  assert.match(html, /Giỏ trái cây/)
  assert.match(html, />10</)
  assert.doesNotMatch(html, /data-ui="record-form"|data-ui="modal-layer"/)
})

test('manufacturing BOM create: modal keeps list context, values, errors and safe close action', () => {
  const list = bomsListScreen(
    translate,
    {
      createHref: '/admin/manufacturing/boms?create=1&lang=vi',
      rows: [{ id: 'bom-1', code: 'BOM/0001', product: 'Giỏ trái cây', quantity: '10' }],
    },
    {},
  )
  const html = renderToString(
    modalWorkspace(
      list,
      bomCreateModal(translate, {
        action: '/admin/manufacturing/boms/new?lang=vi',
        cancelHref: '/admin/manufacturing/boms?lang=vi',
        errors: ['productId: Bản ghi không tồn tại.'],
        fields,
      }),
    ),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(html, /data-ui="modal-sheet" data-size="large" role="dialog"/)
  assert.match(html, /id="manufacturing-bom-create-form"/)
  assert.match(html, /action="\/admin\/manufacturing\/boms\/new\?lang=vi"/)
  assert.match(html, /data-ui="modal-close" href="\/admin\/manufacturing\/boms\?lang=vi"/)
  assert.equal(html.match(/data-ui="form-field"/g)?.length, 10)
  assert.match(html, /name="code"[^>]*value="BOM\/INVALID"/)
  assert.match(html, /<option value="missing-product" selected="true">/)
  assert.match(html, /name="componentQty"[^>]*value="2"/)
  assert.match(html, /productId: Bản ghi không tồn tại\./)
})
