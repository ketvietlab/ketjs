import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  routeScope,
  pagesInScope,
  libraryReturn,
  managementNavigation,
  managementTabs,
} from '@ketvietlab/flow-client/navigation.mjs'
import { createFixtureSession } from '../atlas/store.mjs'

test('route ownership never depends on a remembered project; library return is constrained locally', () => {
  for (const key of ['all-pages', 'workspace-settings', 'tags', 'column-edit'])
    assert.equal(routeScope(key), 'workspace')
  for (const key of ['settings', 'github', 'automations', 'forms', 'pages'])
    assert.equal(routeScope(key), 'project')
  assert.equal(routeScope('page', 'workspace'), 'workspace')
  assert.equal(routeScope('personal-settings'), 'personal')
  assert.equal(
    libraryReturn('/flow/all-pages?projectFilter=ops&docq=test'),
    '/flow/all-pages?projectFilter=ops&docq=test',
  )
  assert.equal(libraryReturn('https://example.com/flow/all-pages'), '')
  assert.equal(libraryReturn('//example.com/flow/all-pages'), '')
  assert.equal(libraryReturn('/flow/settings?project=core'), '')
  const f = createFixtureSession()
  assert.ok(pagesInScope(f.data.pages, 'ops').every((p) => p.projectId === 'ops'))
  assert.deepEqual(
    pagesInScope(f.data.pages, null).map((p) => p.id),
    ['workspace-guide'],
  )
})
test('document creation, editing and moves retain ownership and reject cross-scope parents/cycles', () => {
  const f = createFixtureSession()
  const save = (args) =>
    f.call('flow.entity.save', { collection: 'pages', idempotencyKey: crypto.randomUUID(), ...args }).value
  const created = save({ title: 'Shared page', projectId: null })
  assert.ok(created.id)
  assert.equal(f.data.pages.find((p) => p.id === created.id).projectId, null)
  const child = save({ title: 'Private child', projectId: 'core', parentId: 'private-notes' })
  assert.equal(f.data.pages.find((p) => p.id === child.id).visibility, 'private')
  assert.equal(
    save({ title: 'Wrong owner', projectId: 'ops', parentId: 'handoff' }).errors[0].code,
    'validation',
  )
  assert.equal(
    save({ title: 'Wrong owner edit', entityId: 'handoff', projectId: 'ops' }).errors[0].code,
    'validation',
  )
  const move = (entityId, parentId) =>
    f.call('flow.entity.action', {
      collection: 'pages',
      entityId,
      parentId,
      action: 'move',
      idempotencyKey: crypto.randomUUID(),
    }).value
  assert.equal(move('handoff', 'checklist').errors[0].code, 'cycle')
  assert.equal(move('handoff', 'ops-handbook').errors[0].code, 'validation')
  assert.equal(move('workspace-guide', 'handoff').errors[0].code, 'validation')
})
test('project tools require a valid owner on creation and action', () => {
  const f = createFixtureSession()
  const save = (args) =>
    f.call('flow.entity.save', {
      collection: 'forms',
      title: 'Rule',
      idempotencyKey: crypto.randomUUID(),
      ...args,
    }).value
  assert.equal(save({}).errors[0].code, 'validation')
  const created = save({ projectId: 'ops' })
  assert.equal(f.data.forms.find((a) => a.id === created.id).projectId, 'ops')
  assert.equal(
    f.call('flow.entity.action', {
      collection: 'forms',
      entityId: created.id,
      projectId: 'core',
      action: 'toggle',
      idempotencyKey: crypto.randomUUID(),
    }).value.errors[0].code,
    'validation',
  )
})

test('management tabs keep workspace and company destinations distinct, including child pages', () => {
  for (const [scope, options] of Object.entries(managementTabs))
    for (const option of options) {
      const nav = managementNavigation(option.value)
      assert.equal(nav.scope, scope)
      assert.equal(nav.active, option.value)
    }
  assert.equal(managementNavigation('team').active, 'teams')
  assert.equal(managementNavigation('tags').active, 'organization-settings')
  for (const route of ['board', 'settings', 'performance', 'my-work'])
    assert.equal(managementNavigation(route), null)
})
