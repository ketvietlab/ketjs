import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { activitiesScreen } from '../packages/ketsuite/src/modules/activity_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('activity queue uses ListPage and keeps route-owned actions and destinations', () => {
  const html = renderToString(
    activitiesScreen(
      translate,
      {},
      {
        rows: [
          {
            id: 'activity/a',
            summary: 'Confirm quantity',
            typeName: 'To-do',
            targetName: 'Product A',
            dueDate: '2026-08-27',
            state: 'today',
            active: true,
            targetHref: '/admin/product/templates/product%2Fa?lang=en',
          },
        ],
        action: '/admin/activities?lang=en&done=1',
        toggleHref: '/admin/activities?lang=en&today=2026-08-27',
        includeDone: true,
        today: '2026-08-27',
      },
    ),
  )
  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /href="\/admin\/product\/templates\/product%2Fa\?lang=en"/)
  assert.match(html, /action="\/admin\/activities\?lang=en&amp;done=1"/)
  assert.match(html, /name="action" value="complete"/)
  assert.match(html, /name="action" value="reschedule"/)
  assert.match(html, /name="action" value="cancel"/)
})
