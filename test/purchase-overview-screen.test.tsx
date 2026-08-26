import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { purchaseOverviewScreen } from '../packages/ketsuite/src/modules/purchase_backend/screens/overview.tsx'

const messages: Record<string, string> = {
  'purchase_backend.action.createRfq': 'Tạo yêu cầu báo giá',
  'purchase_backend.dashboard.records': 'Bản ghi',
  'purchase_backend.dashboard.title': 'Tổng quan mua hàng',
  'purchase_backend.dashboard.toApprove': 'Chờ duyệt',
  'purchase_backend.dashboard.toBill': 'Chờ lập hóa đơn',
  'purchase_backend.dashboard.toSend': 'Chờ gửi',
  'purchase_backend.dashboard.waiting': 'Chờ phản hồi',
  'purchase_backend.menu.orders': 'Đơn mua',
  'purchase_backend.setup.hint': 'Cần cấu hình: {missing}.',
  'purchase_backend.setup.openInventory': 'Mở kho vận',
  'purchase_backend.setup.openPartners': 'Mở đối tác',
  'purchase_backend.setup.pickingTypes': 'loại hoạt động nhận hàng',
  'purchase_backend.setup.title': 'Chưa thể tạo yêu cầu báo giá',
  'purchase_backend.setup.vendors': 'nhà cung cấp',
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

test('purchase overview stays specialized: preserves workflow counts, locale links and setup guidance', () => {
  const html = renderToString(
    purchaseOverviewScreen(
      translate,
      [
        { state: 'draft', invoiceStatus: 'no' },
        { state: 'draft', invoiceStatus: 'no' },
        { state: 'sent', invoiceStatus: 'no' },
        { state: 'to approve', invoiceStatus: 'no' },
        { state: 'purchase', invoiceStatus: 'to invoice' },
        { state: 'purchase', invoiceStatus: 'invoiced' },
      ],
      {},
      '?lang=vi',
      { pickingTypes: 1, vendors: 0 },
    ),
  )

  assert.match(html, /data-ui="record-workspace"/)
  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="form-page"/)
  assert.match(html, /data-ui="notice" data-tone="warning"/)
  assert.match(html, /Cần cấu hình: nhà cung cấp\./)
  assert.match(html, /href="\/admin\/partner\/partners"/)
  assert.match(html, /href="\/admin\/purchase\/rfqs\?lang=vi#rfq-create-form"/)
  assert.match(html, /href="\/admin\/purchase\/rfqs\?state=draft&amp;lang=vi"/)
  assert.match(html, /href="\/admin\/purchase\/rfqs\?state=sent&amp;lang=vi"/)
  assert.match(html, /href="\/admin\/purchase\/rfqs\?state=to\+approve&amp;lang=vi"/)
  assert.match(html, /href="\/admin\/purchase\/orders\?lang=vi"/)
  assert.match(html, /Chờ gửi[\s\S]*?data-ui="metric-value"[^>]*>[\s\S]*?2/)
  assert.match(html, /Chờ phản hồi[\s\S]*?data-ui="metric-value"[^>]*>[\s\S]*?1/)
  assert.match(html, /Chờ duyệt[\s\S]*?data-ui="metric-value"[^>]*>[\s\S]*?1/)
  assert.match(html, /Đơn mua[\s\S]*?data-ui="metric-value"[^>]*>[\s\S]*?2/)
  assert.match(html, /Chờ lập hóa đơn[\s\S]*?data-ui="metric-value"[^>]*>[\s\S]*?1/)
  assert.doesNotMatch(html, /mail\.chatter|data-ui="form-page-aside"/)
})

test('purchase overview omits setup rejection when prerequisites exist', () => {
  const html = renderToString(purchaseOverviewScreen(translate, [], {}, '', { pickingTypes: 1, vendors: 1 }))

  assert.doesNotMatch(html, /data-ui="notice"/)
  assert.match(html, /href="\/admin\/purchase\/rfqs#rfq-create-form"/)
  assert.match(html, /data-ui="metric-value"[^>]*>[\s\S]*?0/)
})
