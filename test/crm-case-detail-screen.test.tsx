import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { html, renderToString } from '@ketvietlab/ketjs-view'
import {
  caseDetailScreen,
  permissionScreen,
} from '../packages/ketsuite/src/modules/crm_backend/screens/case-detail.tsx'

const messages: Record<string, string> = {
  'crm_backend.case.detail': 'Chi tiết cơ hội',
  'crm_backend.case.tab.overview': 'Tổng quan',
  'crm_backend.case.tab.sales': 'Bán hàng',
  'crm_backend.case.tab.activities': 'Hoạt động',
  'crm_backend.case.tab.timeline': 'Dòng thời gian',
  'crm_backend.action.save': 'Lưu',
  'crm_backend.action.move': 'Chuyển giai đoạn',
  'crm_backend.action.refreshScore': 'Tính lại điểm',
  'crm_backend.action.won': 'Đánh dấu thắng',
  'crm_backend.action.lost': 'Đánh dấu thua',
  'crm_backend.assign.title': 'Phân công',
  'crm_backend.assign.hint': 'Chọn đội và người phụ trách.',
  'crm_backend.assign.submit': 'Phân công',
  'crm_backend.merge.title': 'Gộp hồ sơ',
  'crm_backend.merge.hint': 'Gộp một hồ sơ trùng vào hồ sơ này.',
  'crm_backend.merge.source': 'Hồ sơ nguồn',
  'crm_backend.merge.submit': 'Gộp',
  'crm_backend.field.name': 'Tên',
  'crm_backend.field.kind': 'Loại',
  'crm_backend.field.stage': 'Giai đoạn',
  'crm_backend.field.partner': 'Đối tác',
  'crm_backend.field.assignee': 'Người phụ trách',
  'crm_backend.field.team': 'Đội',
  'crm_backend.field.priority': 'Ưu tiên',
  'crm_backend.field.tags': 'Thẻ',
  'crm_backend.field.expectedRevenue': 'Doanh thu kỳ vọng',
  'crm_backend.field.score': 'Điểm',
  'crm_backend.field.version': 'Phiên bản',
  'crm_backend.field.lostReason': 'Lý do thua',
  'crm_backend.timeline.at': 'Thời điểm',
  'crm_backend.timeline.event': 'Sự kiện',
  'crm.timeline.created': 'Hồ sơ đã được tạo',
  'crm.timeline.created.label': 'Đã tạo',
  'crm.kind.opportunity': 'Cơ hội',
  'crm.terminal.open': 'Đang mở',
  'crm_backend.priority.2': 'Cao',
  'crm_backend.attachments.title': 'Tệp đính kèm',
  'crm_backend.attachments.empty': 'Chưa có tệp',
  'crm_backend.attachments.emptyHint': 'Tải tệp liên quan lên.',
  'crm_backend.attachments.choose': 'Chọn tệp',
  'crm_backend.attachments.upload': 'Tải lên',
  'crm_backend.messages.title': 'Trao đổi',
  'crm_backend.field.message': 'Tin nhắn',
  'crm_backend.action.addNote': 'Thêm ghi chú',
  'crm_backend.permission.title': 'Không thể mở hồ sơ',
  'crm_backend.permission.hint': 'Hồ sơ không tồn tại hoặc bạn không có quyền.',
  'backend.table.columns': 'Cột',
  'backend.table.selectAll': 'Chọn tất cả',
  'backend.table.selectRow': 'Chọn dòng',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

const row = {
  id: 'case-denim',
  name: 'Cơ hội Denim Việt',
  kind: 'opportunity',
  terminalState: 'open',
  version: 7,
  priority: '2',
  stageId: 'proposal',
  stageName: 'Đề xuất',
  partnerName: 'Denim Việt',
  assigneeName: 'Minh',
  teamName: 'Miền Bắc',
  currency: 'VND',
  score: 82,
  salesDetail: { expectedRevenue: 125000000 },
  timeline: [
    {
      id: 'event-created',
      body: 'crm.timeline.created',
      eventType: 'created',
      occurredAt: '2026-08-27T09:30:00.000Z',
    },
  ],
  messages: [{ id: 'note-1', body: 'Gọi lại ngày mai', createdAt: '2026-08-27T10:00:00.000Z' }],
  attachments: [{ id: 'file-1', name: 'brief.pdf', size: 2048, mimetype: 'application/pdf' }],
  activities: [],
  meetings: [],
  tags: [{ id: 'tag-1', name: 'Trọng điểm' }],
}

const options = {
  fields: [{ name: 'name', label: 'Tên', value: row.name, required: true, span: 'full' as const }],
  stages: [],
  users: [],
  teams: [],
  warehouses: [],
  plans: [],
  activityTypes: [],
  duplicates: [],
  locale: '?lang=vi',
  controls: {
    stage: html`<ket-island data-island="relation.select" data-field="stageId"></ket-island>`,
    mergeSource: html`<ket-island data-island="relation.select" data-field="sourceId"></ket-island>`,
    assignTeam: html`<ket-island data-island="relation.select" data-field="teamId"></ket-island>`,
    assignUser: html`<ket-island data-island="relation.select" data-field="assigneeUserId"></ket-island>`,
  },
}

test('crm case detail: remains a specialized record workspace with all business controls', () => {
  const rendered = renderToString(caseDetailScreen(translate, {}, row, options))

  assert.match(rendered, /data-ui="record-workspace"/)
  assert.doesNotMatch(rendered, /data-ui="form-page"/)
  assert.match(rendered, /Cơ hội Denim Việt/)
  assert.match(rendered, /Denim Việt · Đề xuất/)
  assert.match(rendered, /Đang mở/)
  assert.equal(rendered.match(/data-ui="record-fact"/g)?.length, 4)
  assert.match(rendered, /name="action" value="save"/)
  assert.match(rendered, /name="action" value="move"/)
  assert.match(rendered, /name="action" value="assign"/)
  assert.match(rendered, /name="action" value="merge"/)
  assert.match(rendered, /name="action" value="lost"/)
  assert.match(rendered, /name="lostReason"/)
  assert.match(rendered, /name="action" value="won"/)
  assert.match(rendered, /data-ui="attachments"/)
  assert.match(rendered, /brief\.pdf/)
  assert.match(rendered, /Gọi lại ngày mai/)
  assert.match(rendered, /action="\/admin\/crm\/cases\/case-denim\?lang=vi"/)
  assert.match(rendered, /action="\/admin\/crm\/cases\/case-denim\/attachments\?lang=vi"/)
  assert.match(rendered, /href="\/admin\/crm\/cases\/case-denim\?tab=timeline&amp;lang=vi"/)
})

test('crm case detail: timeline resolves system message keys and keeps the selected tab', () => {
  const rendered = renderToString(caseDetailScreen(translate, {}, row, { ...options, tab: 'timeline' }))

  assert.match(rendered, /Hồ sơ đã được tạo/)
  assert.doesNotMatch(rendered.replace(/<[^>]*>/g, ' '), /crm\.timeline\./)
  assert.match(
    rendered,
    /data-active="true"[^>]*href="\/admin\/crm\/cases\/case-denim\?tab=timeline&amp;lang=vi"/,
  )
})

test('crm case detail: permission fallback keeps the framed empty-state semantics', () => {
  const rendered = renderToString(permissionScreen(translate, {}))

  assert.match(rendered, /Không thể mở hồ sơ/)
  assert.match(rendered, /data-ui="empty"/)
  assert.match(rendered, /Hồ sơ không tồn tại hoặc bạn không có quyền/)
})
