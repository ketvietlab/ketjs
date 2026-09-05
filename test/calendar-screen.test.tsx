import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { calendarScreen } from '../packages/ketsuite/src/modules/calendar_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('calendar uses the horizontal workspace around its board joint', () => {
  const html = renderToString(calendarScreen(translate, <div data-board="calendar">Board</div>, {}))
  assert.match(html, /calendar_backend\.title/)
  assert.match(html, /data-ui="board-page"[^>]*data-variant="operational"/)
  assert.match(html, /data-ui="board-page-context"[\s\S]*?data-ui="breadcrumbs"/)
  assert.match(html, /data-board="calendar"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"/)
})
