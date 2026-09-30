import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { DatePicker, DateRangePicker } from '@ketvietlab/design-system'
import type { DatePickerProps, DatePickerLabels, DateRangePreset } from '@ketvietlab/design-system'
import { DatePickerExamples, componentRegistry } from '@ketvietlab/design-system/catalogue'
import { HOOKS } from '../packages/design-system/src/forms/date-time/index.tsx'
import {
  addDays,
  formatRange,
  monthEnd,
  moveMonth,
  orderedRange,
  parseDate,
  presetRange,
  withinBounds,
} from '../packages/design-system/src/forms/date-time/date-math.js'

const render = (view: Parameters<typeof renderToString>[0]) =>
  renderToString(view).replace(/<!--.*?-->/gs, '')
const range = {
  id: 'range',
  label: 'Báo cáo',
  startLabel: 'Từ ngày',
  endLabel: 'Đến ngày',
  start: { id: 'from', name: 'from' },
  end: { id: 'to', name: 'to' },
}

test('all seven date presets have inclusive civil-date boundaries', () => {
  const expected: Record<DateRangePreset, [string, string]> = {
    today: ['2026-09-30', '2026-09-30'],
    yesterday: ['2026-09-29', '2026-09-29'],
    last7: ['2026-09-24', '2026-09-30'],
    thisMonth: ['2026-09-01', '2026-09-30'],
    lastMonth: ['2026-08-01', '2026-08-31'],
    last30: ['2026-09-01', '2026-09-30'],
    last90: ['2026-07-03', '2026-09-30'],
  }
  for (const [id, dates] of Object.entries(expected)) assert.deepEqual(presetRange(id, '2026-09-30'), dates)
  assert.deepEqual(presetRange('thisMonth', '2026-09-12'), ['2026-09-01', '2026-09-30'])
  assert.equal(presetRange('unknown', '2026-09-30'), null)
})

test('civil dates handle leap years, year changes, DST dates and supported year boundaries', () => {
  assert.deepEqual(presetRange('lastMonth', '2024-03-01'), ['2024-02-01', '2024-02-29'])
  assert.deepEqual(presetRange('lastMonth', '2026-01-31'), ['2025-12-01', '2025-12-31'])
  assert.deepEqual(presetRange('last7', '2026-01-02'), ['2025-12-27', '2026-01-02'])
  assert.deepEqual(presetRange('last7', '2026-03-10'), ['2026-03-04', '2026-03-10'])
  assert.deepEqual(presetRange('last7', '2026-11-03'), ['2026-10-28', '2026-11-03'])
  assert.equal(moveMonth('2024-01-31', 1), '2024-02-29')
  assert.equal(moveMonth('2024-02-29', 12), '2025-02-28')
  assert.equal(monthEnd('9999-12-01'), '9999-12-31')
  assert.equal(addDays('9999-12-31', 1), '')
  assert.equal(moveMonth('0001-01-01', -1), '')
  assert.equal(presetRange('last90', '0001-01-01'), null)
  assert.equal(parseDate('0099-01-01')?.getUTCFullYear(), 99)
  for (const value of [
    '',
    '2026-02-29',
    '2024-02-30',
    '2026-13-01',
    '2026-01-00',
    '2026-9-1',
    '0000-01-01',
    '2026-09-30T00:00:00Z',
  ]) {
    assert.equal(parseDate(value), null, value)
    assert.equal(presetRange('today', value), null, value)
  }
})

test('bounds are inclusive and reversed selections are ordered', () => {
  for (const value of ['2026-09-10', '2026-09-15', '2026-09-20'])
    assert.equal(withinBounds(value, '2026-09-10', '2026-09-20'), true)
  for (const value of ['', '2026-09-09', '2026-09-21'])
    assert.equal(withinBounds(value, '2026-09-10', '2026-09-20'), false)
  assert.deepEqual(orderedRange('2026-10-02', '2026-09-29'), ['2026-09-29', '2026-10-02'])
  assert.deepEqual(orderedRange('2026-09-30', '2026-09-30'), ['2026-09-30', '2026-09-30'])
})

test('DatePicker retains native field semantics with a separately labelled dialog launcher', () => {
  const props: DatePickerProps = {
    id: 'day',
    name: 'delivery',
    label: 'Ngày giao hàng',
    value: '2026-09-15',
    min: '2026-09-01',
    max: '2026-09-30',
    step: '2',
    required: true,
    help: 'Chọn ngày',
    issues: [{ path: 'delivery', message: 'Không hợp lệ' }],
    today: '2026-09-30',
  }
  const html = render(<DatePicker {...props} />)
  assert.match(html, /<label[^>]*for="day">Ngày giao hàng/)
  assert.match(
    html,
    /<input[^>]*id="day"[^>]*type="date"[^>]*name="delivery"[^>]*value="2026-09-15"[^>]*required[^>]*min="2026-09-01"[^>]*max="2026-09-30"/,
  )
  assert.match(html, /aria-describedby="day-help day-error"/)
  assert.match(html, /aria-invalid="true"/)
  assert.match(html, /autocomplete="off" step="2"/)
  assert.match(html, /aria-controls="day-calendar"/)
  assert.match(html, /popover="auto" role="dialog" aria-labelledby="day-calendar-title"/)
  assert.doesNotMatch(html, /<label[^>]*>[\s\S]*?<button[\s\S]*?<\/label>/)
  for (const state of [{ disabled: true }, { readOnly: true }])
    assert.match(render(<DatePicker {...props} {...state} />), /<button[^>]*name="kv-date-open"[^>]*disabled/)
})

test('DateRangePicker exposes seven Vietnamese presets without extra submitted values', () => {
  const html = render(<DateRangePicker {...range} />)
  for (const label of [
    'Hôm nay',
    'Hôm qua',
    '7 ngày qua',
    'Tháng này',
    'Tháng trước',
    '30 ngày qua',
    '90 ngày qua',
  ])
    assert.ok(html.includes(label), label)
  assert.equal((html.match(/<option /g) ?? []).length, 8)
  assert.equal((html.match(/<input /g) ?? []).length, 3)
  assert.doesNotMatch(html, /data-selection-hidden="true"/)
  assert.equal((html.match(/type="hidden"/g) ?? []).length, 2)
  assert.equal((html.match(/type="text"/g) ?? []).length, 1)
  assert.match(html, /<div data-ui="date-range" id="range"/)
  assert.match(html, /for="range-input">Báo cáo<\/label>/)
  assert.match(html, /id="range-range-error" role="alert" hidden/)
  assert.doesNotMatch(html, /type="submit"/)
  assert.doesNotMatch(render(<DateRangePicker {...range} presets={false} />), /data-ui="date-range-preset"/)
  const labels: Partial<DatePickerLabels> = { open: 'Mở lịch' }
  const custom = render(
    <DateRangePicker
      {...range}
      locale="en"
      weekStartsOn={0}
      presets={['today', 'today']}
      calendarLabels={{ ...labels, presetLabels: { today: 'Hiện tại' } }}
    />,
  )
  assert.equal((custom.match(/<option /g) ?? []).length, 2)
  assert.ok(custom.includes('Hiện tại'))
  assert.ok(custom.includes('Mở lịch'))
  assert.match(custom, /data-date-week-start="0"/)
})

test('calendar hooks, runtime ownership and catalogue examples stay in the public contract', () => {
  const css = readFileSync('packages/design-system/src/forms/date-time/styles.css', 'utf8')
  for (const hook of HOOKS) assert.ok(css.includes(`[data-ui="${hook}"]`), hook)
  assert.match(css, /:popover-open/)
  assert.match(css, /height: 100dvh/)
  assert.match(css, /data-ui="date-field-control"/)
  assert.match(css, /grid-template-rows: auto minmax\(0, 1fr\) auto/)
  assert.match(css, /env\(safe-area-inset-bottom\)/)
  assert.match(css, /data-in-range="true"/)
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  const view = readFileSync('packages/design-system/src/forms/date-time/index.tsx', 'utf8')
  assert.doesNotMatch(view, /\b(?:window|document|fetch)\b|new Date\(/)
  const html = render(<DatePickerExamples />)
  for (const id of [
    'date',
    'range',
    'bounded-date',
    'readonly-date',
    'disabled-date',
    'invalid-date',
    'bounded-range',
  ])
    assert.ok(html.includes(`id="${id}"`), id)
  for (const name of ['DatePicker', 'DateRangePicker'])
    assert.equal(componentRegistry.find((component) => component.name === name)?.specimenId, 'date-time')
})

test('range display is compact and retains years across a year boundary', () => {
  assert.equal(formatRange('2026-09-01', '2026-09-30'), '01/09 – 30/09/2026')
  assert.equal(formatRange('2025-12-30', '2026-01-02'), '30/12/2025 – 02/01/2026')
  assert.equal(formatRange('', '2026-09-30'), '')
})
