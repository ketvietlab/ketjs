import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { accountingTermsScreen } from '../packages/ketsuite/src/modules/account_partner_backend/screens/accounting-terms.tsx'

const messages: Record<string, string> = {
  'account_partner_backend.action.back': 'Quay lại đối tác',
  'account_partner_backend.action.save': 'Lưu thiết lập',
  'account_partner_backend.field.payable': 'Tài khoản phải trả',
  'account_partner_backend.field.paymentTerm': 'Điều khoản thanh toán',
  'account_partner_backend.field.receivable': 'Tài khoản phải thu',
  'account_partner_backend.screen.title': 'Kế toán · {name}',
  'account_partner_backend.section.hint': 'Các lựa chọn chỉ áp dụng cho công ty đang hoạt động.',
  'account_partner_backend.section.title': 'Điều khoản và tài khoản công nợ',
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

test('partner accounting terms: FormPage keeps defaults, errors and locale-aware actions without Chatter', () => {
  const html = renderToString(
    accountingTermsScreen(
      translate,
      { id: 'customer', name: 'Công ty Minh An' },
      {
        paymentTermId: 'net30',
        receivableAccountId: 'receivable',
        payableAccountId: 'payable',
      },
      {
        paymentTerms: [{ value: 'net30', label: '30 ngày' }],
        receivable: [{ value: 'receivable', label: '131 · Phải thu khách hàng' }],
        payable: [{ value: 'payable', label: '331 · Phải trả nhà cung cấp' }],
      },
      {},
      '/admin/partner/partners/customer/accounting?lang=vi',
      '/admin/partner/partners/customer?lang=vi',
      ['receivableAccountId: Loại tài khoản không phù hợp với mục đích công nợ.'],
    ),
  )

  assert.match(
    html,
    /data-ui="form-page" data-scope="partner-accounting-terms-form-page" data-has-aside="false"/,
  )
  assert.match(html, /data-ui="form-page-title"[\s\S]*?Kế toán · Công ty Minh An/)
  assert.match(html, /Các lựa chọn chỉ áp dụng cho công ty đang hoạt động\./)
  assert.match(html, /data-ui="section-title"[\s\S]*?Điều khoản và tài khoản công nợ/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?type="submit" form="partner-accounting-terms-form"/)
  assert.match(html, /href="\/admin\/partner\/partners\/customer\?lang=vi"[\s\S]*?Quay lại đối tác/)
  assert.match(html, /id="partner-accounting-terms-form"/)
  assert.match(html, /action="\/admin\/partner\/partners\/customer\/accounting\?lang=vi"/)
  assert.match(html, /name="paymentTermId"[\s\S]*?<option value="">[\s\S]*?—/)
  assert.match(html, /<option value="net30" selected="true">[\s\S]*?30 ngày/)
  assert.match(html, /<option value="receivable" selected="true">[\s\S]*?131 · Phải thu khách hàng/)
  assert.match(html, /<option value="payable" selected="true">[\s\S]*?331 · Phải trả nhà cung cấp/)
  assert.match(html, /receivableAccountId: Loại tài khoản không phù hợp với mục đích công nợ\./)
  assert.doesNotMatch(html, /id="partner-accounting-terms-form"[\s\S]*?data-ui="form-actions"/)
  assert.doesNotMatch(html, /form-page-aside|mail\.chatter|activity\.record|record-workspace/)
})

test('partner accounting terms: empty defaults retain explicit unset options', () => {
  const html = renderToString(
    accountingTermsScreen(
      translate,
      { id: 'vendor', name: 'Nhà cung cấp An Phú' },
      null,
      {
        paymentTerms: [{ value: 'net30', label: '30 ngày' }],
        receivable: [{ value: 'receivable', label: '131 · Phải thu khách hàng' }],
        payable: [{ value: 'payable', label: '331 · Phải trả nhà cung cấp' }],
      },
      {},
      '/admin/partner/partners/vendor/accounting',
      '/admin/partner/partners/vendor',
    ),
  )

  assert.equal(html.match(/<option value=""/g)?.length, 3)
  assert.equal(html.match(/<option value="" selected="true">/g)?.length, 3)
  assert.doesNotMatch(html, /<option value="(?:net30|receivable|payable)" selected="true">/)
  assert.doesNotMatch(html, /form-errors|form-page-aside|mail\.chatter/)
})
