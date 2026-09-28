import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixtureSession } from '../atlas/store.mjs'

test('task labels keep identity across rename/color changes and reject invalid selection', () => {
  const f = createFixtureSession()
  const task = f.data.tasks.find((t) => t.id === 'KV-142')
  const saved = f.call('flow.issue.save', {
    id: task.id,
    tags: ['tech', 'release'],
    expectedVersion: task.version,
    idempotencyKey: 'select',
  })
  assert.equal(saved.value.ok, true)
  assert.deepEqual(task.tags, ['tech', 'release'])
  f.call('flow.entity.save', {
    collection: 'tags',
    entityId: 'tech',
    title: 'Kỹ thuật',
    color: 'yellow',
    idempotencyKey: 'rename',
  })
  assert.deepEqual(task.tags, ['tech', 'release'])
  assert.equal(f.data.tags.find((t) => t.id === task.tags[0]).color, 'yellow')
  for (const [key, tags] of [
    ['unknown', ['missing']],
    ['duplicate', ['tech', 'tech']],
    ['text', 'tech,release'],
  ]) {
    assert.equal(
      f.call('flow.issue.save', { id: task.id, tags, idempotencyKey: key }).value.errors[0].code,
      'validation',
    )
  }
  assert.deepEqual(task.tags, ['tech', 'release'])
  f.call('flow.entity.action', {
    collection: 'tags',
    entityId: 'tech',
    action: 'archive',
    idempotencyKey: 'archive',
  })
  assert.equal(
    f.call('flow.issue.save', { id: task.id, tags: ['tech'], idempotencyKey: 'retain' }).value.ok,
    true,
  )
  f.call('flow.issue.save', { id: task.id, tags: [], idempotencyKey: 'clear' })
  assert.deepEqual(task.tags, [])
  assert.equal(
    f.call('flow.issue.save', { id: task.id, tags: ['tech'], idempotencyKey: 're-add' }).value.errors[0].code,
    'validation',
  )
})
test('label configuration rejects duplicate names and unknown colors; read-only cannot write', () => {
  const f = createFixtureSession()
  for (const [key, args] of [
    ['color', { title: 'UX', color: '#ff0000' }],
    ['name', { title: 'Nợ kỹ thuật', color: 'blue' }],
  ]) {
    assert.equal(
      f.call('flow.entity.save', { collection: 'tags', ...args, idempotencyKey: key }).value.errors[0].code,
      'validation',
    )
  }
  const read = createFixtureSession('readonly')
  assert.equal(
    read.call('flow.issue.save', { id: 'KV-142', tags: [], idempotencyKey: 'readonly' }).value.errors[0].code,
    'forbidden',
  )
})
