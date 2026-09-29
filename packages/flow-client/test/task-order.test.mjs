import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixtureSession } from '../atlas/store.mjs'
import { orderedTasks } from '@ketvietlab/flow-client/task-order.mjs'
const move = (f, id, targetId, field, value, position = 'before', extra = {}) =>
  f.call('flow.issue.reorder', {
    id,
    targetId,
    position,
    groupBy: field,
    groupValue: value,
    expectedVersion: f.data.tasks.find((t) => t.id === id)?.version,
    expectedOrderRevision: f.data.taskOrderRevision,
    idempotencyKey: crypto.randomUUID(),
    ...extra,
  }).value

test('ordering inserts before/after, updates the group atomically and preserves other tasks', () => {
  const f = createFixtureSession()
  const before = orderedTasks(f.data.tasks)
    .filter((t) => t.id !== 'KV-147')
    .map((t) => t.id)
  assert.equal(move(f, 'KV-147', 'KV-142', 'status', 'progress').ok, true)
  const rows = orderedTasks(f.data.tasks)
  assert.equal(rows[rows.findIndex((t) => t.id === 'KV-142') - 1].id, 'KV-147')
  assert.equal(f.data.tasks.find((t) => t.id === 'KV-147').status, 'progress')
  assert.deepEqual(
    rows.filter((t) => t.id !== 'KV-147').map((t) => t.id),
    before,
  )
  assert.equal(move(f, 'KV-147', 'KV-142', 'status', 'progress', 'after').ok, true)
  assert.equal(
    orderedTasks(f.data.tasks)[orderedTasks(f.data.tasks).findIndex((t) => t.id === 'KV-142') + 1].id,
    'KV-147',
  )
  assert.equal(move(f, 'KV-147', null, 'assignee', '').ok, true)
  assert.equal(f.data.tasks.find((t) => t.id === 'KV-147').assignee, '')
  assert.equal(move(f, 'KV-147', null, 'priority', 'urgent').ok, true)
  assert.equal(f.data.tasks.find((t) => t.id === 'KV-147').priority, 'urgent')
  assert.equal(move(f, 'KV-147', null, 'sprint', 'Backlog').ok, true)
  assert.equal(f.data.tasks.find((t) => t.id === 'KV-147').sprint, 'Backlog')
  const status = f.data.tasks.find((t) => t.id === 'KV-147').status
  assert.equal(move(f, 'KV-147', 'KV-142', 'none', '').ok, true)
  assert.equal(f.data.tasks.find((t) => t.id === 'KV-147').status, status)
})
test('blocked, invalid, stale and read-only drops leave order and properties unchanged', () => {
  const f = createFixtureSession()
  const initial = structuredClone(f.data.tasks)
  for (const [field, value, target] of [
    ['status', 'done', null],
    ['status', 'fake', null],
    ['projectId', 'ops', null],
    ['status', 'progress', 'missing'],
    ['status', 'todo', 'KV-142'],
  ]) {
    assert.ok(move(f, 'KV-142', target, field, value).errors)
    assert.deepEqual(f.data.tasks, initial)
  }
  assert.equal(
    move(f, 'KV-147', null, 'status', 'progress', 'after', { expectedOrderRevision: 99 }).errors[0].code,
    'conflict',
  )
  const read = createFixtureSession('readonly')
  assert.equal(move(read, 'KV-147', null, 'status', 'progress').errors[0].code, 'forbidden')
})
test('replay is stable and a stale order cannot overwrite a preceding drag', () => {
  const f = createFixtureSession()
  const args = {
    id: 'KV-147',
    targetId: 'KV-142',
    position: 'before',
    groupBy: 'status',
    groupValue: 'progress',
    expectedVersion: 1,
    expectedOrderRevision: 0,
    idempotencyKey: 'same-drag',
  }
  assert.equal(f.call('flow.issue.reorder', args).value.ok, true)
  const snapshot = structuredClone(f.data.tasks)
  assert.equal(f.call('flow.issue.reorder', args).value.ok, true)
  assert.deepEqual(f.data.tasks, snapshot)
  assert.equal(f.data.taskOrderRevision, 1)
  assert.equal(
    f.call('flow.issue.reorder', { ...args, idempotencyKey: 'stale-drag' }).value.errors[0].code,
    'conflict',
  )
})

const batchMove = (f, ids, targetId, field, value, extra = {}) =>
  f.call('flow.issue.reorder', {
    id: ids[0],
    ids,
    targetId,
    position: 'before',
    groupBy: field,
    groupValue: value,
    expectedVersions: Object.fromEntries(
      ids.map((id) => [id, f.data.tasks.find((t) => t.id === id)?.version]),
    ),
    expectedOrderRevision: f.data.taskOrderRevision,
    idempotencyKey: crypto.randomUUID(),
    ...extra,
  }).value
test('multi-drag preserves relative order, inserts as one block, updates every task and replays once', () => {
  const f = createFixtureSession(),
    ids = ['KV-147', 'KV-151'],
    old = orderedTasks(f.data.tasks),
    sequence = old.filter((t) => ids.includes(t.id)).map((t) => t.id),
    others = old.filter((t) => !ids.includes(t.id)).map((t) => t.id)
  const args = {
    idempotencyKey: 'batch',
    expectedVersions: Object.fromEntries(
      ids.map((id) => [id, f.data.tasks.find((t) => t.id === id).version]),
    ),
  }
  const result = batchMove(f, ids, 'KV-142', 'status', 'progress', args)
  assert.equal(result.ok, true)
  const now = orderedTasks(f.data.tasks),
    target = now.findIndex((t) => t.id === 'KV-142')
  assert.deepEqual(
    now.slice(target - ids.length, target).map((t) => t.id),
    sequence,
  )
  assert.deepEqual(
    now.filter((t) => !ids.includes(t.id)).map((t) => t.id),
    others,
  )
  for (const id of ids) {
    const t = now.find((t) => t.id === id)
    assert.equal(t.status, 'progress')
    assert.equal(t.version, args.expectedVersions[id] + 1)
    assert.ok(f.data.history.some((h) => h.taskId === id))
  }
  const snapshot = structuredClone(f.data.tasks)
  assert.deepEqual(batchMove(f, ids, 'KV-142', 'status', 'progress', args), result)
  assert.deepEqual(f.data.tasks, snapshot)
  assert.equal(f.data.taskOrderRevision, 1)
  assert.equal(batchMove(f, ids, null, 'priority', 'urgent').ok, true)
  assert.ok(ids.every((id) => f.data.tasks.find((t) => t.id === id).priority === 'urgent'))
})
test('multi-drag fails atomically for blocked, stale, invalid and archived selections', () => {
  for (const patch of [
    { groupBy: 'status', groupValue: 'done' },
    { expectedVersions: { 'KV-142': 99, 'KV-147': 1 } },
    { targetId: 'KV-142' },
    { ids: ['KV-142', 'missing'] },
    { ids: ['KV-142', 'KV-142'] },
    { groupBy: 'status', groupValue: 'missing' },
  ]) {
    const f = createFixtureSession(),
      before = structuredClone(f.data.tasks),
      revision = f.data.taskOrderRevision
    assert.equal(batchMove(f, ['KV-142', 'KV-147'], null, 'priority', 'urgent', patch).ok, false)
    assert.deepEqual(f.data.tasks, before)
    assert.equal(f.data.taskOrderRevision, revision)
  }
  const f = createFixtureSession()
  f.data.tasks.find((t) => t.id === 'KV-147').archived = true
  const before = structuredClone(f.data.tasks)
  assert.equal(batchMove(f, ['KV-142', 'KV-147'], null, 'priority', 'urgent').ok, false)
  assert.deepEqual(f.data.tasks, before)
})
test('multi-drag can complete selected dependencies together but honors required fields', () => {
  const f = createFixtureSession(),
    task = f.data.tasks.find((t) => t.id === 'KV-142'),
    ids = [...new Set([task.id, ...task.blockedBy])]
  assert.equal(batchMove(f, ids, null, 'status', 'done').ok, true)
  const g = createFixtureSession()
  g.data.fields.push({
    id: 'required-check',
    title: 'Kết quả',
    kind: 'text',
    required: true,
    appliesTo: 'all',
  })
  const before = structuredClone(g.data.tasks)
  assert.equal(batchMove(g, ['KV-147', 'KV-151'], null, 'status', 'done').ok, false)
  assert.deepEqual(g.data.tasks, before)
})

test('multi-drag checks write permission for every selected task, not just the grabbed row', async () => {
  const { createOrganizationSession } = await import('../atlas/organization-store.mjs')
  const s = createOrganizationSession('member'),
    d = s.sessions.get('demo').data
  const ids = ['KV-147', 'KV-129'],
    before = structuredClone(d.tasks)
  const result = s.call('flow.issue.reorder', {
    companyId: 'demo',
    id: ids[0],
    ids,
    expectedVersions: Object.fromEntries(ids.map((id) => [id, d.tasks.find((t) => t.id === id).version])),
    expectedOrderRevision: d.taskOrderRevision,
    targetId: null,
    position: 'after',
    groupBy: 'priority',
    groupValue: 'urgent',
    idempotencyKey: 'mixed-access',
  }).value
  assert.equal(result.ok, false)
  assert.equal(result.errors[0].code, 'forbidden')
  assert.deepEqual(d.tasks, before)
})
