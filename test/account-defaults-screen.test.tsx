import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { accountDefaultsScreen } from '../packages/ketsuite/src/modules/account_backend/screens/account-defaults.tsx'

const messages: Record<string, string> = {
  'account_backend.action.cancelEdit': 'Huỷ sửa',
  'account_backend.action.create': 'Tạo',
  'account_backend.action.save': 'Lưu',
  'account_backend.defaults.categories.empty': 'Chưa nhóm nào có tài khoản riêng',
  'account_backend.defaults.categories.emptyHint': 'Mọi hàng hoá dùng mặc định công ty.',
  'account_backend.defaults.categories.hint': 'Mở một dòng để sửa.',
  'account_backend.defaults.categories.title': 'Nhóm sản phẩm đã cấu hình',
  'account_backend.defaults.category.edit.title': 'Sửa tài khoản của nhóm sản phẩm',
  'account_backend.defaults.category.hint': 'Nhóm sản phẩm quyết định tài khoản hạch toán.',
  'account_backend.defaults.category.title': 'Đặt tài khoản cho nhóm sản phẩm',
  'account_backend.defaults.company.hint': 'Dùng khi không có cấu hình riêng.',
  'account_backend.defaults.company.title': 'Mặc định của công ty',
  'account_backend.defaults.subtitle': 'Quyết định trước tài khoản cho hoá đơn.',
  'account_backend.defaults.summary.categories': 'Nhóm đã cấu hình',
  'account_backend.defaults.title': 'Tài khoản mặc định',
  'account_backend.field.categoryId': 'Nhóm sản phẩm',
  'account_backend.field.expenseAccountId': 'Tài khoản chi phí',
  'account_backend.field.incomeAccountId': 'Tài khoản doanh thu',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('account defaults FormPage keeps the independent company and category forms with relations', () => {
  const html = renderToString(
    accountDefaultsScreen(translate, {
      frame: {},
      action: '/admin/accounting/defaults?lang=vi',
      categoryAction: '/admin/accounting/defaults?lang=vi&editCategory=services',
      cancelHref: '/admin/accounting/defaults?lang=vi',
      editing: { id: 'services-defaults', categoryId: 'services', categoryName: 'Dịch vụ' },
      categorySubmit: 'Lưu',
      errors: ['Tài khoản phải thu không hợp lệ'],
      categoryErrors: ['Tài khoản doanh thu không hợp lệ'],
      defaultsFields: [
        {
          name: 'incomeAccountId',
          label: 'Tài khoản doanh thu',
          error: 'Tài khoản phải thu không hợp lệ',
          control: <div data-island="backend.relation-select" data-selected="income" />,
        },
      ],
      categoryFields: [
        {
          name: 'categoryId',
          label: 'Nhóm sản phẩm',
          type: 'select',
          value: 'services',
          options: [{ value: 'services', label: 'Dịch vụ' }],
          required: true,
        },
        {
          name: 'expenseAccountId',
          label: 'Tài khoản chi phí',
          control: <div data-island="backend.relation-select" data-selected="expense" />,
        },
      ],
      rows: [
        {
          id: 'services-defaults',
          categoryId: 'services',
          categoryName: 'Dịch vụ',
          incomeAccountId: 'income',
          expenseAccountId: 'expense',
        },
      ],
      accountLabel: (id) => (id === 'income' ? '511 · Doanh thu' : '642 · Chi phí quản lý'),
      categoryHref: (row) => `/admin/accounting/defaults?lang=vi&editCategory=${String(row.categoryId)}`,
    }),
  )

  assert.match(html, /data-ui="form-page" data-scope="account-defaults-form-page"/)
  assert.match(html, /Nhóm đã cấu hình: 1/)
  assert.match(html, /form="account-defaults-form"[\s\S]*?Lưu/)
  assert.match(html, /id="account-defaults-form"[\s\S]*?action="\/admin\/accounting\/defaults\?lang=vi"/)
  assert.match(html, /id="account-category-form"/)
  assert.match(html, /name="action" value="category"/)
  assert.match(html, /data-island="backend\.relation-select"[^>]*data-selected="income"/)
  assert.match(html, /data-island="backend\.relation-select"[^>]*data-selected="expense"/)
  assert.match(html, /href="\/admin\/accounting\/defaults\?lang=vi&amp;editCategory=services"/)
  assert.match(html, /href="\/admin\/accounting\/defaults\?lang=vi"[\s\S]*?Huỷ sửa/)
  assert.match(html, /511 · Doanh thu/)
  assert.match(html, /642 · Chi phí quản lý/)
  assert.match(html, /data-ui="form-errors" role="alert"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="list-page"|mail\.chatter/)
})

test('account defaults FormPage retains the empty setup notice when no category override exists', () => {
  const html = renderToString(
    accountDefaultsScreen(translate, {
      frame: {},
      action: '/admin/accounting/defaults?lang=vi',
      categoryAction: '/admin/accounting/defaults?lang=vi',
      defaultsFields: [],
      rows: [],
      accountLabel: String,
    }),
  )

  assert.match(html, /data-ui="form-page"/)
  assert.match(html, /Nhóm đã cấu hình: 0/)
  assert.match(html, /Chưa nhóm nào có tài khoản riêng/)
  assert.match(html, /Mọi hàng hoá dùng mặc định công ty/)
  assert.doesNotMatch(html, /id="account-category-form"/)
})
