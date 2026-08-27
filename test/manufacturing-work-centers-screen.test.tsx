import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { modalWorkspace } from '../packages/ketsuite/src/ui/index.ts'
import {
  workCenterFormModal,
  workCentersListScreen,
} from '../packages/ketsuite/src/modules/manufacturing_backend/screens/index.ts'

const messages: Record<string, string> = {
  'manufacturing_backend.action.archive': 'Lưu trữ',
  'manufacturing_backend.action.cancel': 'Hủy',
  'manufacturing_backend.action.create': 'Tạo',
  'manufacturing_backend.action.restore': 'Khôi phục',
  'manufacturing_backend.action.save': 'Lưu',
  'manufacturing_backend.empty.workCenters': 'Chưa có trung tâm sản xuất',
  'manufacturing_backend.empty.workCentersHint': 'Thêm trung tâm để cấu hình công đoạn.',
  'manufacturing_backend.field.actions': 'Thao tác',
  'manufacturing_backend.field.capacity': 'Công suất',
  'manufacturing_backend.field.code': 'Mã',
  'manufacturing_backend.field.cost': 'Chi phí/giờ',
  'manufacturing_backend.field.efficiency': 'Hiệu suất (%)',
  'manufacturing_backend.field.name': 'Tên',
  'manufacturing_backend.field.state': 'Trạng thái',
  'manufacturing_backend.state.active': 'Đang hoạt động',
  'manufacturing_backend.state.archived': 'Đã lưu trữ',
  'manufacturing_backend.workCenters.create': 'Thêm trung tâm',
  'manufacturing_backend.workCenters.edit': 'Chỉnh sửa trung tâm',
  'manufacturing_backend.workCenters.title': 'Trung tâm sản xuất',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

const row = {
  id: 'packing',
  code: 'PACK',
  name: 'Đóng gói',
  capacity: '3',
  timeEfficiency: '88',
  costPerHour: '125000',
  active: true,
  editHref: '/admin/manufacturing/work-centers?edit=packing&lang=vi',
}

test('manufacturing work centers list: ListPage exposes edit and archive without an embedded editor', () => {
  const html = renderToString(
    workCentersListScreen(
      translate,
      {
        action: '/admin/manufacturing/work-centers?lang=vi',
        createHref: '/admin/manufacturing/work-centers?create=1&lang=vi',
        rows: [row],
      },
      {},
    ),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /href="\/admin\/manufacturing\/work-centers\?create=1&amp;lang=vi"/)
  assert.match(html, /data-row-href="\/admin\/manufacturing\/work-centers\?edit=packing&amp;lang=vi"/)
  assert.match(html, /PACK/)
  assert.match(html, /Đóng gói/)
  assert.match(html, />88</)
  assert.match(html, />125000</)
  assert.match(html, /data-ui="badge" data-tone="positive"[\s\S]*?Đang hoạt động/)
  assert.match(html, /name="action" value="archive"/)
  assert.match(html, /name="id" value="packing"/)
  assert.doesNotMatch(html, /manufacturing-work-center-form|data-ui="modal-layer"/)
})

test('manufacturing work center edit: dialog retains capacity, efficiency, cost and errors', () => {
  const list = workCentersListScreen(
    translate,
    {
      action: '/admin/manufacturing/work-centers?lang=vi',
      createHref: '/admin/manufacturing/work-centers?create=1&lang=vi',
      rows: [row],
    },
    {},
  )
  const html = renderToString(
    modalWorkspace(
      list,
      workCenterFormModal(translate, {
        action: '/admin/manufacturing/work-centers?edit=packing&lang=vi',
        cancelHref: '/admin/manufacturing/work-centers?lang=vi',
        editing: true,
        errors: ['capacity: Giá trị không hợp lệ.'],
        values: { ...row, capacity: '-2' },
      }),
    ),
  )

  assert.match(html, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(html, /data-ui="modal-sheet" data-size="default" role="dialog"/)
  assert.match(html, /Chỉnh sửa trung tâm/)
  assert.match(html, /action="\/admin\/manufacturing\/work-centers\?edit=packing&amp;lang=vi"/)
  assert.match(html, /data-ui="modal-close" href="\/admin\/manufacturing\/work-centers\?lang=vi"/)
  assert.match(html, /name="id" value="packing"/)
  assert.equal(html.match(/data-ui="form-field"/g)?.length, 5)
  assert.match(html, /name="code"[^>]*value="PACK"/)
  assert.match(html, /name="capacity"[^>]*value="-2"/)
  assert.match(html, /name="timeEfficiency"[^>]*value="88"/)
  assert.match(html, /name="costPerHour"[^>]*value="125000"/)
  assert.match(html, /capacity: Giá trị không hợp lệ\./)
})
