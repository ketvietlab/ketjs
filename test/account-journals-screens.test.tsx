import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { journalFormScreen } from '../packages/ketsuite/src/modules/account_backend/screens/journal-form.tsx'
import { journalsListScreen } from '../packages/ketsuite/src/modules/account_backend/screens/journals-list.tsx'

const messages: Record<string, string> = {
  'account_backend.action.cancelEdit': 'Huỷ',
  'account_backend.action.create': 'Tạo',
  'account_backend.action.save': 'Lưu',
  'account_backend.active': 'Đang dùng',
  'account_backend.archived': 'Đã lưu trữ',
  'account_backend.field.active': 'Hoạt động',
  'account_backend.field.code': 'Mã',
  'account_backend.field.defaultAccountId': 'Tài khoản mặc định',
  'account_backend.field.name': 'Tên',
  'account_backend.field.type': 'Loại',
  'account_backend.journal.create.hint': 'Mã là duy nhất.',
  'account_backend.journal.create.title': 'Tạo sổ nhật ký',
  'account_backend.journal.edit.title': 'Sửa sổ nhật ký',
  'account_backend.journal.empty': 'Chưa có sổ nhật ký',
  'account_backend.journal.emptyHint': 'Tạo sổ đầu tiên.',
  'account_backend.journal.subtitle': 'Phân loại chứng từ và tài khoản mặc định.',
  'account_backend.journal.summary.liquidity': 'Ngân hàng và tiền mặt',
  'account_backend.journal.summary.purchase': 'Mua hàng',
  'account_backend.journal.summary.sale': 'Bán hàng',
  'account_backend.journal.summary.total': 'Tổng sổ',
  'account_backend.journals.title': 'Sổ nhật ký',
  'account_backend.journalType.bank': 'Ngân hàng',
  'backend.chrome.next': 'Trang sau',
  'backend.chrome.previous': 'Trang trước',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('journal ListPage keeps command controls, business summary, relation label and archive status', () => {
  const rows = [
    {
      id: 'bank',
      code: 'BNK',
      name: 'Ngân hàng',
      type: 'bank',
      defaultAccountId: 'cash',
      active: false,
    },
  ]
  const html = renderToString(
    journalsListScreen(translate, {
      frame: {
        chrome: {
          search: {
            name: 'q',
            value: 'BNK',
            placeholder: 'Sổ nhật ký',
            facets: [{ label: 'Ngân hàng', without: '/admin/accounting/journals?lang=vi' }],
            menus: [],
          },
          pager: {
            from: 1,
            to: 1,
            total: 1,
            prev: null,
            next: null,
          },
        },
      },
      rows,
      accounts: [{ id: 'cash', code: '112', name: 'Tiền gửi ngân hàng' }],
      createHref: '/admin/accounting/journals/new?lang=vi&returnTo=%2Fadmin%2Faccounting%2Fjournals',
      rowHref: (row) =>
        `/admin/accounting/journals/new?lang=vi&returnTo=%2Fadmin%2Faccounting%2Fjournals&edit=${String(row.id)}`,
      summary: { total: 4, sale: 1, purchase: 1, liquidity: 2 },
    }),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /href="\/admin\/accounting\/journals\/new\?lang=vi&amp;returnTo=/)
  assert.match(html, /data-ui="chrome-search"[\s\S]*?name="q"[\s\S]*?value="BNK"/)
  assert.match(html, /data-ui="facet"[\s\S]*?Ngân hàng/)
  assert.match(html, /Tổng sổ: 4[\s\S]*?Bán hàng: 1[\s\S]*?Mua hàng: 1/)
  assert.match(html, /data-col="code"[\s\S]*?BNK/)
  assert.match(html, /data-col="account"[\s\S]*?112 · Tiền gửi ngân hàng/)
  assert.match(html, /data-col="active"[\s\S]*?data-tone="neutral"[\s\S]*?Đã lưu trữ/)
  assert.doesNotMatch(html, /id="journal-create-form"|data-ui="form-page"|mail\.chatter/)
})

test('journal create FormPage keeps validation values and the bundled default-account control', () => {
  const html = renderToString(
    journalFormScreen(translate, {
      frame: {},
      action: '/admin/accounting/journals/new?lang=vi&returnTo=%2Fadmin%2Faccounting%2Fjournals',
      cancelHref: '/admin/accounting/journals?lang=vi',
      errors: ['Mã không hợp lệ'],
      fields: [
        { name: 'name', label: 'Tên', value: 'Ngân hàng HTTP', required: true },
        { name: 'code', label: 'Mã', value: 'BAD CODE', error: 'Mã không hợp lệ', required: true },
        {
          name: 'type',
          label: 'Loại',
          type: 'select',
          value: 'bank',
          options: [{ value: 'bank', label: 'Ngân hàng' }],
        },
        {
          name: 'defaultAccountId',
          label: 'Tài khoản mặc định',
          control: <div data-island="backend.relation-select" data-selected="cash" />,
        },
        { name: 'active', label: 'Hoạt động', type: 'checkbox', value: true },
      ],
    }),
  )

  assert.match(html, /data-ui="form-page" data-scope="account-journal-form-page" data-has-aside="false"/)
  assert.match(html, /id="journal-create-form"/)
  assert.match(html, /name="name"[^>]*value="Ngân hàng HTTP"/)
  assert.match(html, /name="code"[^>]*value="BAD CODE"[^>]*aria-invalid="true"/)
  assert.match(html, /name="type"[\s\S]*?value="bank"[^>]*selected/)
  assert.match(html, /data-island="backend\.relation-select"[^>]*data-selected="cash"/)
  assert.match(html, /form="journal-create-form"[\s\S]*?Tạo/)
  assert.doesNotMatch(html, /data-ui="list-page"|mail\.chatter|data-ui="form-page-aside"/)
})

test('journal edit FormPage keeps identity, archive state and save semantics', () => {
  const html = renderToString(
    journalFormScreen(translate, {
      frame: {},
      action: '/admin/accounting/journals/new?lang=vi&returnTo=%2Fadmin%2Faccounting%2Fjournals&edit=bank',
      cancelHref: '/admin/accounting/journals?lang=vi',
      editing: { id: 'bank', code: 'BNK', name: 'Ngân hàng', type: 'bank', active: false },
      fields: [
        { name: 'name', label: 'Tên', value: 'Ngân hàng', required: true },
        { name: 'code', label: 'Mã', value: 'BNK', required: true },
      ],
    }),
  )

  assert.match(html, /Sửa sổ nhật ký/)
  assert.match(html, /BNK · Ngân hàng/)
  assert.match(html, /data-ui="form-page-status"[\s\S]*?data-tone="neutral"[\s\S]*?Đã lưu trữ/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?form="journal-create-form"[\s\S]*?Lưu/)
  assert.doesNotMatch(html, /mail\.chatter/)
})
