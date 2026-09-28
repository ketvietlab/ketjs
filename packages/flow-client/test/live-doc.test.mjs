import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixtureSession } from '../atlas/store.mjs'

test('task rich description is saved atomically with plain projection and survives subsequent edits', () => {
  const f = createFixtureSession()
  const t = f.data.tasks.find((t) => t.id === 'KV-150')
  const r = f.call('flow.issue.save', {
    id: t.id,
    expectedVersion: t.version,
    idempotencyKey: 'rich',
    description: 'Updated rich text',
    descriptionDoc: 'snapshot',
  })
  assert.notEqual(r.value?.ok, false)
  assert.equal(t.descriptionDoc, 'snapshot')
  assert.equal(t.description, 'Updated rich text')
  f.call('flow.issue.save', {
    id: t.id,
    expectedVersion: t.version,
    idempotencyKey: 'other',
    priority: 'normal',
  })
  assert.equal(t.descriptionDoc, 'snapshot')
})
test('document rich body survives metadata changes, permission checks still apply', () => {
  const f = createFixtureSession()
  const p = f.data.pages[0]
  f.call('flow.entity.save', {
    collection: 'pages',
    entityId: p.id,
    title: p.title,
    projectId: p.projectId,
    parentId: p.parentId,
    liveDoc: 'snapshot',
    blocks: [{ id: 'a', type: 'paragraph', text: 'body' }],
    description: 'body',
    idempotencyKey: 'doc',
  })
  assert.equal(p.liveDoc, 'snapshot')
  assert.equal(p.blocks[0].text, 'body')
  const readonly = createFixtureSession('readonly')
  const task = readonly.data.tasks[0]
  const r = readonly.call('flow.issue.save', {
    id: task.id,
    descriptionDoc: 'changed',
    expectedVersion: task.version,
  })
  assert.equal(r.value.ok, false)
  assert.notEqual(task.descriptionDoc, 'changed')
})
