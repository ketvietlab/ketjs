import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { partnerFormScreen } from '../packages/ketsuite/src/modules/partner_backend/screens/form.tsx'
import { newPartnerScreen } from '../packages/ketsuite/src/modules/partner_backend/screens/new.tsx'

const messages: Record<string, string> = {
  'partner_backend.action.call': 'Gọi điện',
  'partner_backend.action.cancel': 'Hủy',
  'partner_backend.action.create': 'Tạo đối tác',
  'partner_backend.action.email': 'Gửi email',
  'partner_backend.action.more': 'Thêm thao tác',
  'partner_backend.action.save': 'Lưu thông tin',
  'partner_backend.action.saveAddress': 'Lưu địa chỉ',
  'partner_backend.action.saveRoles': 'Lưu vai trò',
  'partner_backend.action.saveTerms': 'Lưu điều khoản',
  'partner_backend.addresses.hint': 'Mỗi mục đích chỉ có một địa chỉ mặc định.',
  'partner_backend.addresses.title': 'Địa chỉ',
  'partner_backend.create.actions': 'Thao tác tạo đối tác',
  'partner_backend.create.subtitle': 'Tạo hồ sơ đối tác và thông tin liên hệ.',
  'partner_backend.create.title': 'Tạo đối tác',
  'partner_backend.detail.actions': 'Thao tác đối tác',
  'partner_backend.detail.identity': 'Thông tin chính',
  'partner_backend.detail.identityHint': 'Thông tin nhận diện, phân loại và liên hệ của đối tác.',
  'partner_backend.collaboration.label': 'Trao đổi và hoạt động của đối tác',
  'partner_backend.field.email': 'Email',
  'partner_backend.field.kind': 'Loại',
  'partner_backend.field.lang': 'Ngôn ngữ',
  'partner_backend.field.name': 'Tên',
  'partner_backend.field.parent': 'Tổ chức cha',
  'partner_backend.field.phone': 'Điện thoại',
  'partner_backend.field.ref': 'Mã đối tác',
  'partner_backend.field.state': 'Trạng thái',
  'partner_backend.field.vat': 'Mã số thuế',
  'partner_backend.menu.directory': 'Danh bạ',
  'partner_backend.roles.hint': 'Một đối tác có thể giữ nhiều vai trò.',
  'partner_backend.roles.title': 'Vai trò nghiệp vụ',
  'partner_backend.state.active': 'Đang hoạt động',
  'partner_backend.state.archived': 'Đã lưu trữ',
  'partner_backend.terms.creditLimit': 'Hạn mức tín dụng',
  'partner_backend.terms.hint': 'Điều khoản áp dụng cho công ty đang hoạt động.',
  'partner_backend.terms.note': 'Ghi chú',
  'partner_backend.terms.title': 'Điều khoản theo công ty',
  'partner.kind.company': 'Công ty',
  'partner.kind.person': 'Cá nhân',
  'partner.role.customer': 'Khách hàng',
  'partner.role.employee': 'Nhân viên',
  'partner.role.supplier': 'Nhà cung cấp',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('partner create: uses the lightweight FormPage header and external primary action', () => {
  const html = renderToString(newPartnerScreen(translate, [], {}, undefined, '?lang=vi'))

  assert.equal(html.match(/data-ui="form-page"/g)?.length, 1)
  assert.match(html, /data-ui="form-page-title"[^>]*>[\s\S]*?Tạo đối tác/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?type="submit"[^>]*form="partner-create-form"/)
  assert.match(html, /id="partner-create-form"/)
  assert.match(html, /data-scope="partner-create"/)
  assert.match(html, /data-kind="checkbox-group"[\s\S]*?Vai trò nghiệp vụ/)
  assert.match(html, /data-kind="radio"/)
  assert.match(html, /name="customer"[\s\S]*?name="supplier"[\s\S]*?name="employee"[\s\S]*?name="name"/)
  assert.match(html, /name="email"[^>]*type="email"|type="email"[^>]*name="email"/)
  assert.match(html, /name="phone"[^>]*type="tel"|type="tel"[^>]*name="phone"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"/)
  assert.doesNotMatch(html, /data-ui="record-thumbnail"|data-ui="record-kicker"/)
  assert.doesNotMatch(html, /data-ui="form-page-back"/)
  assert.match(html, /data-ui="form-page-context"[\s\S]*?data-ui="breadcrumbs"/)
  assert.doesNotMatch(html, /data-ui="form-page-aside"/)
})

test('partner edit: connects Chatter in the rail and keeps save beside the compact title', () => {
  const html = renderToString(
    partnerFormScreen(
      translate,
      {
        id: 'acme',
        kind: 'company',
        name: 'ACME Distribution',
        ref: 'SUP-001',
        vat: '0312345678',
        email: 'hello@acme.example',
        phone: '0909000001',
        lang: 'vi',
        active: true,
        parentId: null,
        roles: [{ role: 'customer' }, { role: 'supplier' }],
        addresses: [],
      },
      {
        parents: [],
        collaboration: <div data-ui="partner-chatter-fixture">Chatter</div>,
        addressForms: [{ title: 'Thêm địa chỉ', body: 'Address fields' }],
      },
      {},
      '?lang=vi',
    ),
  )

  assert.match(html, /data-ui="form-page" data-has-aside="true"/)
  assert.match(html, /data-ui="form-page-title"[^>]*>[\s\S]*?ACME Distribution/)
  assert.match(html, /data-ui="form-page-status"[\s\S]*?Đang hoạt động/)
  assert.match(html, /data-ui="form-page-actions"[\s\S]*?type="submit"[^>]*form="partner-identity-form"/)
  assert.match(html, /id="partner-identity-form"/)
  assert.match(html, /data-scope="partner-identity"/)
  assert.match(html, /data-kind="checkbox-group"[\s\S]*?Vai trò nghiệp vụ/)
  assert.match(html, /name="customer"[^>]*checked/)
  assert.match(html, /name="supplier"[^>]*checked/)
  assert.match(html, /name="employee"[\s\S]*?name="name"/)
  assert.doesNotMatch(html, /action="[^"]*\/roles/)
  assert.match(html, /data-ui="form-page-aside"[^>]*aria-label="Trao đổi và hoạt động của đối tác"/)
  assert.match(html, /data-ui="partner-chatter-fixture"[^>]*>[\s\S]*?Chatter/)
  assert.match(html, /data-ui="record-more-open"[^>]*aria-label="Thêm thao tác"/)
  assert.match(html, /data-ui="record-more-menu"[\s\S]*?mailto:hello@acme\.example/)
  assert.doesNotMatch(html, /Thông tin nhanh/)
  assert.doesNotMatch(html, /data-ui="record-workspace"/)
  assert.doesNotMatch(html, /data-ui="record-thumbnail"|data-ui="record-kicker"/)
  assert.doesNotMatch(html, /data-ui="form-page-back"/)
  assert.match(html, /data-ui="form-page-context"[\s\S]*?data-ui="breadcrumbs"/)
})
