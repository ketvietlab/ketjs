import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixtureSession } from '../atlas/store.mjs'
import { documentSiblings, filterDocumentTree } from '@ketvietlab/flow-client/document-tree.mjs'
const move = (s, id, targetId, extra = {}) =>
  s.call('flow.page.reorder', {
    id,
    targetId,
    position: 'before',
    expectedSiblingIds: documentSiblings(
      s.data.pages,
      s.data.pages.find((p) => p.id === id),
    ).map((p) => p.id),
    idempotencyKey: crypto.randomUUID(),
    ...extra,
  })
test('manual sibling order persists without changing parents, descendants or other scopes; replay is stable', () => {
  const s = createFixtureSession()
  s.data.pages.push({ id: 'child', parentId: 'release-next', projectId: 'core', title: 'Child' })
  const parents = s.data.pages.map((p) => [p.id, p.parentId])
  const key = crypto.randomUUID()
  const before = documentSiblings(
    s.data.pages,
    s.data.pages.find((p) => p.id === 'release-next'),
  ).map((p) => p.id)
  assert.equal(move(s, 'release-next', 'checklist', { idempotencyKey: key }).value.ok, true)
  assert.deepEqual(
    documentSiblings(
      s.data.pages,
      s.data.pages.find((p) => p.id === 'checklist'),
    ).map((p) => p.id),
    ['release-next', 'checklist', 'release-copy'],
  )
  for (const [id, parent] of parents) assert.equal(s.data.pages.find((p) => p.id === id).parentId, parent)
  const order = s.data.pages.map((p) => p.id)
  assert.equal(
    move(s, 'release-next', 'checklist', { idempotencyKey: key, expectedSiblingIds: before }).value.ok,
    true,
  )
  assert.deepEqual(
    s.data.pages.map((p) => p.id),
    order,
  )
  assert.equal(
    move(s, 'checklist', 'release-copy', { expectedSiblingIds: before }).value.errors[0].code,
    'conflict',
  )
})
test('reorder rejects different parents, projects, visibility, archives, missing targets and read-only access', () => {
  const s = createFixtureSession()
  for (const [id, target] of [
    ['checklist', 'handoff'],
    ['handoff', 'onboarding'],
    ['handoff', 'private-notes'],
    ['handoff', 'missing'],
  ]) {
    const before = structuredClone(s.data.pages)
    assert.equal(move(s, id, target).value.ok, false)
    assert.deepEqual(s.data.pages, before)
  }
  s.data.pages.find((p) => p.id === 'release-copy').archived = true
  assert.equal(move(s, 'checklist', 'release-copy').value.ok, false)
  assert.equal(
    move(createFixtureSession('readonly'), 'checklist', 'release-copy').value.errors[0].code,
    'forbidden',
  )
})
test('search preserves ancestors and canonical order without flattening or alphabetic sorting', () => {
  const pages = [
    { id: 'z', title: 'Z', parentId: null },
    { id: 'a', title: 'A', parentId: 'z' },
    { id: 'x', title: 'X', parentId: null },
  ]
  assert.deepEqual(
    filterDocumentTree(pages, (p) => p.title === 'A').map((p) => p.id),
    ['z', 'a'],
  )
  assert.deepEqual(
    filterDocumentTree(pages, () => true).map((p) => p.id),
    ['z', 'a', 'x'],
  )
})
