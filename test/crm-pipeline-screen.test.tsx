import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { html, renderToString } from '@ketvietlab/ketjs-view'
import { pipelineScreen } from '../packages/ketsuite/src/modules/crm_backend/screens/pipeline.tsx'

const messages: Record<string, string> = {
  'crm_backend.pipeline.title': 'Pipeline CRM',
  'crm_backend.pipeline.subtitle': 'Quản lý và theo dõi lead, cơ hội trong quy trình bán hàng.',
  'backend.brand': 'Quản trị',
  'backend.chrome.removeFilter': 'Bỏ bộ lọc',
  'backend.chrome.globalFilter': 'Bộ lọc',
  'backend.chrome.apply': 'Áp dụng',
  'backend.chrome.views': 'Kiểu hiển thị',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

const board = html`<ket-island
  data-island="crm.pipeline"
  data-lang="vi"
  data-empty-label="Chưa có lead hoặc cơ hội"
  data-conflict-label="Dữ liệu đã thay đổi"
></ket-island>`

test('crm pipeline: keeps specialized chrome, figures and the route-owned board together', () => {
  const rendered = renderToString(
    pipelineScreen(
      translate,
      {
        chrome: {
          create: { label: 'Tạo lead', path: '/admin/crm/cases?lang=vi' },
          search: {
            name: 'q',
            value: 'May mặc',
            placeholder: 'Tìm lead hoặc công ty…',
            keep: { teamId: 'north', mine: '1', lang: 'vi' },
            facets: [{ label: 'Của tôi', without: '/admin/crm/pipeline?teamId=north&lang=vi' }],
            menus: [
              {
                id: 'team',
                label: 'Miền Bắc',
                items: [
                  {
                    id: 'north',
                    label: 'Miền Bắc',
                    path: '/admin/crm/pipeline?teamId=north&lang=vi',
                    active: true,
                  },
                ],
              },
            ],
          },
          views: [
            {
              id: 'kanban',
              label: 'Kanban',
              icon: 'layout-grid',
              path: '/admin/crm/pipeline?lang=vi',
              active: true,
            },
            {
              id: 'list',
              label: 'Danh sách',
              icon: 'list',
              path: '/admin/crm/cases?lang=vi',
              active: false,
            },
          ],
        },
      },
      board,
      [
        { id: 'open', label: 'Đang mở', value: '18', icon: 'users' },
        {
          id: 'weighted',
          label: 'Giá trị có trọng số',
          value: '125.000.000 ₫',
          detail: 'Doanh thu nhân xác suất',
          icon: 'wallet',
        },
      ],
    ),
  )

  // The board wears the collection header the rest of CRM wears, not a record's.
  assert.match(rendered, /data-ui="list-page"/)
  assert.doesNotMatch(rendered, /data-ui="record-workspace"/)
  assert.match(rendered, /data-ui="list-page-title"><!--k\[-->Pipeline CRM/)
  assert.match(rendered, /data-ui="list-page-description"/)
  assert.match(rendered, /data-ui="chrome-search-input"[^>]*name="q"[^>]*value="May mặc"/)
  assert.match(rendered, /type="hidden"[^>]*name="teamId"[^>]*value="north"/)
  assert.match(rendered, /type="hidden"[^>]*name="mine"[^>]*value="1"/)
  assert.match(rendered, /type="hidden"[^>]*name="lang"[^>]*value="vi"/)
  assert.match(rendered, /href="\/admin\/crm\/cases\?lang=vi"/)
  assert.match(rendered, /data-ui="view-kind"[^>]*data-kind="kanban"[^>]*data-active="true"/)
  assert.match(rendered, /data-ui="view-kind"[^>]*data-kind="list"/)
  assert.equal(rendered.match(/data-ui="metric"/g)?.length, 2)
  assert.match(rendered, /Giá trị có trọng số/)
  assert.match(rendered, /Doanh thu nhân xác suất/)
  assert.match(rendered, /data-island="crm.pipeline"/)
  assert.match(rendered, /data-lang="vi"/)
  assert.match(rendered, /data-empty-label="Chưa có lead hoặc cơ hội"/)
  assert.match(rendered, /data-conflict-label="Dữ liệu đã thay đổi"/)
})

test('crm pipeline: leaves the board available when summary permission hides figures', () => {
  const rendered = renderToString(pipelineScreen(translate, {}, board))

  assert.doesNotMatch(rendered, /data-ui="metric"/)
  assert.match(rendered, /data-island="crm.pipeline"/)
  assert.match(rendered, /data-empty-label="Chưa có lead hoặc cơ hội"/)
  assert.match(rendered, /data-conflict-label="Dữ liệu đã thay đổi"/)
})
