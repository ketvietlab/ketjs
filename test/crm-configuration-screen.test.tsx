import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  CONFIGURATION_TABS,
  configurationScreen,
  teamConfigurationScreen,
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

test('crm configuration: keeps five specialized tabs and opens the whole team row', () => {
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
  assert.equal(CONFIGURATION_TABS.length, 5)
  assert.doesNotMatch(rendered, /tab=members/)
  assert.match(rendered, /href="\/admin\/crm\/configuration\/teams\/new\?lang=vi"/)
  assert.match(rendered, /data-row-href="\/admin\/crm\/configuration\/teams\/team-north\?lang=vi"/)
  assert.doesNotMatch(rendered, /data-ui="row-link"/)
  assert.doesNotMatch(rendered, /name="action" value="archive"/)
  assert.match(rendered, /Đang hoạt động/)
})

test('crm configuration: edits a team and its members on a full record page', () => {
  const rendered = renderToString(
    teamConfigurationScreen(
      translate,
      {},
      {
        team: { id: 'team-north', name: 'Miền Bắc', active: true, version: 4 },
        members: [
          {
            id: 'member-admin',
            userName: 'Quản trị viên',
            userId: 'admin',
            capacity: 5,
            assignedCount: 2,
            active: false,
          },
        ],
        fields: [{ name: 'name', label: 'Tên', value: 'Miền Bắc' }],
        action: '/admin/crm/configuration/teams/team-north?lang=vi',
        cancelHref: '/admin/crm/configuration?tab=teams&lang=vi',
        memberCreateHref: '/admin/crm/configuration/teams/team-north?member=new&lang=vi',
        memberEditHref: (row) => `/admin/crm/configuration/teams/team-north?member=${String(row.id)}&lang=vi`,
        errors: ['Sức chứa phải lớn hơn 0'],
      },
    ),
  )

  assert.match(rendered, /data-ui="form-page"[^>]*data-pattern="record"/)
  assert.match(rendered, /name="id" value="team-north"/)
  assert.match(rendered, /name="expectedVersion" value="4"/)
  assert.match(
    rendered,
    /data-row-href="\/admin\/crm\/configuration\/teams\/team-north\?member=member-admin&amp;lang=vi"/,
  )
  assert.doesNotMatch(rendered, /data-ui="row-link"/)
  assert.match(rendered, /Quản trị viên/)
  assert.match(rendered, /5/)
  assert.match(rendered, /2/)
  assert.match(rendered, /Sức chứa phải lớn hơn 0/)
  assert.match(rendered, /Đã lưu trữ/)
})

test('crm configuration: keeps large forms in a centered dialog instead of a side sheet', () => {
  const rendered = renderToString(
    configurationScreen(
      translate,
      {},
      {
        tab: 'assignmentRules',
        rows: [],
        creating: true,
        editing: null,
        fields: [
          { name: 'name', label: 'Tên' },
          { name: 'teamId', label: 'Đội bán hàng' },
          { name: 'kind', label: 'Loại' },
          { name: 'sequence', label: 'Thứ tự', type: 'number' },
          { name: 'active', label: 'Hoạt động', type: 'checkbox' },
        ],
      },
    ),
  )

  assert.match(rendered, /data-presentation="dialog"/)
  assert.match(rendered, /data-size="large"/)
  assert.doesNotMatch(rendered, /data-presentation="sheet"/)
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
