import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  orderCreateScreen,
  ordersListScreen,
} from '../packages/ketsuite/src/modules/manufacturing_backend/screens/index.ts'

const messages: Record<string, string> = {
  'manufacturing_backend.action.cancel': 'Hủy',
  'manufacturing_backend.action.create': 'Tạo',
  'manufacturing_backend.empty.orders': 'Chưa có lệnh sản xuất',
  'manufacturing_backend.empty.ordersHint': 'Tạo định mức rồi lập lệnh sản xuất đầu tiên.',
  'manufacturing_backend.field.bom': 'Định mức',
  'manufacturing_backend.field.destination': 'Kho thành phẩm',
  'manufacturing_backend.field.name': 'Tên',
  'manufacturing_backend.field.product': 'Thành phẩm',
  'manufacturing_backend.field.production': 'Vị trí sản xuất',
  'manufacturing_backend.field.quantity': 'Số lượng',
  'manufacturing_backend.field.scheduledStart': 'Bắt đầu dự kiến',
  'manufacturing_backend.field.source': 'Kho nguyên liệu',
  'manufacturing_backend.field.state': 'Trạng thái',
  'manufacturing_backend.field.uom': 'Đơn vị',
  'manufacturing_backend.orders.create': 'Tạo lệnh sản xuất',
  'manufacturing_backend.orders.title': 'Lệnh sản xuất',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('manufacturing orders list: ListPage is list-only and keeps localized workflow links', () => {
  const html = renderToString(
    ordersListScreen(
      translate,
      {
        createHref: '/admin/manufacturing/new?lang=vi',
        rows: [
          {
            id: 'mo-1',
            name: 'MO/0001',
            product: 'Giỏ trái cây',
            quantity: '20',
            state: 'in_progress',
            href: '/admin/manufacturing/orders/mo-1?lang=vi',
          },
        ],
      },
      {},
    ),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /href="\/admin\/manufacturing\/new\?lang=vi"[\s\S]*?Tạo lệnh sản xuất/)
  assert.match(html, /data-row-href="\/admin\/manufacturing\/orders\/mo-1\?lang=vi"/)
  assert.match(html, /MO\/0001/)
  assert.match(html, /Giỏ trái cây/)
  assert.match(html, />20</)
  assert.match(html, /data-ui="badge" data-tone="warning"[\s\S]*?in_progress/)
  assert.doesNotMatch(html, /data-ui="record-form"|manufacturing-order-create-form|form-page-aside/)
})

test('manufacturing order create: FormPage keeps every submitted field, error and locale action', () => {
  const html = renderToString(
    orderCreateScreen(
      translate,
      {
        action: '/admin/manufacturing/new?lang=vi',
        cancelHref: '/admin/manufacturing?lang=vi',
        errors: ['bomId: Không tìm thấy định mức.'],
        fields: [
          { name: 'name', label: 'Tên', value: 'MO/0002', required: true },
          {
            name: 'bomId',
            label: 'Định mức',
            type: 'select',
            value: 'basket-bom',
            options: [{ value: 'basket-bom', label: 'BASKET-01' }],
            required: true,
          },
          { name: 'productQty', label: 'Số lượng', type: 'decimal', value: '12.5', required: true },
          {
            name: 'productUomId',
            label: 'Đơn vị',
            type: 'select',
            value: 'kg',
            options: [{ value: 'kg', label: 'kg' }],
            required: true,
          },
          {
            name: 'sourceLocationId',
            label: 'Kho nguyên liệu',
            type: 'select',
            value: 'stock',
            options: [{ value: 'stock', label: 'Stock' }],
            required: true,
          },
          {
            name: 'productionLocationId',
            label: 'Vị trí sản xuất',
            type: 'select',
            value: 'production',
            options: [{ value: 'production', label: 'Production' }],
            required: true,
          },
          {
            name: 'destinationLocationId',
            label: 'Kho thành phẩm',
            type: 'select',
            value: 'finished',
            options: [{ value: 'finished', label: 'Finished goods' }],
            required: true,
          },
          {
            name: 'scheduledStart',
            label: 'Bắt đầu dự kiến',
            type: 'datetime-local',
            value: '2026-08-28T08:30',
            required: true,
          },
        ],
      },
      {},
    ),
  )

  assert.match(
    html,
    /data-ui="form-page" data-scope="manufacturing-order-create-form-page" data-has-aside="false"/,
  )
  assert.match(html, /type="submit" form="manufacturing-order-create-form"/)
  assert.match(html, /id="manufacturing-order-create-form"/)
  assert.match(html, /action="\/admin\/manufacturing\/new\?lang=vi"/)
  assert.match(html, /href="\/admin\/manufacturing\?lang=vi"[\s\S]*?Hủy/)
  assert.equal(html.match(/data-ui="form-field"/g)?.length, 8)
  assert.match(html, /name="name"[^>]*value="MO\/0002"/)
  assert.match(html, /<option value="basket-bom" selected="true">/)
  assert.match(html, /name="productQty"[^>]*value="12.5"/)
  assert.match(html, /name="scheduledStart"[^>]*value="2026-08-28T08:30"/)
  assert.match(html, /bomId: Không tìm thấy định mức\./)
  assert.doesNotMatch(html, /data-ui="form-actions"|form-page-aside|mail\.chatter|activity\.record/)
})
