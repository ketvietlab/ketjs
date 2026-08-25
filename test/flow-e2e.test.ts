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

    // An issue type belongs to one project, the same way an epic and a sprint
    // do. Epic was the reference that was written straight through, and an
    // issue in one project ended up filed under another's — this one is
    // checked from the start.
    await call('flow.issueType.save', {
      values: { id: 'beta-bug', projectId: 'beta', code: 'bug', name: 'Bug', sequence: 10 },
      idempotencyKey: 'type-beta-bug',
    })
    const crossType = await call<Row>('flow.issue.save', {
      id: 'alpha-typed',
      projectId: 'alpha',
      columnId: 'a-todo',
      title: 'Alpha work',
      typeId: 'beta-bug',
      idempotencyKey: 'issue-cross-type',
    })
    assert.equal(crossType.ok, false)
    assert.equal(errorCode(crossType), 'flow.error.typeProjectMismatch')
    assert.equal(await call<Row>('flow.issue.get', { id: 'alpha-typed' }), null)

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

    // Archiving a type in use would leave those issues pointing at a row no
    // screen lists, so they would read as untyped while still carrying it.
    await call('flow.issueType.save', {
      values: { id: 'beta-task', projectId: 'beta', code: 'task', name: 'Task', sequence: 20 },
      idempotencyKey: 'type-beta-task',
    })
    await call('flow.issue.save', {
      id: 'beta-1',
      projectId: 'beta',
      columnId: 'b-todo',
      title: 'Beta work',
      typeId: 'beta-bug',
      expectedVersion: Number((await call<Row>('flow.issue.get', { id: 'beta-1' })).version),
      idempotencyKey: 'issue-beta-typed',
    })
    const held = await call<Row>('flow.issueType.archive', { id: 'beta-bug' })
    assert.equal(held.ok, false)
    assert.equal(errorCode(held), 'flow.error.typeHasIssues')
    assert.equal((await call<Row>('flow.issueType.archive', { id: 'beta-task' })).ok, true)

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

/**
 * One mechanism instead of a model per taxonomy. Environment, Version and
 * Component were three requests; the fourth would have been a fourth model, a
 * fourth settings screen and a fourth column on Issue.
 */
test('flow: a project defines its own fields, and an issue answers them', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    await e2e.fixture.call('partner.savePartner', { id: 'p-company', kind: 'company', name: 'ACME' })
    await e2e.fixture.call('partner.savePartner', { id: 'p-user', kind: 'person', name: 'Nguyen Minh' })
    await e2e.fixture.call('company.saveCompany', { id: 'acme', partnerId: 'p-company', currency: 'VND' })
    await e2e.fixture.call('user.createUser', {
      id: 'u1',
      login: 'u1',
      password: 'test-password',
      name: 'Nguyen Minh',
      partnerId: 'p-user',
      defaultCompanyId: 'acme',
    })
    await e2e.fixture.call('user.grantCompany', { id: 'u1:acme', userId: 'u1', companyId: 'acme' })
    await e2e.client.login({ login: 'u1', password: 'test-password' })
    const call = async <T = Row>(name: string, input: Record<string, unknown>) =>
      (await e2e.client.call<T>(name, input)).value
    await call('flow.project.save', {
      values: { id: 'p1', key: 'PRJ', name: 'Flagship' },
      idempotencyKey: 'project-fields',
    })
    await call('flow.column.save', {
      values: { id: 'c1', projectId: 'p1', code: 'todo', name: 'To do', sequence: 10 },
      idempotencyKey: 'column-fields',
    })

    // A select needs options, and a kind has to be one nothing has to guess at:
    // `saveIssue` branches on kind to check a value, so an unchecked kind would
    // be a field that accepts anything.
    const noOptions = await call<Row>('flow.field.save', {
      id: 'f-bad',
      projectId: 'p1',
      code: 'env',
      name: 'Environment',
      kind: 'select',
      idempotencyKey: 'field-no-options',
    })
    assert.equal(errorCode(noOptions), 'flow.error.fieldOptionsRequired')
    const badKind = await call<Row>('flow.field.save', {
      id: 'f-bad2',
      projectId: 'p1',
      code: 'stars',
      name: 'Stars',
      kind: 'rating',
      idempotencyKey: 'field-bad-kind',
    })
    assert.equal(errorCode(badKind), 'flow.error.fieldKind')

    await call('flow.field.save', {
      id: 'f-env',
      projectId: 'p1',
      code: 'environment',
      name: 'Environment',
      kind: 'select',
      config: { options: [{ code: 'production', label: 'Production' }] },
      sequence: 10,
      idempotencyKey: 'field-env',
    })
    await call('flow.field.save', {
      id: 'f-count',
      projectId: 'p1',
      code: 'affected',
      name: 'Affected users',
      kind: 'number',
      sequence: 20,
      idempotencyKey: 'field-count',
    })

    const write = (id: string, fields: Record<string, unknown>, key: string) =>
      call<Row>('flow.issue.save', {
        id,
        projectId: 'p1',
        columnId: 'c1',
        title: 'Broken on deploy',
        fields,
        idempotencyKey: key,
      })

    assert.equal((await write('i1', { environment: 'production', affected: '42' }, 'field-write-1')).ok, true)
    const held = await call<Row>('flow.issue.get', { id: 'i1' })
    assert.deepEqual(
      (held.fields as Row[]).map((field) => [field.code, field.value]),
      [
        ['environment', 'production'],
        ['affected', '42'],
      ],
    )

    // A value outside the options, a value that is not a number, and a field
    // this project does not have are each refused — and none of them leaves an
    // issue behind, because they are checked before anything is written.
    assert.equal(
      errorCode(await write('i2', { environment: 'moon' }, 'field-write-2')),
      'flow.error.fieldOption',
    )
    assert.equal(
      errorCode(await write('i3', { affected: 'lots' }, 'field-write-3')),
      'flow.error.fieldNumber',
    )
    assert.equal(errorCode(await write('i4', { nosuch: 'x' }, 'field-write-4')), 'flow.error.fieldUnknown')
    for (const id of ['i2', 'i3', 'i4'])
      assert.equal(await call<Row>('flow.issue.get', { id }), null, `${id} was never written`)

    // Emptying a field removes the answer rather than storing one that is blank.
    await call('flow.issue.save', {
      id: 'i1',
      projectId: 'p1',
      columnId: 'c1',
      title: 'Broken on deploy',
      fields: { affected: '' },
      expectedVersion: Number((await call<Row>('flow.issue.get', { id: 'i1' })).version),
      idempotencyKey: 'field-write-5',
    })
    const cleared = await call<Row>('flow.issue.get', { id: 'i1' })
    assert.deepEqual(
      (cleared.fields as Row[]).map((field) => [field.code, field.value]),
      [
        ['environment', 'production'],
        ['affected', null],
      ],
    )

    // Archiving a field keeps what was already recorded: the values point at
    // the definition, nothing points back, so deleting them would be the one
    // irreversible thing on that screen.
    assert.equal((await call<Row>('flow.field.archive', { id: 'f-env' })).ok, true)
    assert.equal((await call<Row>('flow.field.list', { projectId: 'p1' })).length, 1)
  } finally {
    await e2e.close()
  }
})

/**
 * A board is one project's, because `flow.Column` is. So the global board
 * entry has to know which one a reader meant, and that answer belongs to the
 * reader rather than to the deployment.
 */
test('flow: the board a reader last opened is remembered for that reader alone', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    await e2e.fixture.call('partner.savePartner', { id: 'p-company', kind: 'company', name: 'ACME' })
    await e2e.fixture.call('partner.savePartner', { id: 'p-a', kind: 'person', name: 'Reader A' })
    await e2e.fixture.call('partner.savePartner', { id: 'p-b', kind: 'person', name: 'Reader B' })
    await e2e.fixture.call('company.saveCompany', { id: 'acme', partnerId: 'p-company', currency: 'VND' })
    for (const [id, partnerId] of [
      ['ua', 'p-a'],
      ['ub', 'p-b'],
    ]) {
      await e2e.fixture.call('user.createUser', {
        id,
        login: id,
        password: 'test-password',
        name: id,
        partnerId,
        defaultCompanyId: 'acme',
        superuser: true,
      })
      await e2e.fixture.call('user.grantCompany', { id: `${id}:acme`, userId: id, companyId: 'acme' })
    }

    const call = async <T = Row>(name: string, input: Record<string, unknown>) =>
      (await e2e.client.call<T>(name, input)).value

    await e2e.client.login({ login: 'ua', password: 'test-password' })
    for (const [id, key] of [
      ['alpha', 'ALP'],
      ['beta', 'BET'],
    ])
      await call('flow.project.save', {
        values: { id, key, name: id },
        idempotencyKey: `project-${id}-scope`,
      })

    // Nothing remembered yet, so nothing is guessed.
    assert.equal((await call<Row>('flow.board.scope', {})).projectId, null)

    assert.equal((await call<Row>('flow.board.remember', { projectId: 'alpha' })).ok, true)
    assert.equal((await call<Row>('flow.board.scope', {})).projectId, 'alpha')

    // A second reader starts blank and keeps their own answer.
    await e2e.client.login({ login: 'ub', password: 'test-password' })
    assert.equal((await call<Row>('flow.board.scope', {})).projectId, null)
    await call('flow.board.remember', { projectId: 'beta' })
    assert.equal((await call<Row>('flow.board.scope', {})).projectId, 'beta')

    await e2e.client.login({ login: 'ua', password: 'test-password' })
    assert.equal((await call<Row>('flow.board.scope', {})).projectId, 'alpha')

    // Opening another board replaces the answer rather than adding one.
    await call('flow.board.remember', { projectId: 'beta' })
    assert.equal((await call<Row>('flow.board.scope', {})).projectId, 'beta')
    await e2e.client.login({ login: 'ub', password: 'test-password' })
    assert.equal((await call<Row>('flow.board.scope', {})).projectId, 'beta')

    const missing = await call<Row>('flow.board.remember', { projectId: 'nosuchproject' })
    assert.equal(missing.ok, false)
  } finally {
    await e2e.close()
  }
})
