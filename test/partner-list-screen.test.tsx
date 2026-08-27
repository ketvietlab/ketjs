import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { partnersScreen } from '../packages/ketsuite/src/modules/partner_backend/screens/list.tsx'

const messages: Record<string, string> = {
  'partner_backend.screen.title': 'Đối tác',
  'partner_backend.screen.description':
    'Quản lý khách hàng, nhà cung cấp và liên hệ trong một danh bạ thống nhất.',
  'partner_backend.screen.results': '{count} đối tác',
  'partner_backend.screen.empty': 'Chưa có đối tác nào',
  'partner_backend.screen.emptyHint': 'Tạo khách hàng, nhà cung cấp hoặc liên hệ đầu tiên.',
  'partner_backend.list.summary': 'Tổng quan',
  'partner_backend.list.all': 'Tất cả',
  'partner_backend.filter.customers': 'Khách hàng',
  'partner_backend.filter.suppliers': 'Nhà cung cấp',
  'partner_backend.filter.includeArchived': 'Gồm đã lưu trữ',
  'partner_backend.field.name': 'Tên',
  'partner_backend.field.kind': 'Loại',
  'partner_backend.field.email': 'Email',
  'partner_backend.field.phone': 'Điện thoại',
  'partner_backend.field.ref': 'Mã đối tác',
  'partner_backend.field.state': 'Trạng thái',
  'partner_backend.state.active': 'Đang hoạt động',
  'partner_backend.state.archived': 'Đã lưu trữ',
  'partner.kind.company': 'Công ty',
  'backend.table.columns': 'Cột',
  'backend.table.selectAll': 'Chọn tất cả dòng',
  'backend.table.selectRow': 'Chọn dòng',
  'backend.chrome.more': 'Thêm thao tác',
  'backend.chrome.previous': 'Trang trước',
  'backend.chrome.next': 'Trang sau',
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

const summary = {
  total: 24,
  customers: 18,
  suppliers: 7,
  archived: 2,
  allHref: '/admin/partner/partners',
  customersHref: '/admin/partner/partners?role=customer',
  suppliersHref: '/admin/partner/partners?role=supplier',
  archivedHref: '/admin/partner/partners?archived=1',
  active: 'all' as const,
}

const selection = {
  formId: 'partner-directory-bulk',
  action: '/admin/partner/partners/bulk',
  hidden: { returnTo: '/admin/partner/partners?lang=vi' },
  actions: [{ id: 'archive', label: 'Lưu trữ đã chọn' }],
}

test('partner list: follows the shared ListPage hierarchy and keeps directory tabs', () => {
  const html = renderToString(
    partnersScreen(
      translate,
      [
        {
          id: 'minh-an',
          kind: 'company',
          name: 'Công ty Minh An',
          ref: 'KH-0018',
          email: 'hello@minhan.example',
          phone: '024 3765 4321',
          active: true,
        },
      ],
      {
        chrome: {
          create: { label: 'Tạo đối tác', path: '/admin/partner/partners/new' },
          selection,
          search: { name: 'q', placeholder: 'Tìm theo tên đối tác…' },
          pager: { from: 1, to: 1, total: 24 },
        },
      },
      { selection },
      '?lang=vi',
      summary,
      24,
    ),
  )

  assert.equal(html.match(/data-ui="list-page-title"/g)?.length, 1)
  assert.doesNotMatch(html, /data-ui="topbar"/)
  assert.match(
    html,
    /data-ui="list-page-title-row"[\s\S]*?data-ui="list-page-actions"[\s\S]*?href="\/admin\/partner\/partners\/new"/,
  )
  assert.match(
    html,
    /data-ui="list-page-actions"[\s\S]*?data-ui="action"[\s\S]*?data-ui="bulk-form"[\s\S]*?data-ui="list-page-toolbar"/,
  )
  assert.match(
    html,
    /data-ui="list-page-toolbar"[\s\S]*?data-ui="list-page-status"[\s\S]*?24 đối tác[\s\S]*?data-ui="list-page-controls"[\s\S]*?data-layout="command"/,
  )
  assert.match(html, /data-ui="tabs"[\s\S]*?Khách hàng[\s\S]*?18/)
  assert.match(html, /data-ui="person"[\s\S]*?Công ty Minh An/)
  assert.match(html, /data-ui="select-all"/)
  assert.match(html, /data-ui="row-select"[^>]*form="partner-directory-bulk"/)
  const controls = html.slice(
    html.indexOf('data-ui="list-page-controls"'),
    html.indexOf('data-ui="list-page-body"'),
  )
  assert.doesNotMatch(controls, /data-ui="bulk-form"/)
  assert.doesNotMatch(html, /data-ui="partner-list-rail"/)
})

test('partner list: keeps tabs available when a filtered result is empty', () => {
  const html = renderToString(partnersScreen(translate, [], {}, {}, '?lang=vi', summary, 0))
  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="tabs"/)
  assert.match(html, /data-ui="empty"/)
  assert.match(html, /0 đối tác/)
})
