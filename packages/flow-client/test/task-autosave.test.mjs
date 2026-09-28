import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTaskAutosave } from '@ketvietlab/flow-client/task-autosave.mjs'
import { taskCreatePayload } from '@ketvietlab/flow-client/task-composer.mjs'
import { createFixtureSession } from '../atlas/store.mjs'

test('autosave preserves rapid edits while a request is in flight', async () => {
  const calls = []
  let release
  const first = new Promise((resolve) => {
    release = resolve
  })
  const saver = createTaskAutosave({
    save: async (id, patch) => {
      calls.push({ id, patch })
      if (calls.length === 1) await first
    },
  })
  saver.edit('KV-142', { assignee: 'Trần Quốc Bảo' })
  saver.edit('KV-142', { priority: 'urgent' })
  saver.edit('KV-142', { sprint: 'Sprint 13' })
  assert.equal(saver.state('KV-142'), 'saving')
  release()
  await saver.flush('KV-142')
  assert.deepEqual(
    calls.map((c) => c.patch),
    [{ assignee: 'Trần Quốc Bảo' }, { priority: 'urgent', sprint: 'Sprint 13' }],
  )
  assert.deepEqual(saver.draft('KV-142'), {})
  assert.equal(saver.state('KV-142'), 'saved')
})
test('failed autosave retains changes for retry and isolates different tasks', async () => {
  let failing = true
  const calls = []
  const saver = createTaskAutosave({
    save: async (id, patch) => {
      if (failing) throw new Error('Offline')
      calls.push({ id, patch })
    },
  })
  saver.edit('KV-142', { priority: 'high' }, { delay: 1000 })
  await saver.flush('KV-142')
  assert.equal(saver.state('KV-142'), 'error')
  assert.equal(saver.draft('KV-142').priority, 'high')
  assert.deepEqual(saver.draft('KV-131'), {})
  failing = false
  await saver.flush('KV-142')
  assert.equal(saver.state('KV-142'), 'saved')
  assert.deepEqual(calls, [{ id: 'KV-142', patch: { priority: 'high' } }])
  saver.dispose()
})
test('creation captures description, properties, checklist, children and attachment metadata', () => {
  const f = createFixtureSession()
  const payload = taskCreatePayload(
    {
      title: 'Release task',
      description: 'Acceptance criteria',
      projectId: 'core',
      assignee: 'Mai Anh',
      priority: 'high',
      status: 'todo',
      sprint: 'Sprint 13',
      startDate: '2026-09-22',
      dueDate: '2026-09-25',
      points: '5',
      tags: ['tech', 'release'],
      checklist: 'Verify list\nVerify board',
      subtasks: 'Review UI\nReview API',
      dependency: 'KV-144',
    },
    { files: [{ name: 'brief.txt', size: 1024 }] },
  )
  const result = f.call('flow.issue.save', { ...payload, idempotencyKey: 'create-complete' })
  assert.equal(result.value.id, 'KV-160')
  const task = f.data.tasks.find((t) => t.id === 'KV-160')
  assert.equal(task.description, 'Acceptance criteria')
  assert.equal(task.sprint, 'Sprint 13')
  assert.equal(task.due, '25/09')
  assert.equal(task.points, 5)
  assert.deepEqual(task.tags, ['tech', 'release'])
  assert.equal(task.checklist.length, 2)
  assert.equal(f.data.tasks.filter((t) => t.parentId === task.id).length, 2)
  assert.equal(f.data.files.find((file) => file.taskId === task.id).title, 'brief.txt')
  f.call('flow.issue.save', { ...payload, idempotencyKey: 'create-complete' })
  assert.equal(f.data.tasks.filter((t) => t.parentId === task.id).length, 2)
})
test('partial autosaves keep description and use versions; status cannot bypass blockers', () => {
  const f = createFixtureSession()
  const task = f.data.tasks.find((t) => t.id === 'KV-142')
  const description = task.description
  f.call('flow.issue.save', {
    id: task.id,
    priority: 'urgent',
    expectedVersion: 1,
    idempotencyKey: 'p',
  })
  assert.equal(task.priority, 'urgent')
  assert.equal(task.description, description)
  assert.equal(task.version, 2)
  const blocked = f.call('flow.issue.save', {
    id: task.id,
    status: 'done',
    expectedVersion: 2,
    idempotencyKey: 's',
  })
  assert.equal(blocked.value.errors[0].code, 'blocked')
  assert.notEqual(task.status, 'done')
  const stale = f.call('flow.issue.save', {
    id: task.id,
    sprint: 'Sprint 13',
    expectedVersion: 1,
    idempotencyKey: 'stale',
  })
  assert.equal(stale.value.errors[0].code, 'conflict')
})

test('context switch flushes every delayed task patch before changing Company', async () => {
  const calls = []
  const saver = createTaskAutosave({ save: async (id, patch) => calls.push({ id, patch }) })
  saver.edit('A', { priority: 'high' }, { delay: 1000 })
  saver.edit('B', { sprint: 'Sprint 13' }, { delay: 1000 })
  await saver.flushAll()
  assert.deepEqual(calls, [
    { id: 'A', patch: { priority: 'high' } },
    { id: 'B', patch: { sprint: 'Sprint 13' } },
  ])
  assert.equal(saver.state('A'), 'saved')
  assert.equal(saver.state('B'), 'saved')
  saver.dispose()
})
