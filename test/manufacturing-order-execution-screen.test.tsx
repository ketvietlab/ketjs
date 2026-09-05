import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { orderScreen } from '../packages/ketsuite/src/modules/manufacturing_backend/screens/order-execution.tsx'

const messages: Record<string, string> = {
  'manufacturing_backend.action.cancel': 'Hủy',
  'manufacturing_backend.action.complete': 'Hoàn tất sản xuất',
  'manufacturing_backend.action.confirm': 'Xác nhận',
  'manufacturing_backend.action.finish': 'Hoàn tất công đoạn',
  'manufacturing_backend.action.pause': 'Tạm dừng',
  'manufacturing_backend.action.start': 'Bắt đầu',
  'manufacturing_backend.error.invalid': 'Không thể lưu dữ liệu sản xuất.',
  'manufacturing_backend.field.actions': 'Thao tác',
  'manufacturing_backend.field.component': 'Nguyên liệu',
  'manufacturing_backend.field.name': 'Tên',
  'manufacturing_backend.field.operation': 'Công đoạn',
  'manufacturing_backend.field.quantity': 'Số lượng',
  'manufacturing_backend.field.state': 'Trạng thái',
  'manufacturing_backend.orders.detail': 'Chi tiết lệnh sản xuất',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('manufacturing execution: FormPage keeps order/workflow actions and specialized tables', () => {
  const html = renderToString(
    orderScreen(
      translate,
      {},
      {
        id: 'mo-1',
        name: 'MO/0001',
        state: 'in_progress',
        productQty: '20',
        workOrders: [
          { id: 'wo-ready', name: 'Đóng gói', state: 'ready', version: 2 },
          { id: 'wo-active', name: 'Kiểm tra', state: 'in_progress', version: 4 },
        ],
        moves: [{ id: 'move-1', kind: 'component', move: { productUomQty: '24' } }],
      },
      ['version: Dữ liệu đã thay đổi; hãy tải lại trước khi thao tác.'],
      '/admin/manufacturing/orders/mo-1?lang=vi',
    ),
  )

  assert.match(
    html,
    /data-ui="form-page" data-scope="manufacturing-order-execution-form-page" data-has-aside="false"/,
  )
  assert.match(html, /data-ui="form-page-title"[\s\S]*?MO\/0001/)
  assert.match(html, /Chi tiết lệnh sản xuất/)
  assert.match(html, /data-ui="badge" data-tone="warning"[\s\S]*?in_progress/)
  assert.match(html, /Số lượng: 20/)
  assert.match(
    html,
    /data-ui="form-page-actions"[\s\S]*?action="\/admin\/manufacturing\/orders\/mo-1\?lang=vi"/,
  )
  assert.match(html, /name="action" value="complete"/)
  assert.match(html, /name="action" value="cancel"/)
  assert.match(html, /version: Dữ liệu đã thay đổi; hãy tải lại trước khi thao tác\./)
  assert.match(html, /data-ui="section-title"[\s\S]*?Công đoạn/)
  assert.match(html, /Đóng gói/)
  assert.match(html, /Kiểm tra/)
  assert.match(
    html,
    /action="\/admin\/manufacturing\/orders\/mo-1\?lang=vi&amp;workOrderId=wo-ready&amp;workOrderVersion=2"/,
  )
  assert.match(html, /name="action" value="start-work"/)
  assert.match(html, /name="action" value="pause-work"/)
  assert.match(html, /name="action" value="finish-work"/)
  assert.match(html, /data-ui="section-title"[\s\S]*?Nguyên liệu/)
  assert.match(html, /component/)
  assert.match(html, />24</)
  assert.doesNotMatch(html, /form-page-aside|mail\.chatter|activity\.record|record-workspace/)
})

test('manufacturing execution: terminal order keeps identity and status without mutation actions', () => {
  const html = renderToString(
    orderScreen(translate, {}, { id: 'mo-done', name: 'MO/DONE', state: 'done', productQty: '8' }),
  )

  assert.match(html, /data-ui="form-page"/)
  assert.match(html, /MO\/DONE/)
  assert.match(html, /data-ui="badge" data-tone="positive"[\s\S]*?done/)
  assert.match(html, /Số lượng: 8/)
  assert.doesNotMatch(html, /data-ui="form-page-actions"|data-ui="record-actions"|name="action"/)
  assert.doesNotMatch(html, /form-page-aside|mail\.chatter/)
})
