import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { html, renderToString } from '@ketvietlab/ketjs-view'
import type { FormField } from '../packages/ketsuite/src/ui/index.ts'
import { caseCreateScreen } from '../packages/ketsuite/src/modules/crm_backend/screens/case-create.tsx'
import { casesListScreen } from '../packages/ketsuite/src/modules/crm_backend/screens/cases-list.tsx'

const messages: Record<string, string> = {
  'crm_backend.cases.title': 'Hồ sơ CRM',
  'crm_backend.action.create': 'Tạo hồ sơ',
  'crm_backend.action.cancel': 'Hủy',
  'crm_backend.empty.title': 'Chưa có hồ sơ',
  'crm_backend.empty.hint': 'Tạo lead hoặc cơ hội đầu tiên.',
  'crm_backend.field.name': 'Tên',
  'crm_backend.field.kind': 'Loại',
  'crm_backend.field.partner': 'Đối tác',
  'crm_backend.field.stage': 'Giai đoạn',
  'crm_backend.field.assignee': 'Người phụ trách',
  'crm_backend.field.expectedRevenue': 'Doanh thu kỳ vọng',
  'crm_backend.field.state': 'Trạng thái',
  'crm_backend.field.priority': 'Ưu tiên',
  'crm_backend.field.description': 'Mô tả',
  'crm.kind.opportunity': 'Cơ hội',
  'crm.terminal.open': 'Đang mở',
  'backend.table.columns': 'Cột',
  'backend.table.selectAll': 'Chọn tất cả dòng',
  'backend.table.selectRow': 'Chọn dòng',
  'backend.chrome.more': 'Thêm thao tác',
  'backend.chrome.previous': 'Trang trước',
  'backend.chrome.next': 'Trang sau',
  'backend.chrome.removeFilter': 'Bỏ bộ lọc',
  'backend.chrome.globalFilter': 'Bộ lọc',
  'backend.chrome.apply': 'Áp dụng',
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

test('crm cases list: keeps filtered ListPage chrome, columns and localized row links', () => {
  const rendered = renderToString(
    casesListScreen(
      translate,
      {
        chrome: {
          search: {
            name: 'q',
            value: 'May mặc',
            placeholder: 'Tìm lead, liên hệ…',
            keep: { 'f.teamId': 'north', preset: ['open'], lang: 'vi' },
            facets: [
              {
                label: 'Loại = Cơ hội',
                without: '/admin/crm/cases?q=May%20mặc&lang=vi',
              },
            ],
          },
          pager: { from: 1, to: 1, total: 21, next: '/admin/crm/cases?page=2&lang=vi' },
        },
      },
      {
        createHref:
          '/admin/crm/cases/new?lang=vi&returnTo=%2Fadmin%2Fcrm%2Fcases%3Fq%3DMay%2520m%E1%BA%B7c%26lang%3Dvi',
        locale: '?lang=vi',
        total: 21,
        rows: [
          {
            id: 'case-denim',
            name: 'Cơ hội May mặc Việt',
            kind: 'opportunity',
            partnerName: 'May mặc Việt',
            stageName: 'Đề xuất',
            assigneeName: 'Nguyễn Minh',
            expectedRevenue: 125000000,
            currency: 'VND',
            terminalState: 'open',
          },
        ],
      },
    ),
  )

  assert.equal(rendered.match(/data-ui="list-page-title"/g)?.length, 1)
  assert.doesNotMatch(rendered, /data-ui="topbar"/)
  assert.match(rendered, /data-ui="list-page-actions"[\s\S]*?\/admin\/crm\/cases\/new\?lang=vi/)
  assert.match(rendered, /data-ui="chrome-search-input"[^>]*value="May mặc"/)
  assert.match(rendered, /name="f.teamId"[^>]*value="north"/)
  assert.match(rendered, /name="preset"[^>]*value="open"/)
  assert.match(rendered, /Hồ sơ CRM: 21/)
  assert.match(rendered, /data-col="name"[\s\S]*?Cơ hội May mặc Việt/)
  assert.match(rendered, /data-col="kind"[\s\S]*?Cơ hội/)
  assert.match(rendered, /data-col="partner"[\s\S]*?May mặc Việt/)
  assert.match(rendered, /data-col="stage"[\s\S]*?Đề xuất/)
  assert.match(rendered, /data-col="assignee"[\s\S]*?Nguyễn Minh/)
  assert.match(rendered, /data-col="revenue"/)
  assert.match(rendered, /data-col="state"[\s\S]*?Đang mở/)
  assert.match(rendered, /href="\/admin\/crm\/cases\/case-denim\?lang=vi"/)
  assert.doesNotMatch(rendered, /crm-case-create-form|data-ui="chatter"/)
})

test('crm cases list: hides create without permission and keeps the empty state', () => {
  const rendered = renderToString(casesListScreen(translate, {}, { rows: [], total: 0 }))

  assert.match(rendered, /data-ui="empty"/)
  assert.match(rendered, /Chưa có hồ sơ/)
  assert.doesNotMatch(rendered, /\/admin\/crm\/cases\/new/)
})

test('crm case create: preserves route-owned fields, islands, validation and return state', () => {
  const relation = html`<ket-island data-island="relation.select" data-field="partnerId"></ket-island>`
  const fields: FormField[] = [
    { name: 'name', label: 'Tên', required: true, span: 'full' },
    {
      name: 'kind',
      label: 'Loại',
      type: 'select',
      value: 'opportunity',
      required: true,
      options: [
        { value: 'lead', label: 'Lead' },
        { value: 'opportunity', label: 'Cơ hội' },
      ],
    },
    { name: 'stageId', label: 'Giai đoạn', control: relation },
    { name: 'partnerId', label: 'Đối tác', control: relation },
    { name: 'contactName', label: 'Liên hệ' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Điện thoại', type: 'tel' },
    { name: 'teamId', label: 'Đội', control: relation },
    { name: 'assigneeUserId', label: 'Người phụ trách', control: relation },
    {
      name: 'priority',
      label: 'Ưu tiên',
      type: 'select',
      value: '1',
      options: [{ value: '1', label: 'Bình thường' }],
    },
    { name: 'tagIds', label: 'Thẻ', control: relation, span: 'full' },
    { name: 'expectedRevenue', label: 'Doanh thu kỳ vọng', type: 'decimal', value: '0' },
    { name: 'probability', label: 'Xác suất', type: 'decimal', value: '0' },
    { name: 'expectedClosing', label: 'Ngày dự kiến', type: 'date' },
    { name: 'description', label: 'Mô tả', type: 'textarea', span: 'full' },
  ]
  const returnTo = '/admin/crm/pipeline?teamId=north&mine=1&lang=vi'
  const rendered = renderToString(
    caseCreateScreen(
      translate,
      {},
      {
        fields,
        action: '/admin/crm/cases/new?lang=vi',
        cancelHref: returnTo,
        returnTo,
        errors: ['Giai đoạn không nhận loại hồ sơ này'],
      },
    ),
  )

  assert.equal(rendered.match(/data-ui="form-page"/g)?.length, 1)
  assert.match(rendered, /data-ui="form-page-actions"[\s\S]*?form="crm-case-create-form"/)
  assert.match(rendered, /action="\/admin\/crm\/cases\/new\?lang=vi"/)
  assert.match(rendered, /href="\/admin\/crm\/pipeline\?teamId=north&amp;mine=1&amp;lang=vi"/)
  assert.match(
    rendered,
    /name="returnTo"[^>]*value="\/admin\/crm\/pipeline\?teamId=north&amp;mine=1&amp;lang=vi"/,
  )
  assert.match(rendered, /name="name"[^>]*required/)
  assert.match(rendered, /name="kind"[\s\S]*?value="opportunity"[^>]*selected/)
  assert.match(rendered, /data-island="relation.select"/)
  assert.match(rendered, /name="priority"[\s\S]*?value="1"[^>]*selected/)
  assert.match(rendered, /name="expectedRevenue"[^>]*value="0"/)
  assert.match(rendered, /name="probability"[^>]*value="0"/)
  assert.match(rendered, /data-ui="form-errors"[\s\S]*?Giai đoạn không nhận loại hồ sơ này/)
  assert.doesNotMatch(rendered, /data-ui="form-actions"|data-ui="chatter"|data-ui="form-page-aside"/)
})
