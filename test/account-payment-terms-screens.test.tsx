import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  paymentTermFormModal,
  paymentTermFormScreen,
  paymentTermLineFormModal,
} from '../packages/ketsuite/src/modules/account_backend/screens/payment-term-form.tsx'
import { paymentTermsListScreen } from '../packages/ketsuite/src/modules/account_backend/screens/payment-terms-list.tsx'

const messages: Record<string, string> = {
  'account_backend.action.addTermLine': 'Thêm mốc',
  'account_backend.action.cancelEdit': 'Huỷ',
  'account_backend.action.createTerm': 'Tạo điều khoản',
  'account_backend.action.save': 'Lưu',
  'account_backend.active': 'Đang dùng',
  'account_backend.archived': 'Đã lưu trữ',
  'account_backend.field.active': 'Hoạt động',
  'account_backend.field.daysNextMonth': 'Ngày tháng sau',
  'account_backend.field.delayType': 'Cách tính hạn',
  'account_backend.field.name': 'Tên',
  'account_backend.field.nbDays': 'Số ngày',
  'account_backend.field.note': 'Ghi chú',
  'account_backend.field.paymentTermId': 'Điều khoản',
  'account_backend.field.termValue': 'Giá trị',
  'account_backend.term.create.hint': 'Đặt tên và ghi chú hiển thị trên chứng từ.',
  'account_backend.term.create.title': 'Tạo điều khoản thanh toán',
  'account_backend.term.edit.title': 'Sửa điều khoản thanh toán',
  'account_backend.term.empty': 'Chưa có điều khoản',
  'account_backend.term.emptyHint': 'Tạo điều khoản đầu tiên.',
  'account_backend.term.line.create.hint': 'Chọn cách tính ngày đến hạn.',
  'account_backend.term.line.create.title': 'Thêm mốc đến hạn',
  'account_backend.term.line.edit.title': 'Sửa mốc đến hạn',
  'account_backend.term.list.hint': 'Kiểm tra số mốc và ghi chú.',
  'account_backend.term.list.title': 'Điều khoản hiện có',
  'account_backend.term.milestones.empty': 'Chưa có mốc',
  'account_backend.term.milestones.emptyHint': 'Hoá đơn đến hạn ngay.',
  'account_backend.term.milestones.hint': 'Mở một mốc để sửa.',
  'account_backend.term.milestones.title': 'Các mốc đã cấu hình',
  'account_backend.term.subtitle': 'Cấu hình các mốc đến hạn thanh toán.',
  'account_backend.term.summary.configured': 'Đã có mốc',
  'account_backend.term.summary.lines': 'Tổng số mốc',
  'account_backend.term.summary.total': 'Tổng điều khoản',
  'account_backend.terms.lines': 'Số mốc',
  'account_backend.terms.title': 'Điều khoản thanh toán',
  'backend.chrome.next': 'Trang sau',
  'backend.chrome.previous': 'Trang trước',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('payment terms ListPage keeps command controls, summaries, archive state and editable milestones', () => {
  const rows = [
    {
      id: 'net-30',
      name: '30 ngày',
      note: 'Thanh toán sau một tháng',
      active: false,
      lines: [
        {
          id: 'net-30-line',
          value: 'percent',
          valueAmount: '100',
          delayType: 'days_after',
          nbDays: 30,
          sequence: 10,
        },
      ],
    },
  ]
  const html = renderToString(
    paymentTermsListScreen(translate, {
      frame: {
        chrome: {
          search: {
            name: 'q',
            value: '30',
            placeholder: 'Điều khoản thanh toán',
            facets: [{ label: 'Đã lưu trữ', without: '/admin/accounting/terms?lang=vi' }],
            menus: [],
          },
          pager: { from: 1, to: 1, total: 1, prev: null, next: null },
        },
      },
      rows,
      createHref: '/admin/accounting/terms?lang=vi&q=30&create=1',
      lineCreateHref: '/admin/accounting/terms?lang=vi&q=30&line=1',
      rowHref: (row) => `/admin/accounting/terms?lang=vi&q=30&edit=${String(row.id)}`,
      lineHref: (line) => `/admin/accounting/terms?lang=vi&q=30&editLine=${String(line.id)}`,
      delayLabel: () => 'Số ngày sau ngày hoá đơn',
      valueLabel: () => 'Phần trăm',
      summary: { total: 4, configured: 3, lines: 5 },
    }),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /href="\/admin\/accounting\/terms\?lang=vi&amp;q=30&amp;create=1"/)
  assert.match(html, /href="\/admin\/accounting\/terms\?lang=vi&amp;q=30&amp;line=1"/)
  assert.match(html, /data-ui="chrome-search"[\s\S]*?name="q"[\s\S]*?value="30"/)
  assert.match(html, /Tổng điều khoản: 4[\s\S]*?Đã có mốc: 3[\s\S]*?Tổng số mốc: 5/)
  assert.match(html, /data-col="active"[\s\S]*?data-tone="neutral"[\s\S]*?Đã lưu trữ/)
  assert.match(html, /href="\/admin\/accounting\/terms\?lang=vi&amp;q=30&amp;edit=net-30"/)
  assert.match(html, /href="\/admin\/accounting\/terms\?lang=vi&amp;q=30&amp;editLine=net-30-line"/)
  assert.match(html, /100% · Phần trăm/)
  assert.match(html, /Số ngày sau ngày hoá đơn/)
  assert.doesNotMatch(html, /id="payment-term-create-form"|id="payment-term-line-form"|mail\.chatter/)
})

test('payment term FormPage preserves rejected values and edit archive semantics', () => {
  const html = renderToString(
    paymentTermFormScreen(translate, {
      frame: {},
      action: '/admin/accounting/terms?lang=vi&q=30&edit=net-30',
      cancelHref: '/admin/accounting/terms?lang=vi&q=30',
      editing: { id: 'net-30', name: '30 ngày', active: false },
      errors: ['Tên đã tồn tại'],
      fields: [
        { name: 'name', label: 'Tên', value: '30 ngày nhập dở', error: 'Tên đã tồn tại', required: true },
        { name: 'note', label: 'Ghi chú', value: 'Giữ lại ghi chú', type: 'textarea' },
        { name: 'active', label: 'Hoạt động', value: false, type: 'checkbox' },
      ],
    }),
  )

  assert.match(html, /data-ui="form-page" data-scope="account-payment-term-form-page"/)
  assert.match(html, /Sửa điều khoản thanh toán/)
  assert.match(html, /data-ui="form-page-status"[\s\S]*?data-tone="neutral"[\s\S]*?Đã lưu trữ/)
  assert.match(html, /name="name"[^>]*value="30 ngày nhập dở"[^>]*aria-invalid="true"/)
  assert.match(html, /Giữ lại ghi chú/)
  assert.match(html, /form="payment-term-create-form"[\s\S]*?Lưu/)
  assert.doesNotMatch(html, /data-ui="list-page"|mail\.chatter/)
})

test('URL-addressable term and milestone sheets keep their separate POST semantics', () => {
  const term = renderToString(
    paymentTermFormModal(translate, {
      frame: {},
      action: '/admin/accounting/terms?lang=vi&create=1',
      cancelHref: '/admin/accounting/terms?lang=vi',
      fields: [{ name: 'name', label: 'Tên', required: true }],
    }),
  )
  const line = renderToString(
    paymentTermLineFormModal(translate, {
      frame: {},
      action: '/admin/accounting/terms?lang=vi&editLine=line-1',
      cancelHref: '/admin/accounting/terms?lang=vi',
      editing: { id: 'line-1' },
      fields: [{ name: 'paymentId', label: 'Điều khoản', type: 'select', required: true }],
    }),
  )

  assert.match(term, /data-ui="modal-sheet"/)
  assert.match(term, /id="payment-term-create-form"/)
  assert.doesNotMatch(term, /name="action"/)
  assert.match(line, /data-ui="modal-sheet"/)
  assert.match(line, /id="payment-term-line-form"/)
  assert.match(line, /name="action" value="line"/)
  assert.match(line, /Sửa mốc đến hạn/)
})
