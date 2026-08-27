import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { each, html, renderToString, signal } from '@ketvietlab/ketjs-view'
import { createFlowBoardView } from '../packages/ketsuite/src/ui/client/flow-board-view.mjs'
import { boardScreen } from '../packages/ketsuite/src/modules/flow_backend/screens/board.tsx'
import { projectNav } from '../packages/ketsuite/src/modules/flow_backend/screens/nav.tsx'

const messages: Record<string, string> = {
  'backend.brand': 'Quản trị',
  'backend.nav.sections': 'Phân hệ',
  'backend.nav.search': 'Tìm phân hệ',
  'backend.nav.noMatch': 'Không tìm thấy',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('flow board: remains a focused specialized workspace around the kanban island', () => {
  const board = html`<ket-island
    data-island="flow.board"
    data-lang="vi"
    data-project="project-platform"
  ><section data-ui="flow-board"><div data-ui="flow-board-columns"></div></section></ket-island>`
  const rendered = renderToString(boardScreen(translate, {}, 'Nền tảng nội bộ', board))

  assert.match(rendered, /data-ui="record-workspace"/)
  assert.doesNotMatch(rendered, /data-ui="list-page"|data-ui="form-page"/)
  assert.match(rendered, /data-ui="section"/)
  assert.match(rendered, /Nền tảng nội bộ/)
  assert.match(rendered, /data-island="flow.board"/)
  assert.match(rendered, /data-ui="flow-board"/)
  assert.match(rendered, /data-ui="flow-board-columns"/)
})

test('flow project navigation: preserves locale and marks board active', () => {
  const rendered = renderToString(
    projectNav({
      active: '/admin/flow/projects/project-platform/board',
      lang: 'en',
    })(),
  )

  assert.match(rendered, /data-ui="sidebar-section-label"/)
  assert.match(rendered, /href="\/admin\/flow\/projects\/project-platform\/board\?lang=en"/)
  assert.match(rendered, /href="\/admin\/flow\/projects\/project-platform\/issues\?lang=en"/)
  assert.match(rendered, /href="\/admin\/flow\/projects\/project-platform\/gantt\?lang=en"/)
  assert.match(rendered, /href="\/admin\/flow\/projects\/project-platform\/pages\?lang=en"/)
  assert.match(rendered, /href="\/admin\/flow\/projects\/project-platform\/epics\?lang=en"/)
  assert.match(rendered, /href="\/admin\/flow\/projects\/project-platform\/sprints\?lang=en"/)
  assert.match(rendered, /href="\/admin\/flow\/projects\/project-platform\/settings\?lang=en"/)
  assert.match(
    rendered,
    /data-active="true"[^>]*href="\/admin\/flow\/projects\/project-platform\/board\?lang=en"/,
  )
})

test('flow board island: preserves cards, counts, move fallback, load more and locale', () => {
  const view = createFlowBoardView(
    { each, html, signal },
    {
      lang: 'vi',
      data: JSON.stringify({
        locale: '?lang=vi',
        rows: [
          {
            id: 'issue-login',
            projectId: 'project-platform',
            columnId: 'doing',
            title: 'Hoàn thiện đăng nhập',
            version: 3,
            priority: 'high',
            assigneeName: 'Minh',
            dueDate: '2026-09-01',
          },
        ],
        columns: [
          {
            id: 'doing',
            name: 'Đang làm',
            total: 41,
            loadMoreHref: '/admin/flow/projects/project-platform/issues?filter=column%3Adoing',
          },
          { id: 'done', name: 'Hoàn thành', total: 0 },
        ],
        labels: {
          empty: 'Không có công việc',
          move: 'Chuyển cột',
          moving: 'Đang chuyển',
          unassigned: 'Chưa gán',
          loadMore: 'Tải thêm',
          moveShort: 'Chuyển',
        },
      }),
    },
  )
  const rendered = renderToString(view())
  const text = rendered.replace(/<!--k\[?-->/g, '')

  assert.match(rendered, /data-ui="flow-board"/)
  assert.equal(rendered.match(/data-ui="flow-board-column"/g)?.length, 2)
  assert.match(rendered, /Đang làm/)
  assert.match(text, /1 \/ 41/)
  assert.match(rendered, /Hoàn thiện đăng nhập/)
  assert.match(rendered, /href="\/admin\/flow\/issues\/issue-login\?lang=vi"/)
  assert.match(rendered, /action="\/admin\/flow\/projects\/project-platform\/board\/move\?lang=vi"/)
  assert.match(rendered, /name="expectedVersion" value="3"/)
  assert.match(rendered, /data-priority="high"/)
  assert.match(rendered, /Minh/)
  assert.match(rendered, /2026-09-01/)
  assert.match(
    rendered,
    /href="\/admin\/flow\/projects\/project-platform\/issues\?filter=column%3Adoing&amp;lang=vi"/,
  )
  assert.match(rendered, /Tải thêm/)
})
