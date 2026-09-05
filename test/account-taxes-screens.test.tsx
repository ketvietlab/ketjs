import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { taxFormScreen } from '../packages/ketsuite/src/modules/account_backend/screens/tax-form.tsx'
import { taxesListScreen } from '../packages/ketsuite/src/modules/account_backend/screens/taxes-list.tsx'

const messages: Record<string, string> = {
  'account_backend.action.cancelEdit': 'Huỷ',
  'account_backend.action.create': 'Tạo',
  'account_backend.action.save': 'Lưu',
  'account_backend.active': 'Đang dùng',
  'account_backend.archived': 'Đã lưu trữ',
  'account_backend.column.includeBaseAmount': 'Cộng vào cơ sở',
  'account_backend.field.accountId': 'Tài khoản thuế',
  'account_backend.field.active': 'Hoạt động',
  'account_backend.field.amount': 'Số tiền / tỷ lệ',
  'account_backend.field.amountType': 'Cách tính',
  'account_backend.field.description': 'Mô tả',
  'account_backend.field.includeBaseAmount': 'Ảnh hưởng cơ sở tính thuế',
  'account_backend.field.name': 'Tên',
  'account_backend.field.priceInclude': 'Đã gồm trong giá',
  'account_backend.field.sequence': 'Số thứ tự',
  'account_backend.field.typeTaxUse': 'Áp dụng',
  'account_backend.no': 'Không',
  'account_backend.yes': 'Có',
  'account_backend.tax.create.hint': 'Cấu hình cách tính và tài khoản ghi nhận.',
  'account_backend.tax.create.title': 'Tạo thuế',
  'account_backend.tax.edit.title': 'Sửa thuế',
  'account_backend.tax.empty': 'Chưa có thuế',
  'account_backend.tax.emptyHint': 'Tạo sắc thuế đầu tiên.',
  'account_backend.tax.subtitle': 'Quản lý phạm vi và cách tính thuế.',
  'account_backend.tax.summary.included': 'Đã gồm trong giá',
  'account_backend.tax.summary.purchase': 'Mua hàng',
  'account_backend.tax.summary.sale': 'Bán hàng',
  'account_backend.tax.summary.total': 'Tổng sắc thuế',
  'account_backend.taxes.title': 'Thuế',
  'account_backend.taxAmountType.fixed': 'Cố định',
  'account_backend.taxAmountType.percent': 'Phần trăm',
  'account_backend.taxUse.purchase': 'Mua hàng',
  'account_backend.taxUse.sale': 'Bán hàng',
  'backend.chrome.next': 'Trang sau',
  'backend.chrome.previous': 'Trang trước',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('tax ListPage keeps command controls, computation columns, account relation and summaries', () => {
  const rows = [
    {
      id: 'vat',
      name: 'VAT đầu ra 10%',
      typeTaxUse: 'sale',
      amountType: 'percent',
      amount: '10',
      accountId: 'tax-account',
      priceInclude: true,
      includeBaseAmount: false,
      active: true,
    },
  ]
  const html = renderToString(
    taxesListScreen(translate, {
      frame: {
        chrome: {
          search: {
            name: 'q',
            value: 'VAT',
            placeholder: 'Thuế',
            facets: [{ label: 'Bán hàng', without: '/admin/accounting/taxes?lang=vi' }],
            menus: [],
          },
          pager: { from: 1, to: 1, total: 1, prev: null, next: null },
        },
      },
      rows,
      accounts: [{ id: 'tax-account', code: '33311', name: 'Thuế GTGT đầu ra' }],
      currency: 'VND',
      createHref: '/admin/accounting/taxes/new?lang=vi&returnTo=%2Fadmin%2Faccounting%2Ftaxes',
      rowHref: (row) =>
        `/admin/accounting/taxes/new?lang=vi&returnTo=%2Fadmin%2Faccounting%2Ftaxes&edit=${String(row.id)}`,
      summary: { total: 5, sale: 3, purchase: 2, included: 1 },
    }),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /href="\/admin\/accounting\/taxes\/new\?lang=vi&amp;returnTo=/)
  assert.match(html, /data-ui="chrome-search"[\s\S]*?name="q"[\s\S]*?value="VAT"/)
  assert.match(html, /Tổng sắc thuế: 5[\s\S]*?Bán hàng: 3[\s\S]*?Mua hàng: 2/)
  assert.match(html, /data-col="use"[\s\S]*?Bán hàng/)
  assert.match(html, /data-col="computation"[\s\S]*?Phần trăm/)
  assert.match(html, /data-col="amount"[\s\S]*?10%/)
  assert.match(html, /data-col="account"[\s\S]*?33311/)
  assert.match(html, /data-col="included"[\s\S]*?data-tone="positive"[\s\S]*?Có/)
  assert.doesNotMatch(html, /id="tax-create-form"|data-ui="form-page"|mail\.chatter/)
})

test('tax create FormPage preserves validation, every business field and account relation control', () => {
  const html = renderToString(
    taxFormScreen(translate, {
      frame: {},
      action: '/admin/accounting/taxes/new?lang=vi&returnTo=%2Fadmin%2Faccounting%2Ftaxes',
      cancelHref: '/admin/accounting/taxes?lang=vi',
      errors: ['Cách tính không hợp lệ'],
      fields: [
        { name: 'name', label: 'Tên', value: 'VAT nhập dở', required: true },
        { name: 'description', label: 'Mô tả', value: 'Giữ lại mô tả' },
        {
          name: 'typeTaxUse',
          label: 'Áp dụng',
          type: 'select',
          value: 'sale',
          options: [{ value: 'sale', label: 'Bán hàng' }],
        },
        {
          name: 'amountType',
          label: 'Cách tính',
          type: 'select',
          value: 'fixed',
          error: 'Cách tính không hợp lệ',
          options: [{ value: 'fixed', label: 'Cố định' }],
        },
        { name: 'amount', label: 'Số tiền / tỷ lệ', type: 'decimal', value: '1250', required: true },
        {
          name: 'accountId',
          label: 'Tài khoản thuế',
          control: <div data-island="backend.relation-select" data-selected="tax-account" />,
        },
        { name: 'priceInclude', label: 'Đã gồm trong giá', type: 'checkbox', value: true },
        {
          name: 'includeBaseAmount',
          label: 'Ảnh hưởng cơ sở tính thuế',
          type: 'checkbox',
          value: true,
        },
        { name: 'sequence', label: 'Số thứ tự', type: 'number', value: '25' },
        { name: 'active', label: 'Hoạt động', type: 'checkbox', value: true },
      ],
    }),
  )

  assert.match(html, /data-ui="form-page" data-scope="account-tax-form-page" data-has-aside="false"/)
  assert.match(html, /id="tax-create-form"/)
  assert.match(html, /name="name"[^>]*value="VAT nhập dở"/)
  assert.match(html, /name="description"[^>]*value="Giữ lại mô tả"/)
  assert.match(html, /name="typeTaxUse"[\s\S]*?value="sale"[^>]*selected/)
  assert.match(html, /name="amountType"[\s\S]*?value="fixed"[^>]*selected/)
  assert.match(html, /name="amount"[^>]*value="1250"/)
  assert.match(html, /data-island="backend\.relation-select"[^>]*data-selected="tax-account"/)
  assert.match(html, /name="priceInclude"[^>]*checked/)
  assert.match(html, /name="includeBaseAmount"[^>]*checked/)
  assert.match(html, /name="sequence"[^>]*value="25"/)
  assert.match(html, /form="tax-create-form"[\s\S]*?Tạo/)
  assert.doesNotMatch(html, /data-ui="list-page"|mail\.chatter|data-ui="form-page-aside"/)
})

test('tax edit FormPage keeps identity, archive status and save semantics', () => {
  const html = renderToString(
    taxFormScreen(translate, {
      frame: {},
      action: '/admin/accounting/taxes/new?lang=vi&returnTo=%2Fadmin%2Faccounting%2Ftaxes&edit=vat',
      cancelHref: '/admin/accounting/taxes?lang=vi',
      editing: { id: 'vat', name: 'VAT đầu ra 10%', active: false },
      fields: [{ name: 'name', label: 'Tên', value: 'VAT đầu ra 10%', required: true }],
    }),
  )

  assert.match(html, /Sửa thuế/)
  assert.match(html, /VAT đầu ra 10%/)
  assert.match(html, /data-ui="form-page-status"[\s\S]*?data-tone="neutral"[\s\S]*?Đã lưu trữ/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?form="tax-create-form"[\s\S]*?Lưu/)
  assert.doesNotMatch(html, /mail\.chatter/)
})
