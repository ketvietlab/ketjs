import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  CONFIGURATION_TABS,
  configurationScreen,
} from '../packages/ketsuite/src/modules/crm_backend/screens/configuration.tsx'

const messages: Record<string, string> = {
  'crm_backend.configuration.title': 'Cấu hình CRM',
  'crm_backend.configuration.teams': 'Đội bán hàng',
  'crm_backend.configuration.members': 'Thành viên',
  'crm_backend.configuration.stages': 'Giai đoạn',
  'crm_backend.configuration.tags': 'Thẻ',
  'crm_backend.configuration.assignmentRules': 'Quy tắc phân công',
  'crm_backend.configuration.scoreRules': 'Quy tắc tính điểm',
  'crm_backend.configuration.create': 'Tạo cấu hình',
  'crm_backend.configuration.edit': 'Chỉnh sửa',
  'crm_backend.configuration.detail': 'Chi tiết',
  'crm_backend.field.name': 'Tên',
  'crm_backend.field.active': 'Hoạt động',
  'crm_backend.field.actions': 'Thao tác',
  'crm_backend.state.active': 'Đang hoạt động',
  'crm_backend.state.archived': 'Đã lưu trữ',
  'crm_backend.action.save': 'Lưu',
  'crm_backend.action.archive': 'Lưu trữ',
  'crm_backend.action.restore': 'Khôi phục',
  'crm_backend.action.cancelEdit': 'Hủy chỉnh sửa',
  'crm_backend.empty.title': 'Chưa có cấu hình',
  'crm_backend.empty.hint': 'Tạo bản ghi đầu tiên.',
  'backend.table.columns': 'Cột',
  'backend.table.selectAll': 'Chọn tất cả',
  'backend.table.selectRow': 'Chọn dòng',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('crm configuration: keeps the specialized tabbed create workflow and localized row actions', () => {
  const rendered = renderToString(
    configurationScreen(
      translate,
      {},
      {
        tab: 'teams',
        locale: '?lang=vi',
        rows: [{ id: 'team-north', name: 'Miền Bắc', active: true, version: 3 }],
        editing: null,
        fields: [
          { name: 'name', label: 'Tên', required: true },
          { name: 'active', label: 'Hoạt động', type: 'checkbox', value: true },
        ],
      },
    ),
  )

  assert.match(rendered, /data-ui="list-page"/)
  assert.doesNotMatch(rendered, /data-ui="form-page"/)
  assert.match(rendered, /data-ui="tabs"/)
  for (const tab of CONFIGURATION_TABS)
    assert.match(rendered, new RegExp(`href="/admin/crm/configuration\\?tab=${tab}&amp;lang=vi"`))
  assert.match(rendered, /data-active="true"[^>]*href="\/admin\/crm\/configuration\?tab=teams&amp;lang=vi"/)
  assert.match(rendered, /Tạo cấu hình/)
  assert.match(rendered, /action="\/admin\/crm\/configuration\?tab=teams&amp;lang=vi"/)
  assert.match(rendered, /href="\/admin\/crm\/configuration\?tab=teams&amp;edit=team-north&amp;lang=vi"/)
  assert.match(rendered, /name="action" value="archive"/)
  assert.match(rendered, /name="expectedVersion" value="3"/)
  assert.match(rendered, /Đang hoạt động/)
})

test('crm configuration: preserves edit values, validation, cancel, detail and restore semantics', () => {
  const rendered = renderToString(
    configurationScreen(
      translate,
      {},
      {
        tab: 'members',
        locale: '?lang=vi',
        rows: [
          {
            id: 'member-admin',
            userName: 'Quản trị viên',
            capacity: 5,
            assignedCount: 2,
            active: false,
            version: 4,
          },
        ],
        editing: {
          id: 'member-admin',
          userName: 'Quản trị viên',
          capacity: 5,
          active: false,
          version: 4,
        },
        fields: [{ name: 'capacity', label: 'Sức chứa', type: 'number', value: '5' }],
        errors: ['Sức chứa phải lớn hơn 0'],
        label: (row) => String(row.userName),
        detail: (row) => `5 · ${String(row.assignedCount ?? 0)}`,
      },
    ),
  )

  assert.match(rendered, /Chỉnh sửa · Quản trị viên/)
  assert.match(rendered, /name="id" value="member-admin"/)
  assert.match(rendered, /name="expectedVersion" value="4"/)
  assert.match(rendered, /name="capacity"[^>]*value="5"/)
  assert.match(rendered, /Sức chứa phải lớn hơn 0/)
  assert.match(rendered, /href="\/admin\/crm\/configuration\?tab=members&amp;lang=vi"/)
  assert.match(rendered, /data-col="detail"/)
  assert.match(rendered, /5 · 2/)
  assert.match(rendered, /Đã lưu trữ/)
  assert.match(rendered, /name="action" value="restore"/)
})

test('crm configuration: every configuration section remains selectable and can render empty', () => {
  for (const tab of CONFIGURATION_TABS) {
    const rendered = renderToString(
      configurationScreen(
        translate,
        {},
        {
          tab,
          rows: [],
          editing: null,
          fields: [{ name: 'name', label: 'Tên' }],
        },
      ),
    )

    assert.match(rendered, /data-ui="empty"/)
    assert.match(rendered, /Chưa có cấu hình/)
    assert.match(rendered, new RegExp(`href="/admin/crm/configuration\\?tab=${tab}"`))
  }
})
