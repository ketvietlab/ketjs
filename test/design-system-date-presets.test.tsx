import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  DatePresetPicker,
  datePresetIds,
  datePresetLabel,
  resolveDatePreset,
} from '../packages/design-system/src/forms/date-presets/index.tsx'
import { Menu } from '../packages/design-system/src/interactions/menu/index.tsx'

test('eleven fixed periods resolve against the explicit business date', () => {
  const expected = [
    ['2026-10-04', '2026-10-04'],
    ['2026-10-03', '2026-10-03'],
    ['2026-09-28', '2026-10-04'],
    ['2026-09-28', '2026-10-04'],
    ['2026-09-21', '2026-09-27'],
    ['2026-09-05', '2026-10-04'],
    ['2026-10-01', '2026-10-31'],
    ['2026-09-01', '2026-09-30'],
    ['2026-07-07', '2026-10-04'],
    ['2026-01-01', '2026-12-31'],
    ['2025-01-01', '2025-12-31'],
  ]
  assert.equal(datePresetIds.length, 11)
  assert.equal(datePresetLabel('today', 'vi'), 'Hôm nay')
  assert.equal(datePresetLabel('last_year', 'en'), 'Last year')
  for (const [i, preset] of datePresetIds.entries()) {
    assert.deepEqual(resolveDatePreset(preset, '2026-10-04'), { start: expected[i][0], end: expected[i][1] })
  }
})

test('civil-date boundaries: leap month, year crossing, Monday, invalid input', () => {
  assert.deepEqual(resolveDatePreset('last_month', '2024-03-31'), { start: '2024-02-01', end: '2024-02-29' })
  assert.deepEqual(resolveDatePreset('this_week', '2026-01-01'), { start: '2025-12-29', end: '2026-01-04' })
  assert.deepEqual(resolveDatePreset('last_week', '2026-10-05'), { start: '2026-09-28', end: '2026-10-04' })
  assert.deepEqual(resolveDatePreset('yesterday', '2026-01-01'), { start: '2025-12-31', end: '2025-12-31' })
  assert.throws(() => resolveDatePreset('today', '2026-02-30'), RangeError)
  assert.throws(() => resolveDatePreset('last_year', '0001-01-01'), RangeError)
  assert.throws(() => resolveDatePreset('today', '2026-10-04T00:00:00Z'), RangeError)
})

test('picker offers only presets, with one accessible selection and native links', () => {
  const html = renderToString(
    <DatePresetPicker
      id="period"
      label="Kỳ báo cáo"
      value="last_30_days"
      today="2026-10-04"
      href={(preset, range) => `/dashboard?period=${preset}&from=${range.start}&to=${range.end}`}
    />,
  )
  assert.equal((html.match(/role="menuitemradio"/g) ?? []).length, 11)
  assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 1)
  assert.match(html, /aria-label="Kỳ báo cáo: 30 ngày qua"/)
  assert.match(html, /period=last_week/)
  assert.match(html, /data-mobile-align="start"/)
  assert.match(html, /Tuần trước/)
  assert.doesNotMatch(html, /<input|<select|date-calendar|Áp dụng|Tùy chỉnh/)
  const checkboxMenu = renderToString(
    <Menu id="other" label="Other" items={[{ id: 'a', label: 'A', checked: true, href: '/a' }]} />,
  )
  assert.match(checkboxMenu, /role="menuitemcheckbox"/)
})
