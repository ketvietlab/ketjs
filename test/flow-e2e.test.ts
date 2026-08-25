import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineDeployment } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, mail, partner, storage, user } from '@ketvietlab/ketsuite'
import flow from '../packages/ketsuite/src/modules/flow/index.ts'

const errorCode = (row: Row): unknown => (row.errors as Array<{ code: string }> | undefined)?.[0]?.code

const app = defineDeployment({
  name: 'flow_headless_e2e',
  modules: [address, partner, company, storage, user, mail, flow],
  headless: true,
  serve: {
    sessions: { anonymous: { company: 'acme' } },
  },
})

test('flow headless E2E: project, board, sprint and dependency lifecycle', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    await e2e.fixture.call('partner.savePartner', { id: 'p-company', kind: 'company', name: 'ACME' })
    await e2e.fixture.call('partner.savePartner', { id: 'p-user', kind: 'person', name: 'Nguyễn Minh' })
    await e2e.fixture.call('company.saveCompany', { id: 'acme', partnerId: 'p-company', currency: 'VND' })
    await e2e.fixture.call('user.createUser', {
      id: 'u1',
      login: 'u1',
      password: 'test-password',
      name: 'Nguyễn Minh',
      partnerId: 'p-user',
      defaultCompanyId: 'acme',
    })
    await e2e.fixture.call('user.grantCompany', { id: 'u1:acme', userId: 'u1', companyId: 'acme' })
    await e2e.client.login({ login: 'u1', password: 'test-password' })
    const call = async <T = Row>(name: string, input: Record<string, unknown>) =>
      (await e2e.client.call<T>(name, input)).value

    const project = await call<Row>('flow.project.save', {
      values: { id: 'proj1', key: 'PRJ', name: 'Flagship' },
      idempotencyKey: 'project-save-1',
    })
    assert.equal(project.ok, true)

    const todo = await call<Row>('flow.column.save', {
      values: { id: 'col-todo', projectId: 'proj1', code: 'todo', name: 'To do', sequence: 10 },
      idempotencyKey: 'column-save-1',
    })
    assert.equal(todo.ok, true)
    const done = await call<Row>('flow.column.save', {
      values: {
        id: 'col-done',
        projectId: 'proj1',
        code: 'done',
        name: 'Done',
        sequence: 20,
        terminalState: true,
      },
      idempotencyKey: 'column-save-2',
    })
    assert.equal(done.ok, true)

    const blocker = await call<Row>('flow.issue.save', {
      id: 'issue-blocker',
      projectId: 'proj1',
      columnId: 'col-todo',
      title: 'Design the schema',
      idempotencyKey: 'issue-save-blocker',
    })
    assert.equal(blocker.ok, true)
    const issue = await call<Row>('flow.issue.save', {
      id: 'issue-1',
      projectId: 'proj1',
      columnId: 'col-todo',
      title: 'Ship the feature',
      priority: 'high',
      idempotencyKey: 'issue-save-1',
    })
    assert.equal(issue.ok, true)
    assert.equal(issue.version, 1)

    const dependency = await call<Row>('flow.issue.dependency.add', {
      id: 'dep-1',
      issueId: 'issue-1',
      dependsOnIssueId: 'issue-blocker',
      relation: 'blocks',
      idempotencyKey: 'dependency-add-1',
    })
    assert.equal(dependency.ok, true)

    // The blocker is still open, so the terminal column must refuse the move.
    const blockedMove = await call<Row>('flow.issue.move', {
      id: 'issue-1',
      columnId: 'col-done',
      expectedVersion: 1,
      idempotencyKey: 'move-blocked-1',
    })
    assert.equal(blockedMove.ok, false)
    assert.equal(errorCode(blockedMove), 'flow.error.blocked')

    const blockerDone = await call<Row>('flow.issue.move', {
      id: 'issue-blocker',
      columnId: 'col-done',
      expectedVersion: 1,
      idempotencyKey: 'move-blocker-done',
    })
    assert.equal(blockerDone.ok, true)

    const move = await call<Row>('flow.issue.move', {
      id: 'issue-1',
      columnId: 'col-done',
      expectedVersion: 1,
      idempotencyKey: 'move-issue-1',
    })
    assert.equal(move.ok, true)
    assert.equal(move.version, 2)

    // A stale version is refused rather than silently overwritten.
    const conflict = await call<Row>('flow.issue.move', {
      id: 'issue-1',
      columnId: 'col-todo',
      expectedVersion: 1,
      idempotencyKey: 'move-conflict',
    })
    assert.equal(conflict.ok, false)
    assert.equal(errorCode(conflict), 'flow.error.conflict')

    const sprint = await call<Row>('flow.sprint.save', {
      id: 'sprint-1',
      projectId: 'proj1',
      name: 'Sprint 1',
      idempotencyKey: 'sprint-save-1',
    })
    assert.equal(sprint.ok, true)
    const started = await call<Row>('flow.sprint.start', { id: 'sprint-1', idempotencyKey: 'sprint-start-1' })
    assert.equal(started.ok, true)
    const secondSprint = await call<Row>('flow.sprint.save', {
      id: 'sprint-2',
      projectId: 'proj1',
      name: 'Sprint 2',
      idempotencyKey: 'sprint-save-2',
    })
    assert.equal(secondSprint.ok, true)
    const doubleStart = await call<Row>('flow.sprint.start', {
      id: 'sprint-2',
      idempotencyKey: 'sprint-start-2',
    })
    assert.equal(doubleStart.ok, false)
    assert.equal(errorCode(doubleStart), 'flow.error.sprintAlreadyActive')
    const closed = await call<Row>('flow.sprint.close', { id: 'sprint-1', idempotencyKey: 'sprint-close-1' })
    assert.equal(closed.ok, true)

    // A closed sprint refuses new membership.
    const assignClosed = await call<Row>('flow.issue.assignSprint', {
      id: 'issue-1',
      sprintId: 'sprint-1',
      expectedVersion: 2,
      idempotencyKey: 'assign-sprint-1',
    })
    assert.equal(assignClosed.ok, false)
    assert.equal(errorCode(assignClosed), 'flow.error.sprintClosed')

    const comment = await call<Row>('flow.issue.comment', {
      id: 'msg-1',
      issueId: 'issue-1',
      body: 'Shipped in v1.2',
      idempotencyKey: 'comment-1',
    })
    assert.equal(comment.ok, true)

    const detail = await call<Row>('flow.issue.get', { id: 'issue-1' })
    assert.equal(detail.title, 'Ship the feature')
    assert.equal(detail.columnName, 'Done')
    assert.equal((detail.comments as Row[]).length, 1)
    assert.equal((detail.dependencies as Row[]).length, 1)

    const list = await call<Row>('flow.issue.list', { projectId: 'proj1' })
    assert.equal(list.total, 2)

    // issue-1 already blocks-depends-on issue-blocker (dep-1); the reverse edge
    // would close a two-node blocking cycle.
    const cycle = await call<Row>('flow.issue.dependency.add', {
      id: 'dep-cycle',
      issueId: 'issue-blocker',
      dependsOnIssueId: 'issue-1',
      relation: 'blocks',
      idempotencyKey: 'dependency-cycle-1',
    })
    assert.equal(cycle.ok, false)
    assert.equal(errorCode(cycle), 'flow.error.cycle')

    const missing = await call<Row | null>('flow.issue.get', { id: 'does-not-exist' })
    assert.equal(missing, null)
  } finally {
    await e2e.close()
  }
})

/**
 * The three fields `issue.save` used to accept without checking.
 *
 * Each one had a matching check somewhere else in the module — `assignSprint`
 * refused a cross-project sprint, `moveIssue` owned the column, `blocks`
 * refused cycles — and `issue.save` let all three past, answering `ok: true`
 * either way.
 */
test('flow: issue.save refuses the sprint, column and parent it cannot honour', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    await e2e.fixture.call('partner.savePartner', { id: 'p-company', kind: 'company', name: 'ACME' })
    await e2e.fixture.call('partner.savePartner', { id: 'p-user', kind: 'person', name: 'Nguyễn Minh' })
    await e2e.fixture.call('company.saveCompany', { id: 'acme', partnerId: 'p-company', currency: 'VND' })
    await e2e.fixture.call('user.createUser', {
      id: 'u1',
      login: 'u1',
      password: 'test-password',
      name: 'Nguyễn Minh',
      partnerId: 'p-user',
      defaultCompanyId: 'acme',
    })
    await e2e.fixture.call('user.grantCompany', { id: 'u1:acme', userId: 'u1', companyId: 'acme' })
    await e2e.client.login({ login: 'u1', password: 'test-password' })
    const call = async <T = Row>(name: string, input: Record<string, unknown>) =>
      (await e2e.client.call<T>(name, input)).value

    for (const [id, key, name] of [
      ['alpha', 'A', 'Alpha'],
      ['beta', 'B', 'Beta'],
    ])
      await call('flow.project.save', { values: { id, key, name }, idempotencyKey: `project-${id}` })
    await call('flow.column.save', {
      values: { id: 'a-todo', projectId: 'alpha', code: 'todo', name: 'To do', sequence: 10 },
      idempotencyKey: 'column-a-todo',
    })
    await call('flow.column.save', {
      values: { id: 'a-doing', projectId: 'alpha', code: 'doing', name: 'Doing', sequence: 20 },
      idempotencyKey: 'column-a-doing',
    })
    await call('flow.column.save', {
      values: { id: 'b-todo', projectId: 'beta', code: 'todo', name: 'To do', sequence: 10 },
      idempotencyKey: 'column-b-todo',
    })
    await call('flow.sprint.save', {
      id: 'beta-sprint',
      projectId: 'beta',
      name: 'Beta 1',
      idempotencyKey: 'sprint-beta-1',
    })

    const crossSprint = await call<Row>('flow.issue.save', {
      id: 'alpha-1',
      projectId: 'alpha',
      columnId: 'a-todo',
      title: 'Alpha work',
      sprintId: 'beta-sprint',
      idempotencyKey: 'issue-cross-sprint',
    })
    assert.equal(crossSprint.ok, false)
    assert.equal(errorCode(crossSprint), 'flow.error.sprintProjectMismatch')

    await call('flow.issue.save', {
      id: 'alpha-1',
      projectId: 'alpha',
      columnId: 'a-todo',
      title: 'Alpha work',
      idempotencyKey: 'issue-alpha-1',
    })
    await call('flow.issue.save', {
      id: 'beta-1',
      projectId: 'beta',
      columnId: 'b-todo',
      title: 'Beta work',
      idempotencyKey: 'issue-beta-1',
    })
    const version = Number((await call<Row>('flow.issue.get', { id: 'alpha-1' })).version)

    // Save used to keep the stored column and still report success, so the
    // caller was told a move had happened that never did.
    const moved = await call<Row>('flow.issue.save', {
      id: 'alpha-1',
      projectId: 'alpha',
      columnId: 'a-doing',
      title: 'Alpha work',
      expectedVersion: version,
      idempotencyKey: 'issue-alpha-move',
    })
    assert.equal(moved.ok, false)
    assert.equal(errorCode(moved), 'flow.error.columnNeedsMove')
    assert.equal((await call<Row>('flow.issue.get', { id: 'alpha-1' })).columnId, 'a-todo')

    const properly = await call<Row>('flow.issue.move', {
      id: 'alpha-1',
      columnId: 'a-doing',
      expectedVersion: version,
      idempotencyKey: 'issue-alpha-move-2',
    })
    assert.equal(properly.ok, true)

    const at = async () => Number((await call<Row>('flow.issue.get', { id: 'alpha-1' })).version)
    const saveParent = async (parentIssueId: string, key: string) =>
      call<Row>('flow.issue.save', {
        id: 'alpha-1',
        projectId: 'alpha',
        columnId: 'a-doing',
        title: 'Alpha work',
        parentIssueId,
        expectedVersion: await at(),
        idempotencyKey: key,
      })

    assert.equal(errorCode(await saveParent('beta-1', 'parent-cross')), 'flow.error.parentProjectMismatch')
    assert.equal(errorCode(await saveParent('does-not-exist', 'parent-ghost')), 'flow.error.notFound')
    assert.equal(errorCode(await saveParent('alpha-1', 'parent-self')), 'flow.error.selfParent')

    const child = await call<Row>('flow.issue.save', {
      id: 'alpha-2',
      projectId: 'alpha',
      columnId: 'a-todo',
      title: 'A sub-task',
      parentIssueId: 'alpha-1',
      idempotencyKey: 'issue-alpha-2',
    })
    assert.equal(child.ok, true)
    assert.equal(errorCode(await saveParent('alpha-2', 'parent-cycle')), 'flow.error.parentCycle')
  } finally {
    await e2e.close()
  }
})
