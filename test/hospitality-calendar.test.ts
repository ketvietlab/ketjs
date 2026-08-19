import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  calendarRange,
  dateKeyIn,
  zonedMidnight,
} from '../packages/ketsuite/src/modules/hospitality_core/calendar.ts'

test('hospitality calendar builds a hotel day in the property timezone', () => {
  assert.deepEqual(calendarRange('2026-08-20', 1, 'Asia/Ho_Chi_Minh'), {
    from: '2026-08-19T17:00:00.000Z',
    to: '2026-08-20T17:00:00.000Z',
  })
  assert.equal(dateKeyIn(new Date('2026-08-19T18:00:00.000Z'), 'Asia/Ho_Chi_Minh'), '2026-08-20')
})

test('hospitality calendar honours daylight-saving boundaries instead of 24-hour days', () => {
  const range = calendarRange('2026-03-08', 1, 'America/New_York')
  assert.deepEqual(range, {
    from: '2026-03-08T05:00:00.000Z',
    to: '2026-03-09T04:00:00.000Z',
  })
  assert.equal(Date.parse(range.to) - Date.parse(range.from), 23 * 60 * 60 * 1000)
  assert.equal(zonedMidnight('2026-11-02', 'America/New_York').toISOString(), '2026-11-02T05:00:00.000Z')
})
