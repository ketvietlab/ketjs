import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { accountFormScreen } from '../packages/ketsuite/src/modules/account_backend/screens/account-form.tsx'
import { accountsListScreen } from '../packages/ketsuite/src/modules/account_backend/screens/accounts-list.tsx'

const messages: Record<string, string> = {
  'account_backend.account.create.hint': 'Thêm tài khoản dùng cho doanh nghiệp.',
  'account_backend.account.create.title': 'Tạo tài khoản',
  'account_backend.account.edit.title': 'Sửa tài khoản',
  'account_backend.account.empty': 'Chưa có tài khoản.',
  'account_backend.account.emptyHint': 'Tạo tài khoản đầu tiên.',
  'account_backend.account.subtitle': 'Quản lý hệ thống mã và loại tài khoản.',
  'account_backend.account.summary.asset': 'Tài sản',
  'account_backend.account.summary.liability': 'Nợ và vốn',
  'account_backend.account.summary.profit': 'Kết quả kinh doanh',
  'account_backend.account.summary.total': 'Tổng tài khoản',
  'account_backend.accounts.title': 'Hệ thống tài khoản',
  'account_backend.action.cancelEdit': 'Huỷ',
  'account_backend.action.create': 'Tạo',
  'account_backend.action.save': 'Lưu',
  'account_backend.active': 'Đang dùng',
  'account_backend.archived': 'Đã lưu trữ',
  'account_backend.field.accountType': 'Loại tài khoản',
  'account_backend.field.active': 'Hoạt động',
  'account_backend.field.code': 'Mã',
  'account_backend.field.name': 'Tên',
  'account_backend.field.reconcile': 'Cho phép đối soát',
  'account_backend.no': 'Không',
  'account_backend.yes': 'Có',
  'account_backend.accountType.asset_cash': 'Tiền',
  'account_backend.accountType.liability_payable': 'Phải trả',
  'backend.chrome.next': 'Trang sau',
  'backend.chrome.previous': 'Trang trước',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('chart of accounts list keeps command controls, grouping, paging, summaries and business columns', () => {
  const rows = [
    {
      id: 'cash',
      code: '111',
      name: 'Tiền mặt',
      accountType: 'asset_cash',
      reconcile: false,
      active: true,
    },
  ]
  const html = renderToString(
    accountsListScreen(translate, {
      frame: {
        chrome: {
          search: {
            name: 'q',
            value: '111',
            placeholder: 'Hệ thống tài khoản',
            facets: [{ label: 'Tài sản', without: '/admin/accounting/accounts?lang=vi' }],
            menus: [
              {
                id: 'filters',
                label: 'Bộ lọc',
                items: [
                  {
                    id: 'active',
                    label: 'Đang dùng',
                    path: '/admin/accounting/accounts?status=active&lang=vi',
                    active: true,
                  },
                ],
              },
            ],
          },
          pager: {
            from: 31,
            to: 31,
            total: 216,
            prev: '/admin/accounting/accounts?page=1&lang=vi',
            next: '/admin/accounting/accounts?page=3&lang=vi',
          },
        },
      },
      rows,
      createHref: '/admin/accounting/accounts/new?lang=vi&returnTo=%2Fadmin%2Faccounting%2Faccounts',
      rowHref: (row) =>
        `/admin/accounting/accounts/new?lang=vi&returnTo=%2Fadmin%2Faccounting%2Faccounts&edit=${String(row.id)}`,
      summary: { total: 216, asset: 80, liability: 60, profit: 76 },
      table: {
        groups: [
          {
            id: 'type:asset_cash',
            label: 'Tiền',
            count: 1,
            depth: 0,
            open: true,
            href: '/admin/accounting/accounts?lang=vi',
            rows,
          },
        ],
      },
    }),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /href="\/admin\/accounting\/accounts\/new\?lang=vi&amp;returnTo=/)
  assert.match(html, /data-ui="chrome-search"[\s\S]*?name="q"[\s\S]*?value="111"/)
  assert.match(html, /data-ui="facet"[\s\S]*?Tài sản/)
  assert.match(html, /data-ui="pager-range"[^>]*>[\s\S]*?31-31 \/ 216/)
  assert.match(html, /Tổng tài khoản: 216[\s\S]*?Tài sản: 80[\s\S]*?Nợ và vốn: 60/)
  assert.match(html, /data-ui="group-row"[\s\S]*?data-ui="group-count"[\s\S]*?1/)
  assert.match(
    html,
    /data-row-href="\/admin\/accounting\/accounts\/new\?lang=vi&amp;returnTo=.*&amp;edit=cash"/,
  )
  assert.match(html, /data-col="code"[\s\S]*?111/)
  assert.match(html, /data-col="name"[\s\S]*?Tiền mặt/)
  assert.match(html, /data-col="type"[\s\S]*?Tiền/)
  assert.match(html, /data-col="active"[\s\S]*?data-tone="positive"[\s\S]*?Đang dùng/)
  assert.doesNotMatch(html, /id="account-create-form"|data-ui="form-page"|mail\.chatter/)
})

test('account create FormPage keeps validation values, all fields, locale returnTo and no chatter', () => {
  const html = renderToString(
    accountFormScreen(translate, {
      frame: {},
      action: '/admin/accounting/accounts/new?lang=vi&returnTo=%2Fadmin%2Faccounting%2Faccounts',
      cancelHref: '/admin/accounting/accounts?lang=vi',
      errors: ['Mã tài khoản đã tồn tại'],
      fields: [
        { name: 'code', label: 'Mã', value: '111', error: 'Mã tài khoản đã tồn tại', required: true },
        { name: 'name', label: 'Tên', value: 'Tiền mặt mới', required: true },
        {
          name: 'accountType',
          label: 'Loại tài khoản',
          type: 'select',
          value: 'asset_cash',
          options: [{ value: 'asset_cash', label: 'Tiền' }],
        },
        { name: 'reconcile', label: 'Cho phép đối soát', type: 'checkbox', value: true },
        { name: 'active', label: 'Hoạt động', type: 'checkbox', value: true },
      ],
    }),
  )

  assert.match(html, /data-ui="form-page" data-scope="account-chart-form-page" data-has-aside="false"/)
  assert.match(html, /id="account-create-form"/)
  assert.match(html, /action="\/admin\/accounting\/accounts\/new\?lang=vi&amp;returnTo=/)
  assert.match(html, /href="\/admin\/accounting\/accounts\?lang=vi"/)
  assert.match(html, /name="code"[^>]*value="111"[^>]*aria-invalid="true"/)
  assert.match(html, /Mã tài khoản đã tồn tại/)
  assert.match(html, /name="name"[^>]*value="Tiền mặt mới"/)
  assert.match(html, /name="accountType"[\s\S]*?value="asset_cash"[^>]*selected/)
  assert.match(html, /name="reconcile"[^>]*checked/)
  assert.match(html, /name="active"[^>]*checked/)
  assert.doesNotMatch(html, /data-ui="list-page"|mail\.chatter|data-ui="form-page-aside"/)
})

test('account edit FormPage keeps localized identity, archive state and save semantics', () => {
  const html = renderToString(
    accountFormScreen(translate, {
      frame: {},
      action: '/admin/accounting/accounts/new?lang=en&returnTo=%2Fadmin%2Faccounting%2Faccounts&edit=cash',
      cancelHref: '/admin/accounting/accounts?lang=en',
      editing: { id: 'cash', code: '111', name: 'Cash', accountType: 'asset_cash', active: false },
      fields: [
        { name: 'code', label: 'Code', value: '111', required: true },
        { name: 'name', label: 'Name', value: 'Cash', required: true },
      ],
    }),
  )

  assert.match(html, /Sửa tài khoản/)
  assert.match(html, /111 · Cash/)
  assert.match(html, /data-ui="form-page-status"[\s\S]*?data-tone="neutral"[\s\S]*?Đã lưu trữ/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?form="account-create-form"[\s\S]*?Lưu/)
  assert.match(html, /name="code"[^>]*value="111"/)
  assert.doesNotMatch(html, /mail\.chatter/)
})
