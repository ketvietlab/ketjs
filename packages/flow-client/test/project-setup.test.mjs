import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import { workspaceInheritance } from '@ketvietlab/flow-client/project-setup.mjs'
const read = (s) => s.call('flow.workspace.bootstrap', { companyId: 'demo' }).value
const args = {
  companyId: 'demo',
  collection: 'projects',
  title: 'Website',
  code: 'WEB',
  workspaceId: 'product',
  access: 'workspace',
  ownerId: 'bao',
  start: '2026-09-21',
  end: '2026-10-30',
  outcome: 'Bàn giao website',
  defaultView: 'project-issues',
  state: 'active',
  tags: read(createOrganizationSession())
    .tags.filter((t) => t.domain === 'project')
    .slice(0, 2)
    .map((t) => t.id),
  memberIds: ['ha'],
  teamIds: ['engineering'],
  idempotencyKey: 'setup-1',
}
test('inheritance preview uses selected Workspace grants and internal access', () => {
  const d = read(createOrganizationSession())
  assert.match(workspaceInheritance(d, 'product')[0].label, /Engineering/)
  assert.match(workspaceInheritance(d, 'operations')[0].label, /Customer Success/)
  assert.match(workspaceInheritance(d, 'lab')[0].value, /không gồm khách mời/)
  assert.deepEqual(workspaceInheritance(d, 'unknown'), [])
})
test('create, replay and edit preserve metadata and avoid duplicate grants', () => {
  const s = createOrganizationSession(),
    result = s.call('flow.entity.save', args).value
  assert.ok(result.id, JSON.stringify(result))
  const d = read(s),
    p = d.projects.find((p) => p.id === result.id),
    count = d.grants.length
  assert.equal(p.ownerId, 'bao')
  assert.equal(p.state, 'active')
  assert.deepEqual(p.tags, args.tags)
  assert.equal(p.outcome, args.outcome)
  assert.equal(p.defaultView, 'project-issues')
  assert.ok(d.grants.some((g) => g.targetId === p.id && g.subjectId === 'bao' && g.role === 'admin'))
  assert.deepEqual(s.call('flow.entity.save', args).value, result)
  assert.equal(read(s).grants.length, count)
  const edit = s.call('flow.entity.save', {
    ...args,
    entityId: p.id,
    projectId: p.id,
    title: 'Website mới',
    idempotencyKey: 'edit-1',
  }).value
  assert.ok(edit.id)
  assert.equal(read(s).grants.length, count)
  assert.equal(read(s).projects.find((x) => x.id === p.id).title, 'Website mới')
})
test('invalid code, dates, owner, Team and cross-company Workspace fail without writes', () => {
  for (const patch of [
    { code: '!' },
    { state: 'fake' },
    { tags: ['foreign-tag'] },
    { end: '2026-09-01' },
    { start: '2026-02-30' },
    { ownerId: 'guest' },
    { teamIds: ['north-team'] },
    { workspaceId: 'north-product' },
  ]) {
    const s = createOrganizationSession(),
      before = read(s)
    assert.equal(s.call('flow.entity.save', { ...args, ...patch }).value.ok, false)
    assert.equal(read(s).projects.length, before.projects.length)
    assert.equal(read(s).grants.length, before.grants.length)
  }
  const s = createOrganizationSession()
  s.call('flow.entity.save', args)
  assert.equal(
    s.call('flow.entity.save', { ...args, idempotencyKey: 'duplicate' }).value.fields.code,
    'Chọn mã khác trong tổ chức.',
  )
})

import {
  defaultProjectStatuses,
  taskColumns,
  taskTags,
  statusKind,
} from '@ketvietlab/flow-client/project-catalogs.mjs'
const catalogs = () => ({
  projectStatuses: defaultProjectStatuses.map((c) => ({
    ...c,
    title: c.id === 'planned' ? 'Chuẩn bị' : c.title,
  })),
  projectLabels: [{ id: 'project-vip', title: 'Khách hàng VIP', color: 'yellow' }],
  taskStatuses: ['todo', 'progress', 'review', 'done'].map((kind, i) => ({
    id: 'workflow-' + kind,
    title: ['Sẵn sàng', 'Đang triển khai', 'Kiểm chứng', 'Đã bàn giao'][i],
    kind,
    color: ['neutral', 'blue', 'yellow', 'green'][i],
  })),
  taskLabels: [{ id: 'task-risk', title: 'Cần kiểm chứng', color: 'red' }],
})
const createCustom = (s) =>
  s.call('flow.entity.save', { ...args, ...catalogs(), state: 'planned', tags: ['project-vip'] }).value
test('project-local catalogs are saved atomically, replayed once and usable only by their project', () => {
  const s = createOrganizationSession(),
    before = read(s),
    created = createCustom(s)
  assert.ok(created.id, JSON.stringify(created))
  const d = read(s),
    p = d.projects.find((p) => p.id === created.id)
  assert.equal(p.projectStatuses[0].title, 'Chuẩn bị')
  assert.deepEqual(p.projectLabelIds, ['project-vip'])
  assert.deepEqual(
    taskColumns(d, p.id).map((c) => c.id),
    catalogs().taskStatuses.map((c) => c.id),
  )
  assert.deepEqual(
    taskTags(d, p.id).map((c) => c.id),
    ['task-risk'],
  )
  assert.deepEqual(taskColumns(d, 'core'), before.columns)
  assert.deepEqual(
    taskTags(d, 'core'),
    before.tags.filter((t) => t.domain !== 'project'),
  )
  assert.deepEqual(createCustom(s), created)
  assert.equal(read(s).columns.length, d.columns.length)
  const createdTask = s.call('flow.issue.save', {
    companyId: 'demo',
    projectId: p.id,
    title: 'Đầu ra đầu tiên',
    tags: ['task-risk'],
    idempotencyKey: 'task-custom',
  }).value
  assert.ok(createdTask.id, JSON.stringify(createdTask))
  const t = read(s).tasks.find((t) => t.id === createdTask.id)
  assert.equal(t.status, 'workflow-todo')
  for (const patch of [{ status: 'todo' }, { tags: ['project-vip'] }])
    assert.equal(
      s.call('flow.issue.save', {
        companyId: 'demo',
        idempotencyKey: crypto.randomUUID(),
        id: t.id,
        expectedVersion: t.version,
        ...patch,
      }).value.ok,
      false,
    )
  assert.equal(
    s.call('flow.issue.save', {
      companyId: 'demo',
      idempotencyKey: crypto.randomUUID(),
      projectId: 'core',
      title: 'Wrong scope',
      status: 'workflow-todo',
    }).value.ok,
    false,
  )
  assert.notEqual(
    s.call('flow.issue.save', {
      companyId: 'demo',
      idempotencyKey: crypto.randomUUID(),
      id: t.id,
      expectedVersion: t.version,
      status: 'workflow-progress',
    }).value.ok,
    false,
  )
  assert.equal(
    statusKind(
      read(s),
      read(s).tasks.find((x) => x.id === t.id),
    ),
    'progress',
  )
})
test('invalid custom catalogs never leave a partial project or modify organization libraries', () => {
  for (const patch of [
    { taskStatuses: catalogs().taskStatuses.slice(1) },
    { projectLabels: [{ id: 'bad', title: '', color: 'blue' }] },
    { taskLabels: [{ id: 'project-vip', title: 'Collision', color: 'blue' }] },
    { taskStatuses: catalogs().taskStatuses.map((c) => ({ ...c, title: 'Duplicate' })) },
  ]) {
    const s = createOrganizationSession(),
      before = read(s)
    const result = s.call('flow.entity.save', {
      ...args,
      ...catalogs(),
      state: 'planned',
      tags: ['project-vip'],
      ...patch,
    }).value
    assert.equal(result.ok, false, JSON.stringify(result))
    const after = read(s)
    for (const key of ['projects', 'grants', 'columns', 'tags']) assert.deepEqual(after[key], before[key])
  }
})
test('custom completion honors dependencies across move, reorder and bulk paths', () => {
  const s = createOrganizationSession(),
    p = createCustom(s),
    task = (title, blockedBy = []) =>
      s.call('flow.issue.save', {
        companyId: 'demo',
        projectId: p.id,
        title,
        blockedBy,
        idempotencyKey: crypto.randomUUID(),
      }).value.id
  const dependency = task('Điều kiện'),
    id = task('Bàn giao', [dependency])
  for (const [name, extra] of [
    ['flow.issue.move', { columnId: 'workflow-done' }],
    [
      'flow.issue.reorder',
      {
        groupBy: 'status',
        groupValue: 'workflow-done',
        targetId: null,
        position: 'after',
        expectedOrderRevision: read(s).taskOrderRevision,
      },
    ],
    ['flow.issue.bulk', { ids: [id], status: 'workflow-done' }],
  ]) {
    const result = s.call(name, {
      companyId: 'demo',
      id,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      ...extra,
    }).value
    assert.equal(result.ok, false, JSON.stringify(result))
    assert.equal(result.errors[0].code, 'blocked')
    assert.equal(read(s).tasks.find((t) => t.id === id).status, 'workflow-todo')
  }
  assert.equal(
    s.call('flow.issue.move', {
      companyId: 'demo',
      id: dependency,
      columnId: 'workflow-done',
      expectedVersion: 1,
      idempotencyKey: 'unblock',
    }).value.ok,
    true,
  )
  assert.equal(
    s.call('flow.issue.move', {
      companyId: 'demo',
      id,
      columnId: 'workflow-done',
      expectedVersion: 1,
      idempotencyKey: 'finish',
    }).value.ok,
    true,
  )
})
