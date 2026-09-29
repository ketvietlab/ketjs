import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import { calendarPeriod } from '@ketvietlab/flow-client/operations-model.mjs'
const read = (s) => s.call('flow.workspace.bootstrap', { companyId: 'demo', workspaceId: 'product' }).value
let n = 0
const run = (s, action, args = {}) =>
  s.call('flow.operations.command', {
    companyId: 'demo',
    workspaceId: 'product',
    projectId: 'core',
    expectedRevision: read(s).operationsRevision,
    idempotencyKey: 'op-' + ++n,
    action,
    ...args,
  }).value
test('published form validates answers, creates mapped task and records response', () => {
  const s = createOrganizationSession(),
    result = run(s, 'form.save', {
      title: 'Tiếp nhận',
      access: 'project',
      assignee: 'Mai Anh',
      priority: 'high',
      publish: true,
      fields: [{ label: 'Số lượng', type: 'number', required: true }],
    })
  assert.ok(result.id, JSON.stringify(result))
  const before = read(s).tasks.length
  assert.equal(
    run(s, 'form.submit', { id: result.id, title: 'Yêu cầu', answers: { 'field-0': 'abc' } }).ok,
    false,
  )
  assert.equal(read(s).tasks.length, before)
  const response = run(s, 'form.submit', {
    id: result.id,
    title: 'Yêu cầu hợp lệ',
    answers: { 'field-0': '3' },
  })
  assert.ok(response.id, JSON.stringify(response))
  const d = read(s),
    t = d.tasks.find((t) => t.id === response.id)
  assert.equal(t.assignee, 'Mai Anh')
  assert.equal(t.priority, 'high')
  assert.equal(d.formResponses[0].taskId, t.id)
  assert.equal(d.quality, undefined)
})

test('calendar uses real month boundaries', () => {
  assert.equal(calendarPeriod('2028-02-17', 'month').end, '2028-02-29')
  assert.equal(calendarPeriod('2026-09-23', 'week').start, '2026-09-21')
})
test('operations reject stale revisions and unprivileged configuration changes', () => {
  const s = createOrganizationSession()
  const d = read(s)
  assert.equal(
    s.call('flow.operations.command', {
      companyId: 'demo',
      action: 'inbox.read',
      ids: [],
      expectedRevision: 0,
      idempotencyKey: 'stale',
    }).value.ok,
    false,
  )
  assert.equal(read(s).operationsRevision, d.operationsRevision)
  const ro = createOrganizationSession('readonly')
  assert.equal(run(ro, 'form.save', { title: 'Unauthorized' }).ok, false)
})
test('batch grants validate every subject before changing sources', () => {
  const s = createOrganizationSession(),
    before = read(s),
    base = {
      companyId: 'demo',
      action: 'access.grant',
      scope: 'project',
      targetId: 'core',
      subjectType: 'user',
      role: 'viewer',
      expectedRevision: before.organizationRevision,
    }
  const invalid = s.call('flow.organization.command', {
    ...base,
    subjectIds: ['bao', 'missing'],
    idempotencyKey: 'invalid-batch',
  }).value
  assert.equal(invalid.ok, false)
  assert.deepEqual(read(s).grants, before.grants)
  const valid = s.call('flow.organization.command', {
    ...base,
    subjectIds: ['bao', 'ha'],
    idempotencyKey: 'valid-batch',
  }).value
  assert.notEqual(valid.ok, false)
  assert.equal(
    read(s).grants.filter(
      (g) => g.targetId === 'core' && g.subjectType === 'user' && ['bao', 'ha'].includes(g.subjectId),
    ).length,
    2,
  )
})
test('closing sprint records commitment and carries work only within its project', () => {
  const s = createOrganizationSession(),
    d = read(s),
    sprint = d.sprints.find((s) => s.state === 'active')
  assert.ok(sprint)
  const result = s.call('flow.entity.action', {
    companyId: 'demo',
    projectId: sprint.projectId,
    collection: 'sprints',
    entityId: sprint.id,
    action: 'close',
    carryTo: 'Backlog',
    idempotencyKey: 'sprint-close-preview',
  }).value
  assert.notEqual(result.ok, false)
  const report = read(s).sprints.find((x) => x.id === sprint.id).report
  assert.ok(report)
  assert.ok(Array.isArray(report.taskIds))
  assert.equal(report.carryTo, 'Backlog')
  assert.ok(report.tasks.length)
  const frozen = structuredClone(report.tasks)
  const task = report.tasks[0]
  s.call('flow.issue.save', {
    companyId: 'demo',
    id: task.id,
    projectId: sprint.projectId,
    title: 'Changed after close',
    idempotencyKey: 'after-close',
  })
  assert.deepEqual(read(s).sprints.find((x) => x.id === sprint.id).report.tasks, frozen)
})
test('configured task fields survive save and validate required completion values', () => {
  const s = createOrganizationSession(),
    result = s.call('flow.entity.save', {
      companyId: 'demo',
      collection: 'fields',
      title: 'Kênh yêu cầu',
      kind: 'select',
      options: 'Email\nChat',
      required: 'true',
      appliesTo: 'core',
      idempotencyKey: 'field-config',
    }).value
  assert.ok(result.id, JSON.stringify(result))
  const task = read(s).tasks.find((t) => t.projectId === 'core' && !t.blockedBy.length && t.status !== 'done')
  assert.ok(task)
  const base = { companyId: 'demo', id: task.id, projectId: 'core', status: 'done' }
  assert.equal(s.call('flow.issue.save', { ...base, idempotencyKey: 'field-required' }).value.ok, false)
  assert.equal(
    s.call('flow.issue.save', {
      ...base,
      customFields: { [result.id]: 'Unknown' },
      idempotencyKey: 'field-invalid',
    }).value.ok,
    false,
  )
  assert.notEqual(
    s.call('flow.issue.save', {
      ...base,
      status: task.status,
      customFields: { [result.id]: 'Email' },
      idempotencyKey: 'field-valid',
    }).value.ok,
    false,
  )
  assert.equal(read(s).tasks.find((t) => t.id === task.id).customFields[result.id], 'Email')
})
