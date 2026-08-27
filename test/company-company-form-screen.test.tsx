import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { companyFormScreen } from '../packages/ketsuite/src/modules/company_backend/screens/index.ts'

const messages: Record<string, string> = {
  'company_backend.action.actions': 'Thao tác công ty',
  'company_backend.action.addBranch': 'Thêm chi nhánh',
  'company_backend.action.archive': 'Lưu trữ công ty',
  'company_backend.action.cancel': 'Hủy',
  'company_backend.action.manageAddress': 'Quản lý địa chỉ pháp lý',
  'company_backend.action.more': 'Thêm',
  'company_backend.action.restore': 'Khôi phục công ty',
  'company_backend.action.save': 'Lưu',
  'company_backend.branch.operational': 'Vận hành',
  'company_backend.branch.root': 'Gốc / mặc định',
  'company_backend.branches.empty': 'Chưa có chi nhánh',
  'company_backend.branches.emptyHint': 'Root branch luôn tồn tại.',
  'company_backend.branches.hint': 'Các chi nhánh vận hành.',
  'company_backend.branches.title': 'Chi nhánh vận hành',
  'company_backend.collaboration.label': 'Thảo luận',
  'company_backend.create.title': 'Tạo công ty',
  'company_backend.detail.identity': 'Thông tin pháp nhân',
  'company_backend.detail.identityHint': 'Thông tin pháp nhân và đối tác đại diện.',
  'company_backend.field.code': 'Mã',
  'company_backend.field.currency': 'Tiền tệ',
  'company_backend.field.kind': 'Loại',
  'company_backend.field.name': 'Tên',
  'company_backend.field.parent': 'Công ty mẹ',
  'company_backend.field.partner': 'Đối tác đại diện',
  'company_backend.field.state': 'Trạng thái',
  'company_backend.option.noParent': 'Không có công ty mẹ',
  'company_backend.option.selectPartner': 'Chọn đối tác công ty…',
  'company_backend.state.active': 'Đang hoạt động',
  'company_backend.state.archived': 'Đã lưu trữ',
}
const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('company create is a full FormPage with stable identity and no premature chatter', () => {
  const html = renderToString(
    companyFormScreen(
      translate,
      { id: '2e71eaf2-8404-4c31-83f6-78f300611250', currency: 'VND' },
      {
        mode: 'create',
        action:
          '/admin/companies/new?lang=vi&returnTo=%2Fadmin%2Fcompanies%3Fq%3DKET%26lang%3Dvi',
        cancelHref: '/admin/companies?q=KET&lang=vi',
        returnTo: '/admin/companies?q=KET&lang=vi',
        partners: [{ value: 'partner-1', label: 'Công ty Két Việt' }],
        parents: [],
      },
    ),
  )

  assert.match(html, /data-ui="form-page" data-scope="company-form-page" data-has-aside="false"/)
  assert.match(html, /id="company-record-form"[^>]*data-layout="default"/)
  assert.match(html, /name="action" value="save"/)
  assert.match(html, /name="id" value="2e71eaf2-8404-4c31-83f6-78f300611250"/)
  assert.match(html, /name="returnTo" value="\/admin\/companies\?q=KET&amp;lang=vi"/)
  assert.equal(html.match(/data-ui="form-field"/g)?.length, 4)
  assert.match(html, /name="partnerId"[\s\S]*?name="code"[\s\S]*?name="currency"[\s\S]*?name="parentId"/)
  assert.doesNotMatch(html, /data-ui="modal-layer"|data-ui="form-page-aside"|mail\.chatter/)
})

test('company detail keeps lifecycle, branches, rejected relations and one-third chatter rail', () => {
  const html = renderToString(
    companyFormScreen(
      translate,
      {
        id: 'company-1',
        code: 'REJECTED',
        name: 'Công ty Két Việt',
        partnerId: 'missing-partner',
        parentId: 'missing-parent',
        currency: 'USD',
        active: true,
        version: 4,
      },
      {
        mode: 'detail',
        action: '/admin/companies/company-1?lang=vi&returnTo=%2Fadmin%2Fcompanies%3Flang%3Dvi',
        archiveAction:
          '/admin/companies/company-1/archive?lang=vi&returnTo=%2Fadmin%2Fcompanies%3Flang%3Dvi',
        cancelHref: '/admin/companies?lang=vi',
        returnTo: '/admin/companies?lang=vi',
        manageAddressHref: '/admin/partner/partners/backing-partner?lang=vi',
        addBranchHref: '/admin/companies/company-1/branches/new?lang=vi',
        branchHref: (branch) => `/admin/companies/company-1/branches/${branch.id}?lang=vi`,
        partners: [{ value: 'partner-2', label: 'Đối tác khác' }],
        parents: [{ value: 'company-2', label: 'Công ty mẹ' }],
        branches: [
          {
            id: 'root:company-1',
            companyId: 'company-1',
            code: 'KET',
            name: 'Công ty Két Việt',
            isRoot: true,
            active: true,
          },
          {
            id: 'branch-north',
            companyId: 'company-1',
            code: 'NORTH',
            name: 'Miền Bắc',
            active: false,
          },
        ],
        errors: ['expectedVersion: Hồ sơ công ty đã thay đổi.'],
        collaboration: <div data-island="mail.chatter">Chatter</div>,
      },
    ),
  )

  assert.match(html, /data-ui="form-page"[^>]*data-has-aside="true"/)
  assert.match(html, /data-ui="form-page-aside"[^>]*aria-label="Thảo luận"/)
  assert.match(html, /data-island="mail.chatter"/)
  assert.match(html, /name="expectedVersion" value="4"/)
  assert.match(html, /name="action" value="archive"/)
  assert.match(html, /<option value="missing-partner" selected="true">/)
  assert.match(html, /<option value="missing-parent" selected="true">/)
  assert.match(html, /name="code"[^>]*value="REJECTED"/)
  assert.match(html, /data-ui="form-errors" role="alert"/)
  assert.match(html, /root:company-1|Công ty Két Việt/)
  assert.match(html, /href="\/admin\/companies\/company-1\/branches\/branch-north\?lang=vi"/)
  assert.match(html, /data-tone="neutral" data-value="archived"/)
  assert.doesNotMatch(html, /data-ui="modal-layer"|data-layout="inline"/)
})
