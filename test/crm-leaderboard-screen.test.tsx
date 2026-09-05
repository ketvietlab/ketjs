import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { leaderboardScreen } from '../packages/ketsuite/src/modules/crm_backend/screens/leaderboard.tsx'

const messages: Record<string, string> = {
  'crm_backend.leaderboard.title': 'Bảng xếp hạng',
  'crm_backend.leaderboard.refresh': 'Tính lại',
  'crm_backend.leaderboard.points': 'Điểm',
  'crm_backend.leaderboard.assigned': 'Đang phụ trách',
  'crm_backend.leaderboard.activities': 'Hoạt động đã xong',
  'crm_backend.leaderboard.emptyTitle': 'Chưa có dữ liệu xếp hạng',
  'crm_backend.leaderboard.emptyHint': 'Tính lại để dựng bảng xếp hạng từ pipeline.',
  'crm_backend.field.assignee': 'Nhân viên',
  'crm_backend.timeline.at': 'Cập nhật lúc',
  'crm.terminal.won': 'Thắng',
  'crm.terminal.lost': 'Thua',
  'backend.table.columns': 'Cột',
  'backend.table.selectAll': 'Chọn tất cả',
  'backend.table.selectRow': 'Chọn dòng',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('crm leaderboard: uses ListPage with rank, metrics, profile links and localized refresh', () => {
  const rendered = renderToString(
    leaderboardScreen(
      translate,
      {},
      {
        locale: '?lang=vi',
        errors: ['Không thể tính lại dữ liệu'],
        profiles: [
          {
            id: 'gamification:admin',
            userId: 'admin',
            userName: 'Quản trị viên',
            points: 142,
            won: 1,
            lost: 2,
            assigned: 6,
            activitiesDone: 4,
            refreshedAt: '2026-08-27T09:30:00.000Z',
          },
          {
            id: 'gamification:sales',
            userId: 'sales north',
            userName: 'Kinh doanh miền Bắc',
            points: 98,
            won: 0,
            lost: 1,
            assigned: 5,
            activitiesDone: 3,
            refreshedAt: '2026-08-26T16:15:00.000Z',
          },
        ],
      },
    ),
  )

  assert.equal(rendered.match(/data-ui="list-page-title"/g)?.length, 1)
  assert.doesNotMatch(rendered, /data-ui="form-page"/)
  assert.match(rendered, /Bảng xếp hạng: 2/)
  assert.match(rendered, /data-ui="cell" data-col="rank"[^>]*>.*?1/)
  assert.match(rendered, /data-ui="cell" data-col="rank"[^>]*>.*?2/)
  assert.match(rendered, /data-ui="cell" data-col="points"[^>]*>.*?142/)
  assert.match(rendered, /data-ui="cell" data-col="won"[^>]*>.*?1/)
  assert.match(rendered, /data-ui="cell" data-col="lost"[^>]*>.*?2/)
  assert.match(rendered, /data-ui="cell" data-col="assigned"[^>]*>.*?6/)
  assert.match(rendered, /data-ui="cell" data-col="activities"[^>]*>.*?4/)
  assert.match(rendered, /2026-08-27 09:30/)
  assert.match(rendered, /href="\/admin\/users\/admin\?lang=vi"/)
  assert.match(rendered, /href="\/admin\/users\/sales%20north\?lang=vi"/)
  assert.match(rendered, /action="\/admin\/crm\/leaderboard\?lang=vi"/)
  assert.match(rendered, /name="action" value="refresh"/)
  assert.match(rendered, /Tính lại/)
  assert.match(rendered, /Không thể tính lại dữ liệu/)
})

test('crm leaderboard: retains the empty state and the refresh action', () => {
  const rendered = renderToString(leaderboardScreen(translate, {}, { profiles: [] }))

  assert.match(rendered, /data-ui="list-page"/)
  assert.match(rendered, /data-ui="empty"/)
  assert.match(rendered, /Chưa có dữ liệu xếp hạng/)
  assert.match(rendered, /Tính lại để dựng bảng xếp hạng từ pipeline/)
  assert.match(rendered, /name="action" value="refresh"/)
  assert.match(rendered, /Bảng xếp hạng: 0/)
})
