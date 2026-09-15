import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  CONFIGURATION_RECORD_KINDS,
  CONFIGURATION_SECTIONS,
  CONFIGURATION_STATUSES,
  configurationScreen,
} from '../packages/ketsuite/src/modules/crm_backend/screens/configuration.tsx'

const messages: Record<string, string> = {
  'crm_backend.configuration.title': 'Cấu hình CRM',
  'crm_backend.configuration.teams': 'Đội nhóm',
  'crm_backend.configuration.stages': 'Giai đoạn',
  'crm_backend.configuration.tags': 'Nhãn',
  'crm_backend.configuration.assignmentRules': 'Quy tắc phân công',
  'crm_backend.configuration.scoreRules': 'Chấm điểm',
  'crm_backend.configuration.create': 'Thêm mới',
  'crm_backend.configuration.statusFilter': 'Lọc trạng thái cấu hình',
  'crm_backend.configuration.status.active': 'Đang hoạt động',
  'crm_backend.configuration.status.archived': 'Đã lưu trữ',
  'crm_backend.configuration.status.all': 'Tất cả',
  'crm_backend.configuration.emptyTitle': 'Chưa có mục cấu hình',
  'crm_backend.configuration.emptyHint': 'Bấm Thêm mới để tạo mục đầu tiên cho danh mục này.',
  'crm_backend.configuration.emptyFilteredTitle': 'Không có mục nào ở trạng thái này',
  'crm_backend.configuration.emptyFilteredHint': 'Chọn trạng thái khác để xem các mục còn lại.',
  'crm_backend.field.configName': 'Tên',
  'crm_backend.field.name': 'Tiêu đề',
  'crm_backend.field.active': 'Hoạt động',
  'crm_backend.state.active': 'Đang hoạt động',
  'crm_backend.state.archived': 'Đã lưu trữ',
  'crm_backend.empty.title': 'Chưa có dữ liệu',
  'backend.table.columns': 'Cột',
  'backend.table.selectAll': 'Chọn tất cả',
  'backend.table.selectRow': 'Chọn dòng',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('crm configuration: catalogues are sections, and the status filter is a visible control that survives them', () => {
  const rendered = renderToString(
    configurationScreen(
      translate,
      {},
      {
        section: 'teams',
        status: 'archived',
        locale: '?lang=vi',
        rows: [{ id: 'team-north', name: 'Miền Bắc', active: false, version: 3 }],
        canCreate: true,
      },
    ),
  )

  assert.match(rendered, /data-ui="list-page"/)
  assert.match(rendered, /data-ui="tabs"/)
  // `tab` belongs to the record modal; a catalogue is a `section`.
  assert.doesNotMatch(rendered, /[?&](?:amp;)?tab=/)
  for (const section of CONFIGURATION_SECTIONS)
    assert.match(
      rendered,
      new RegExp(`href="/admin/crm/configuration\\?section=${section}&amp;status=archived&amp;lang=vi"`),
      `switching to ${section} keeps the status`,
    )
  assert.match(rendered, /data-ui="saved-views"[^>]*aria-label="Lọc trạng thái cấu hình"/)
  for (const status of CONFIGURATION_STATUSES) {
    const query = status === 'active' ? '' : `&amp;status=${status}`
    assert.match(rendered, new RegExp(`href="/admin/crm/configuration\\?section=teams${query}&amp;lang=vi"`))
  }
  assert.match(
    rendered,
    /<a data-ui="saved-view" href="\/admin\/crm\/configuration\?section=teams&amp;status=archived&amp;lang=vi" aria-current="page"/,
  )
  assert.match(rendered, /Đã lưu trữ/)
})

test('crm configuration: rows and the create action open record modals, never a page or a server modal', () => {
  const rendered = renderToString(
    configurationScreen(
      translate,
      {},
      {
        section: 'teams',
        status: 'active',
        locale: '?lang=vi',
        rows: [{ id: 'team-north', name: 'Miền Bắc', active: true }],
        canCreate: true,
      },
    ),
  )
  assert.match(
    rendered,
    /<a data-ui="row-link" href="\/admin\/crm\/configuration\?section=teams&amp;lang=vi&amp;record=crm\.team%3Ateam-north">/,
  )
  assert.match(
    rendered,
    /href="\/admin\/crm\/configuration\?section=teams&amp;lang=vi&amp;record=crm\.team%3Anew"/,
  )
  assert.doesNotMatch(rendered, /\/admin\/crm\/configuration\/teams\//)
  assert.doesNotMatch(rendered, /edit=|create=1/)
  assert.doesNotMatch(rendered, /data-ui="modal-layer"|data-route-modal/)
  assert.match(rendered, />Tên</, 'the name column says "Tên", not "Tiêu đề"')
  assert.doesNotMatch(rendered, /Tiêu đề/)

  for (const section of CONFIGURATION_SECTIONS) {
    const html = renderToString(
      configurationScreen(
        translate,
        {},
        { section, status: 'active', rows: [{ id: 'row-1', name: 'Một' }], canCreate: true },
      ),
    )
    const kind = CONFIGURATION_RECORD_KINDS[section]
    assert.match(html, new RegExp(`record=${kind.replace('.', '\\.')}%3Arow-1"`), section)
    assert.match(html, new RegExp(`record=${kind.replace('.', '\\.')}%3Anew"`), section)
  }
})

test('crm configuration: a viewer who may not save gets no create action', () => {
  const rendered = renderToString(
    configurationScreen(
      translate,
      {},
      { section: 'stages', status: 'active', rows: [{ id: 'stage-1', name: 'Mới' }], canCreate: false },
    ),
  )
  assert.doesNotMatch(rendered, /record=crm\.stage%3Anew/)
  assert.doesNotMatch(rendered, /Thêm mới/)
  assert.match(rendered, /record=crm\.stage%3Astage-1/, 'rows still open read-only')
})

test('crm configuration: the empty state speaks about the catalogue and the chosen status', () => {
  for (const section of CONFIGURATION_SECTIONS) {
    const active = renderToString(configurationScreen(translate, {}, { section, status: 'active', rows: [] }))
    assert.match(active, /data-ui="empty"/)
    assert.match(active, /Chưa có mục cấu hình/)
    assert.doesNotMatch(active, /Chưa có dữ liệu|Tạo hồ sơ/)
    const archived = renderToString(
      configurationScreen(translate, {}, { section, status: 'archived', rows: [] }),
    )
    assert.match(archived, /Không có mục nào ở trạng thái này/)
  }
})
