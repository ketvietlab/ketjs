import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { html, renderToString } from '@ketvietlab/ketjs-view'
import { plannerScreen } from '../packages/ketsuite/src/modules/crm_backend/screens/activity-planner.tsx'

const messages: Record<string, string> = {
  'crm_backend.planner.title': 'Kế hoạch hoạt động',
  'crm_backend.planner.mine': 'Việc của tôi',
  'crm_backend.planner.plans': 'Kế hoạch',
  'crm_backend.planner.calendar': 'Lịch',
  'crm_backend.planner.target': 'Hồ sơ',
  'crm_backend.field.name': 'Tên',
  'crm_backend.field.dueAt': 'Hạn',
  'crm_backend.field.state': 'Trạng thái',
  'crm_backend.field.actions': 'Thao tác',
  'crm_backend.field.assignee': 'Người phụ trách',
  'crm_backend.activity.type': 'Loại hoạt động',
  'crm_backend.activity.schedule': 'Lên lịch',
  'crm_backend.activity.complete': 'Hoàn tất',
  'crm_backend.activity.cancel': 'Hủy',
  'crm_backend.activity.today': 'Hôm nay',
  'crm_backend.action.cancelEdit': 'Đóng',
  'crm_backend.error.title': 'Không thể lưu thay đổi',
  'crm_backend.empty.title': 'Chưa có hoạt động',
  'crm_backend.empty.hint': 'Hoạt động mới sẽ xuất hiện tại đây.',
  'backend.table.columns': 'Cột',
  'backend.table.selectAll': 'Chọn tất cả',
  'backend.table.selectRow': 'Chọn dòng',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('crm activity planner: keeps specialized planning chrome, controls, actions and locale', () => {
  const rendered = renderToString(
    plannerScreen(
      translate,
      {},
      {
        tab: 'mine',
        activities: [
          {
            id: 'activity-call',
            summary: 'Gọi lại khách hàng',
            dueDate: '2026-08-27',
            state: 'today',
            caseId: 'case-denim',
            caseName: 'Cơ hội Denim Việt',
          },
        ],
        plans: [],
        events: [],
        activityTypes: [{ id: 'call', name: 'Cuộc gọi' }],
        locale: '?lang=vi',
        errors: ['Ngày hoàn thành không hợp lệ'],
        failedAction: 'schedule',
        scheduling: true,
        controls: {
          caseId: html`<ket-island data-island="relation.select" data-field="caseId"></ket-island>`,
          assignee: html`<ket-island data-island="relation.select" data-field="assigneeUserId"></ket-island>`,
        },
      },
    ),
  )

  assert.match(rendered, /data-ui="list-page"/)
  assert.match(rendered, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(rendered, /Kế hoạch hoạt động/)
  assert.match(rendered, /data-ui="tabs"/)
  assert.match(rendered, /href="\/admin\/crm\/activities\?tab=mine&amp;lang=vi"/)
  assert.match(rendered, /href="\/admin\/crm\/activities\?tab=plans&amp;lang=vi"/)
  assert.match(rendered, /href="\/admin\/crm\/activities\?tab=calendar&amp;lang=vi"/)
  assert.match(rendered, /action="\/admin\/crm\/activities\?tab=mine&amp;lang=vi&amp;schedule=1"/)
  assert.match(rendered, /data-island="relation.select" data-field="caseId"/)
  assert.match(rendered, /data-island="relation.select" data-field="assigneeUserId"/)
  assert.match(rendered, /name="action" value="schedule"/)
  assert.match(rendered, /name="action" value="complete"/)
  assert.match(rendered, /name="action" value="cancel"/)
  assert.match(rendered, /href="\/admin\/crm\/cases\/case-denim\?lang=vi"/)
  assert.match(rendered, /Gọi lại khách hàng/)
  assert.match(rendered, /Hôm nay/)
  assert.match(rendered, /Ngày hoàn thành không hợp lệ/)
})

test('crm activity planner: preserves plan and calendar tables without the scheduling form', () => {
  const plans = renderToString(
    plannerScreen(
      translate,
      {},
      {
        tab: 'plans',
        activities: [],
        plans: [{ id: 'plan-onboarding', name: 'Chăm sóc lead mới', steps: [{ day: 1 }, { day: 3 }] }],
        events: [],
        activityTypes: [],
      },
    ),
  )
  const calendar = renderToString(
    plannerScreen(
      translate,
      {},
      {
        tab: 'calendar',
        activities: [],
        plans: [],
        events: [
          {
            id: 'meeting-demo',
            name: 'Demo giải pháp',
            startAt: '2026-08-28T09:00:00.000Z',
            caseId: 'case-denim',
            caseName: 'Cơ hội Denim Việt',
          },
        ],
        activityTypes: [],
      },
    ),
  )

  assert.match(plans, /Chăm sóc lead mới/)
  assert.match(plans, /data-col="detail"[^>]*>.*?2/)
  assert.doesNotMatch(plans, /name="action" value="schedule"/)
  assert.match(calendar, /Demo giải pháp/)
  assert.match(calendar, /2026-08-28 09:00/)
  assert.match(calendar, /href="\/admin\/crm\/cases\/case-denim"/)
  assert.doesNotMatch(calendar, /name="action" value="schedule"/)
})

test('crm activity planner: renders the shared empty state for an empty selected view', () => {
  const rendered = renderToString(
    plannerScreen(
      translate,
      {},
      {
        tab: 'calendar',
        activities: [],
        plans: [],
        events: [],
        activityTypes: [],
      },
    ),
  )

  assert.match(rendered, /data-ui="empty"/)
  assert.match(rendered, /Chưa có hoạt động/)
  assert.match(rendered, /Hoạt động mới sẽ xuất hiện tại đây/)
})
