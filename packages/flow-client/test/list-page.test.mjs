import test from 'node:test'
import assert from 'node:assert/strict'
import { sortedListTasks, taskPage } from '@ketvietlab/flow-client/task-order.mjs'
test('list sorting prioritizes dates, resolves priority ties, leaves undated last and preserves manual order', () => {
  const tasks = [
    { id: 'none', order: 0, priority: 'urgent' },
    { id: 'later', order: 1, dueDate: '2026-10-01', priority: 'high' },
    { id: 'normal', order: 3, dueDate: '2026-09-01', priority: 'normal' },
    { id: 'urgent', order: 2, dueDate: '2026-09-01', priority: 'urgent' },
  ]
  assert.deepEqual(
    sortedListTasks(tasks).map((t) => t.id),
    ['urgent', 'normal', 'later', 'none'],
  )
  assert.deepEqual(
    sortedListTasks(tasks, 'manual').map((t) => t.id),
    ['none', 'later', 'urgent', 'normal'],
  )
  assert.deepEqual(
    sortedListTasks(tasks, 'priority').map((t) => t.id),
    ['urgent', 'none', 'later', 'normal'],
  )
  assert.equal(tasks[0].id, 'none')
})
test('progressive groups reveal ten at a time without losing or repeating tasks', () => {
  const tasks = Array.from({ length: 23 }, (_, id) => ({ id }))
  assert.equal(taskPage(tasks).visible.length, 10)
  assert.equal(taskPage(tasks).remaining, 13)
  assert.equal(taskPage(tasks, 20).remaining, 3)
  assert.deepEqual(taskPage(tasks, 30).visible, tasks)
  assert.equal(taskPage([]).remaining, 0)
})
