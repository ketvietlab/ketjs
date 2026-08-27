import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { ganttScreen } from '../packages/ketsuite/src/modules/flow_backend/screens/gantt.tsx'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('project Gantt remains specialized and uses server-owned locale-safe issue links', () => {
  const html = renderToString(
    ganttScreen(
      translate,
      {
        chrome: {
          pager: {
            from: 201,
            to: 201,
            total: 201,
            prev: '/admin/flow/projects/project%2Fa/gantt?lang=en',
            next: null,
          },
        },
      },
      'Platform',
      [
        {
          id: 'issue/a',
          title: 'Ship release',
          startsOn: '2026-08-01',
          dueDate: '2026-08-03',
          startDate: '2026-08-01',
          detailHref: '/admin/flow/issues/issue%2Fa?lang=en',
        },
      ],
      '2026-08-02',
      'en-GB',
    ),
  )

  assert.match(html, /data-ui="gantt"/)
  assert.match(html, /data-ui="gantt-row" href="\/admin\/flow\/issues\/issue%2Fa\?lang=en"/)
  assert.match(html, /201-201 \/ 201/)
  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="form-page"|data-ui="modal-layer"/)
})
