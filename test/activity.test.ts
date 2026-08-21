import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { addDays, stateOf } from '../packages/ketsuite/src/modules/activity/index.ts'

const activity = (over: Partial<Row> = {}): Row => ({
  id: 'a1',
  dueDate: '2026-08-20',
  active: true,
  doneAt: null,
  canceledAt: null,
  ...over,
})

test('activity: due states use the caller local date, not a server instant', () => {
  assert.equal(stateOf(activity({ dueDate: '2026-08-19' }), '2026-08-20'), 'overdue')
  assert.equal(stateOf(activity(), '2026-08-20'), 'today')
  assert.equal(stateOf(activity({ dueDate: '2026-08-21' }), '2026-08-20'), 'planned')
  assert.equal(stateOf(activity({ doneAt: '2026-08-20T00:01:00.000Z' }), '2026-08-19'), 'done')
  assert.equal(
    stateOf(activity({ active: false, canceledAt: '2026-08-20T00:01:00.000Z' }), '2026-08-21'),
    'canceled',
  )
})

test('activity: chained due dates are calendar arithmetic across month and leap boundaries', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
})
