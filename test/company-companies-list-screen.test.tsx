import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { companiesListScreen } from '../packages/ketsuite/src/modules/company_backend/screens/index.ts'

const messages: Record<string, string> = {
  'backend.chrome.next': 'Trang sau',
  'backend.chrome.previous': 'Trang trước',
  'company_backend.action.create': 'Tạo công ty',
  'company_backend.action.hierarchy': 'Xem cây pháp nhân',
  'company_backend.field.code': 'Mã',
  'company_backend.field.currency': 'Tiền tệ',
  'company_backend.field.name': 'Tên',
  'company_backend.field.state': 'Trạng thái',
  'company_backend.filter.activeOnly': 'Chỉ đang hoạt động',
  'company_backend.filter.includeArchived': 'Gồm đã lưu trữ',
  'company_backend.screen.empty': 'Chưa có công ty nào',
  'company_backend.screen.emptyHint': 'Tạo pháp nhân đầu tiên.',
  'company_backend.screen.subtitle': 'Quản lý pháp nhân theo mã ổn định.',
  'company_backend.screen.title': 'Công ty',
  'company_backend.state.active': 'Đang hoạt động',
  'company_backend.state.archived': 'Đã lưu trữ',
}
const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('company list uses public ListPage chrome, hierarchy/archive actions and encoded row navigation', () => {
  const html = renderToString(
    companiesListScreen(
      translate,
      {
        chrome: {
          search: { name: 'q', value: 'Két', placeholder: 'Tìm công ty' },
          pager: {
            from: 1,
            to: 1,
            total: 31,
            prev: null,
            next: '/admin/companies?q=K%C3%A9t&page=2&lang=vi',
          },
        },
      },
      {
        rows: [
          {
            id: 'company/a',
            code: 'KET',
            name: 'Công ty Két Việt',
            partnerId: 'partner-1',
            currency: 'VND',
            active: false,
            detailHref: '/admin/companies/company%2Fa?lang=vi',
          },
        ],
        total: 31,
        createHref: '/admin/companies/new?lang=vi',
        hierarchyHref: '/admin/companies/hierarchy?lang=vi',
        toggleHref: '/admin/companies?q=K%C3%A9t&lang=vi',
        includeArchived: true,
      },
    ),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="list-chrome" data-layout="command"/)
  assert.match(html, /data-ui="chrome-search"[\s\S]*?name="q"[\s\S]*?value="Két"/)
  assert.match(html, /data-ui="pager-range"[^>]*>[\s\S]*?1-1 \/ 31/)
  assert.match(html, /href="\/admin\/companies\/new\?lang=vi"/)
  assert.match(html, /href="\/admin\/companies\/hierarchy\?lang=vi"/)
  assert.match(html, /href="\/admin\/companies\?q=K%C3%A9t&amp;lang=vi"/)
  assert.match(html, /data-row-href="\/admin\/companies\/company%2Fa\?lang=vi"/)
  assert.match(html, /data-col="code"[\s\S]*?KET/)
  assert.match(html, /data-tone="neutral" data-value="archived"/)
  assert.doesNotMatch(html, /data-ui="form-page"|data-ui="modal-layer"/)
})

test('company list keeps the ListPage shell and focused empty state', () => {
  const html = renderToString(
    companiesListScreen(
      translate,
      {},
      {
        rows: [],
        total: 0,
        createHref: '/admin/companies/new',
        hierarchyHref: '/admin/companies/hierarchy',
        toggleHref: '/admin/companies?archived=1',
        includeArchived: false,
      },
    ),
  )
  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /Chưa có công ty nào/)
  assert.match(html, /Gồm đã lưu trữ/)
  assert.doesNotMatch(html, /data-ui="table"|data-ui="list-chrome"/)
})
