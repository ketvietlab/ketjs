import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import {
  taskAssigneeIds,
  taskUsers,
  isAssignedTo,
  assignableUsers,
} from '@ketvietlab/flow-client/task-assignees.mjs'
import { taskGroups, taskGroupValue } from '@ketvietlab/flow-client/task-order.mjs'
import { taskCreatePayload } from '@ketvietlab/flow-client/task-composer.mjs'
const read = (s) => s.call('flow.workspace.bootstrap', { companyId: 'demo' }).value
const save = (s, id, patch) =>
  s.call('flow.issue.save', {
    companyId: 'demo',
    id,
    expectedVersion: read(s).tasks.find((t) => t.id === id)?.version,
    idempotencyKey: crypto.randomUUID(),
    ...patch,
  }).value
test('multiple assignees persist by ID, appear in each person’s work', () => {
  const s = createOrganizationSession(),
    before = read(s),
    t = before.tasks.find((t) => t.projectId === 'core' && t.status === 'progress')

  assert.equal(save(s, t.id, { assigneeIds: ['mai', 'bao'] }).ok, true)
  const d = read(s),
    now = d.tasks.find((x) => x.id === t.id)
  assert.deepEqual(taskAssigneeIds(d, now), ['mai', 'bao'])
  assert.equal(isAssignedTo(d, now, 'mai'), true)
  assert.equal(isAssignedTo(d, now, 'bao'), true)
  assert.deepEqual(
    taskUsers(d, now).map((u) => u.name),
    ['Mai Anh', 'Trần Quốc Bảo'],
  )
  assert.ok(d.history.some((h) => h.taskId === t.id && h.text.includes('Mai Anh, Trần Quốc Bảo')))
  assert.equal(save(s, t.id, { assigneeIds: [] }).ok, true)
  assert.deepEqual(read(s).tasks.find((x) => x.id === t.id).assigneeIds, [])
})
test('invalid IDs, duplicates, people without access, stale and readonly saves never partly assign', () => {
  const s = createOrganizationSession(),
    t = read(s).tasks.find((t) => t.projectId === 'core')
  save(s, t.id, { assigneeIds: ['mai'] })
  const before = read(s).tasks.find((x) => x.id === t.id)
  for (const ids of [['mai', 'missing'], ['mai', 'mai'], ['mai', 'guest'], ['mai', 'ha'], 'mai']) {
    assert.equal(save(s, t.id, { assigneeIds: ids }).ok, false)
    assert.deepEqual(
      read(s).tasks.find((x) => x.id === t.id),
      before,
    )
  }
  assert.equal(save(s, t.id, { assigneeIds: ['bao'], expectedVersion: 0 }).ok, false)
  const readonly = createOrganizationSession('readonly')
  assert.equal(save(readonly, t.id, { assigneeIds: ['bao'] }).ok, false)
  assert.deepEqual(
    assignableUsers(read(s), 'core').map((u) => u.id),
    ['mai', 'bao'],
  )
})
test('task creation/subtasks and legacy assignment normalize to the same ID array', () => {
  const s = createOrganizationSession()
  const payload = taskCreatePayload({
    title: 'Paired work',
    projectId: 'core',
    assigneeIds: ['mai', 'bao'],
    subtasks: 'Child task',
  })
  const created = save(s, undefined, payload)
  assert.ok(created.id)
  const d = read(s),
    t = d.tasks.find((t) => t.id === created.id)
  assert.deepEqual(t.assigneeIds, ['mai', 'bao'])
  assert.deepEqual(d.tasks.find((x) => x.parentId === t.id).assigneeIds, ['mai', 'bao'])
  assert.equal(save(s, t.id, { assignee: 'Trần Quốc Bảo' }).ok, true)
  assert.deepEqual(read(s).tasks.find((x) => x.id === t.id).assigneeIds, ['bao'])
})
test('exact-assignee-set grouping places each task once, retains the set on reordering and can move to unassigned', () => {
  const s = createOrganizationSession(),
    d = read(s),
    tasks = d.tasks
      .filter((t) => t.projectId === 'core' && ['progress', 'todo'].includes(t.status))
      .slice(0, 2)
  for (const t of tasks) assert.equal(save(s, t.id, { assigneeIds: ['mai', 'bao'] }).ok, true)
  let current = read(s),
    group = taskGroups(current, 'assignee', 'core').find((g) => g.assigneeIds.length === 2)
  assert.ok(group)
  assert.equal(
    taskGroups(current, 'assignee', 'core').filter(
      (g) =>
        g.id ===
        taskGroupValue(
          current.tasks.find((t) => t.id === tasks[0].id),
          'assignee',
        ),
    ).length,
    1,
  )
  const move = (id, value, targetId = null) =>
    s.call('flow.issue.reorder', {
      companyId: 'demo',
      id,
      groupBy: 'assignee',
      groupValue: value,
      targetId,
      position: 'after',
      expectedVersion: current.tasks.find((t) => t.id === id).version,
      expectedOrderRevision: current.taskOrderRevision,
      idempotencyKey: crypto.randomUUID(),
    }).value
  assert.equal(move(tasks[0].id, group.id, tasks[1].id).ok, true)
  current = read(s)
  assert.deepEqual(current.tasks.find((t) => t.id === tasks[0].id).assigneeIds, ['mai', 'bao'])
  assert.equal(move(tasks[0].id, '').ok, true)
  assert.deepEqual(read(s).tasks.find((t) => t.id === tasks[0].id).assigneeIds, [])
})
