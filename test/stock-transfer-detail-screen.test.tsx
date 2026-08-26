import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  transferDetailScreen,
  type TransferDetailOptions,
} from '../packages/ketsuite/src/modules/stock_backend/screens/transfer-detail.tsx'

const messages: Record<string, string> = {
  'backend.table.id': 'ID',
  'stock_backend.action.addMove': 'Thêm dòng',
  'stock_backend.action.assign': 'Giữ hàng',
  'stock_backend.action.cancel': 'Hủy',
  'stock_backend.action.confirm': 'Xác nhận',
  'stock_backend.action.recordDone': 'Ghi nhận hoàn thành',
  'stock_backend.action.validate': 'Hoàn tất',
  'stock_backend.action.validateCreateBackorder': 'Hoàn tất và tạo phiếu bù',
  'stock_backend.action.validateNoBackorder': 'Hoàn tất không tạo phiếu bù',
  'stock_backend.col.detail': 'Chi tiết',
  'stock_backend.col.kind': 'Loại',
  'stock_backend.col.name': 'Tên',
  'stock_backend.col.state': 'Trạng thái',
  'stock_backend.field.demand': 'Nhu cầu',
  'stock_backend.field.doneQuantity': 'Số lượng hoàn thành',
  'stock_backend.field.lot': 'Lô / Sê-ri',
  'stock_backend.field.operationLine': 'Dòng thao tác',
  'stock_backend.field.productId': 'Sản phẩm',
  'stock_backend.field.scheduledDate': 'Ngày dự kiến',
  'stock_backend.field.uom': 'Đơn vị',
  'stock_backend.kind.move': 'Dòng dịch chuyển',
  'stock_backend.state.assigned': 'Đã sẵn sàng',
  'stock_backend.state.done': 'Hoàn tất',
  'stock_backend.transfer.actions.label': 'Thao tác phiếu kho',
  'stock_backend.transfer.addMove.hint': 'Thêm sản phẩm cần dịch chuyển.',
  'stock_backend.transfer.addMove.title': 'Thêm dòng dịch chuyển',
  'stock_backend.transfer.collaboration.label': 'Trao đổi và hoạt động của dịch chuyển',
  'stock_backend.transfer.operations.empty': 'Chưa có thao tác',
  'stock_backend.transfer.operations.emptyHint': 'Phiếu kho chưa có dòng dịch chuyển.',
  'stock_backend.transfer.operations.hint': 'Sản phẩm và số lượng trên phiếu.',
  'stock_backend.transfer.operations.title': 'Thao tác kho',
  'stock_backend.transfer.recordDone.hint': 'Ghi nhận số lượng thực tế.',
  'stock_backend.transfer.recordDone.title': 'Ghi nhận hoàn thành',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

const assignedOptions: TransferDetailOptions = {
  transfer: {
    id: 'pick-1',
    name: 'WH/OUT/0026',
    state: 'assigned',
    scheduledDate: '26/08/2026 09:30',
    pickingTypeName: 'Phiếu giao hàng',
  },
  rows: [
    {
      id: 'move-1',
      name: 'Áo thun · AO-01',
      kind: 'move',
      state: 'assigned',
      detail: '2 / 3 Cái',
    },
  ],
  products: [{ value: 'p1', label: 'Áo thun · AO-01' }],
  units: [{ value: 'unit', label: 'Cái' }],
  lots: [{ value: 'lot-1', label: 'LOT-001' }],
  operationOptions: [{ value: 'move:move-1', label: 'Áo thun · AO-01' }],
  backorderPolicy: 'ask',
  action: '/vi/admin/stock/transfers/pick-1',
  collaboration: <div data-ui="stock-transfer-chatter-fixture">Chatter</div>,
  editor: <div data-ui="stock-transfer-editor-fixture">Editor</div>,
  printActions: <form data-ui="stock-transfer-print-fixture">In phiếu</form>,
}

test('stock transfer detail: keeps operational actions, forms and print inside FormPage', () => {
  const html = renderToString(transferDetailScreen(translate, assignedOptions, {}))

  assert.match(html, /data-ui="form-page" data-scope="stock-transfer-form-page" data-has-aside="true"/)
  assert.match(html, /data-ui="form-page-title"[^>]*>[\s\S]*?WH\/OUT\/0026/)
  assert.match(html, /Phiếu giao hàng · Ngày dự kiến: 26\/08\/2026 09:30/)
  assert.match(html, /data-ui="form-page-status"[\s\S]*?Đã sẵn sàng/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?name="action" value="assign"/)
  assert.match(html, /name="action" value="validate"[\s\S]*?name="backorder" value="create"/)
  assert.match(html, /name="action" value="validate"[\s\S]*?name="backorder" value="cancel"/)
  assert.match(html, /name="action" value="cancel"/)
  assert.match(html, /stock-transfer-print-fixture/)
  assert.match(html, /data-ui="table"[\s\S]*?Áo thun · AO-01[\s\S]*?2 \/ 3 Cái/)
  assert.match(html, /name="action" value="add-move"/)
  assert.match(html, /name="productId"[\s\S]*?name="productUomId"[\s\S]*?name="productUomQty"/)
  assert.match(html, /name="action" value="pick"/)
  assert.match(html, /name="operationId"[\s\S]*?name="quantity"[\s\S]*?name="lotId"/)
  assert.match(html, /data-ui="form-page-controller"[\s\S]*?stock-transfer-editor-fixture/)
  assert.match(html, /data-ui="form-page-aside"[^>]*aria-label="Trao đổi và hoạt động của dịch chuyển"/)
  assert.match(html, /stock-transfer-chatter-fixture/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="record-aside"/)
  assert.doesNotMatch(html, /Thông tin nhanh/)
})

test('stock transfer detail: completed transfers remain read-only', () => {
  const html = renderToString(
    transferDetailScreen(
      translate,
      {
        ...assignedOptions,
        transfer: { ...assignedOptions.transfer, state: 'done' },
      },
      {},
    ),
  )

  assert.match(html, /data-ui="form-page-status"[\s\S]*?Hoàn tất/)
  assert.doesNotMatch(html, /data-ui="form-page-actions"/)
  assert.doesNotMatch(html, /name="action" value="(?:assign|validate|cancel|add-move|pick)"/)
  assert.match(html, /stock-transfer-print-fixture/)
  assert.match(html, /data-ui="table"/)
})

test('stock transfer detail partial: replaces named header and body while preserving live islands', () => {
  const html = renderToString(transferDetailScreen(translate, assignedOptions, {}, true))

  assert.match(html, /<ket-fragments data-title="WH\/OUT\/0026">/)
  assert.deepEqual(
    [...html.matchAll(/<template data-ket-slot="([^"]+)"/g)].map((match) => match[1]),
    ['stock.transfer-header', 'stock.transfer-body'],
  )
  assert.doesNotMatch(html, /stock-transfer-editor-fixture|stock-transfer-chatter-fixture/)
  assert.doesNotMatch(html, /data-ui="shell"|data-ui="form-page"/)
  assert.match(html, /name="action" value="assign"/)
  assert.match(html, /data-ui="table"/)
})
