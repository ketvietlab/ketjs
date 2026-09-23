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

const selection = {
  formId: 'partner-directory-bulk',
  action: '/admin/partner/partners/bulk',
  hidden: { returnTo: '/admin/partner/partners?lang=vi' },
  actions: [{ id: 'archive', label: 'Lưu trữ đã chọn' }],
}

// `partnersScreen` now takes both the filter bar and the table already
// rendered — real markup for either comes from an island (`search-filter`,
// `KetTable`) via `ctx.joint` at the route, which needs a live serve context
// this unit test doesn't have. So these tests only cover what `partnersScreen`
// itself still controls: the surrounding ListPage/actions structure, with a
// plain marker standing in for whatever the route handed it.

test('partner list: follows the shared ListPage hierarchy and places the filter bar and table', () => {
  const html = renderToString(
    partnersScreen(
      translate,
      {
        chrome: {
          create: { label: 'Tạo đối tác', path: '/admin/partner/partners/new' },
          selection,
        },
      },
      <div data-ui="search-filter-test-marker">Bộ lọc</div>,
      <div data-ui="ket-table-test-marker">Công ty Minh An</div>,
      24,
    ),
  )

  assert.equal(html.match(/data-ui="list-page-title"/g)?.length, 1)
  assert.doesNotMatch(html, /data-ui="topbar"/)
  assert.match(
    html,
    /data-ui="list-page-title-row"[\s\S]*?data-ui="list-page-actions"[\s\S]*?href="\/admin\/partner\/partners\/new"/,
  )
  const headerStart = html.indexOf('data-ui="list-page-header"')
  const headerEnd = html.indexOf('</header>', headerStart)
  const header = html.slice(headerStart, headerEnd)
  assert.match(
    header,
    /href="\/admin\/partner\/partners\/new"[\s\S]*?data-ui="list-page-tools"[^>]* hidden[\s\S]*?data-ui="bulk-form" id="partner-directory-bulk"/,
  )
  assert.match(header, /action="\/admin\/partner\/partners\/bulk"/)
  assert.match(header, /name="returnTo" value="\/admin\/partner\/partners\?lang=vi"/)
  assert.doesNotMatch(html.slice(headerEnd), /data-ui="list-page-actions"|data-ui="list-page-tools"/)
  assert.match(
    html,
    /data-ui="list-page-controls"[\s\S]*?search-filter-test-marker[\s\S]*?data-ui="list-page-body"[\s\S]*?data-ui="list-page-footer"[\s\S]*?24 đối tác/,
  )
  assert.match(html, /data-ui="list-page-body"[\s\S]*?data-ui="ket-table-test-marker"[\s\S]*?Công ty Minh An/)
  const controls = html.slice(
    html.indexOf('data-ui="list-page-controls"'),
    html.indexOf('data-ui="list-page-body"'),
  )
  assert.doesNotMatch(controls, /data-ui="bulk-form"/)
  assert.doesNotMatch(html, /data-ui="tabs"/)
  assert.doesNotMatch(html, /data-ui="partner-list-rail"/)
})

test('partner list: still renders the filter bar and count when a filtered result is empty', () => {
  const html = renderToString(
    partnersScreen(
      translate,
      {},
      <div data-ui="search-filter-test-marker">Bộ lọc</div>,
      <div data-ui="empty">Chưa có đối tác nào</div>,
      0,
    ),
  )
  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="search-filter-test-marker"/)
  assert.match(html, /data-ui="empty"/)
  assert.match(html, /0 đối tác/)
})

test('partner list keeps search, URL paging and column choices in one command bar', () => {
  const html = renderToString(
    partnersScreen(
      translate,
      {
        chrome: {
          selection,
          pager: {
            from: 31,
            to: 60,
            total: 84,
            prev: '/admin/partner/partners?q=Minh&role=customer&lang=vi',
            next: '/admin/partner/partners?q=Minh&role=customer&lang=vi&page=3',
          },
          tailMenus: [
            {
              id: 'columns',
              label: 'Cột',
              items: [
                {
                  id: 'id',
                  label: 'ID',
                  path: '/admin/partner/partners?q=Minh&role=customer&lang=vi&page=2&cols=id',
                },
              ],
            },
          ],
        },
      },
      <div data-ui="search-filter-test-marker">Bộ lọc</div>,
      <div data-ui="ket-table-test-marker">Công ty Minh An</div>,
      84,
    ),
  )
  assert.match(html, /data-ui="list-chrome" data-layout="command"/)
  assert.match(
    html,
    /data-ui="chrome-search-content"[\s\S]*?search-filter-test-marker[\s\S]*?data-ui="chrome-tail"[\s\S]*?31-60 \/ 84/,
  )
  assert.match(html, /href="\/admin\/partner\/partners\?q=Minh&amp;role=customer&amp;lang=vi&amp;page=3"/)
  assert.match(
    html,
    /href="\/admin\/partner\/partners\?q=Minh&amp;role=customer&amp;lang=vi&amp;page=2&amp;cols=id"/,
  )
  assert.equal(html.match(/data-ui="bulk-form"/g)?.length, 1)
  assert.doesNotMatch(html, /data-ui="view-switch"/)
})
