import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { transferCreateScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/transfer-create.tsx'

const messages: Record<string, string> = {
  'stock_backend.action.cancel': 'Hủy',
  'stock_backend.action.create': 'Tạo mới',
  'stock_backend.field.operationType': 'Loại hoạt động',
  'stock_backend.field.reference': 'Tham chiếu',
  'stock_backend.field.scheduledDate': 'Ngày dự kiến',
  'stock_backend.transfer.actions.label': 'Hành động dịch chuyển',
  'stock_backend.transfer.create.hint': 'Vị trí nguồn và đích được lấy từ cấu hình kho.',
  'stock_backend.transfer.create.reference.help': 'Mã tham chiếu dùng trong vận hành kho.',
  'stock_backend.transfer.create.title': 'Tạo phiếu chuyển kho',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('stock transfer create: renders all creation fields in a compact FormPage', () => {
  const html = renderToString(
    transferCreateScreen(
      translate,
      {
        pickingTypes: [
          { value: 'receipt', label: 'Nhập kho' },
          { value: 'delivery', label: 'Giao hàng' },
        ],
        action: '/admin/stock/transfers/new?lang=vi',
        cancelHref: '/admin/stock/transfers?lang=vi',
        errors: ['Dữ liệu chưa hợp lệ'],
      },
      {},
    ),
  )

  assert.equal(html.match(/data-ui="form-page"/g)?.length, 1)
  assert.match(html, /data-ui="form-page-title"[^>]*>[\s\S]*?Tạo phiếu chuyển kho/)
  assert.match(html, /data-ui="form-page-description"[^>]*>[\s\S]*?Vị trí nguồn và đích/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?type="submit"[^>]*form="transfer-create-form"/)
  assert.match(
    html,
    /href="\/admin\/stock\/transfers\?lang=vi"[^>]*data-variant="secondary"|data-variant="secondary"[^>]*href="\/admin\/stock\/transfers\?lang=vi"/,
  )
  assert.match(html, /id="transfer-create-form"/)
  assert.match(html, /data-scope="transfer-create"/)
  assert.match(html, /action="\/admin\/stock\/transfers\/new\?lang=vi"/)
  assert.match(html, /data-ui="form-errors"[^>]*role="alert"[\s\S]*?Dữ liệu chưa hợp lệ/)
  assert.match(html, /name="name"[\s\S]*?name="pickingTypeId"[\s\S]*?name="scheduledDate"/)
  assert.match(html, /name="pickingTypeId"[\s\S]*?value="receipt"[\s\S]*?value="delivery"/)
  assert.match(
    html,
    /name="scheduledDate"[^>]*type="datetime-local"|type="datetime-local"[^>]*name="scheduledDate"/,
  )
  assert.match(html, /Mã tham chiếu dùng trong vận hành kho/)
  assert.doesNotMatch(html, /data-ui="form-actions"/)
  assert.doesNotMatch(html, /data-ui="form-page-aside"|data-ui="chatter"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="form-page-back"|data-ui="breadcrumbs"/)
})
