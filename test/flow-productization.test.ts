// The three things a work tracker is expected to do that Flow could not.
//
// Closing a sprint left the unfinished work in it; the timeline recorded exactly
// one kind of change; and the estimate every issue carries was added up nowhere.
// Each case here goes through the domain, because each is a domain gap rather
// than a screen one.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineDeployment } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, mail, partner, storage, user } from '@ketvietlab/ketsuite'
import flow from '../packages/ketsuite/src/modules/flow/index.ts'

const app = defineDeployment({
  name: 'flow_productization',
  modules: [address, partner, company, storage, user, mail, flow],
  headless: true,
  serve: { sessions: { anonymous: { company: 'acme' } } },
})

const boot = async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  await e2e.fixture.call('partner.savePartner', { id: 'p-company', kind: 'company', name: 'ACME' })
  await e2e.fixture.call('partner.savePartner', { id: 'p-user', kind: 'person', name: 'Lê Minh' })
  await e2e.fixture.call('company.saveCompany', { id: 'acme', partnerId: 'p-company', currency: 'VND' })
  await e2e.fixture.call('user.createUser', {
    id: 'u1',
    login: 'u1',
    password: 'test-password',
    name: 'Lê Minh',
    partnerId: 'p-user',
    defaultCompanyId: 'acme',
  })
  await e2e.fixture.call('user.grantCompany', { id: 'u1:acme', userId: 'u1', companyId: 'acme' })
  await e2e.client.login({ login: 'u1', password: 'test-password' })
  const call = async <T = Row>(name: string, input: Record<string, unknown> = {}) =>
    (await e2e.client.call<T>(name, input)).value
  const ok = (row: Row) => {
    assert.equal(row.ok, true, JSON.stringify(row.errors ?? row))
    return row
  }
  const codes = (row: Row) => (row.errors as Row[]).map((entry) => String(entry.code))

  ok(
    await call<Row>('flow.project.save', {
      values: { id: 'p1', key: 'PRJ', name: 'Flagship' },
      idempotencyKey: 'productization-project',
    }),
  )
  for (const [id, code, name, sequence, terminalState] of [
    ['c-todo', 'todo', 'To do', 10, false],
    ['c-done', 'done', 'Done', 20, true],
  ] as const)
    ok(
      await call<Row>('flow.column.save', {
        values: { id, projectId: 'p1', code, name, sequence, terminalState },
        idempotencyKey: `productization-column-${code}`,
      }),
    )
  return { e2e, call, ok, codes }
}

const issue = async (
  call: <T = Row>(n: string, i?: Record<string, unknown>) => Promise<T>,
  id: string,
  extra: Record<string, unknown> = {},
) =>
  (await call<Row>('flow.issue.save', {
    id,
    projectId: 'p1',
    columnId: 'c-todo',
    title: id,
    idempotencyKey: `productization-issue-${id}`,
    ...extra,
  })) as Row

test('closing a sprint decides what happens to the work that did not finish', async () => {
  const { e2e, call, ok } = await boot()
  try {
    for (const [id, name] of [
      ['s1', 'Sprint 1'],
      ['s2', 'Sprint 2'],
    ] as const)
      ok(
        await call('flow.sprint.save', {
          id,
          projectId: 'p1',
          name,
          idempotencyKey: `productization-sprint-${id}`,
        }),
      )
    ok(await call('flow.sprint.start', { id: 's1', idempotencyKey: 'productization-start-s1' }))

    const done = await issue(call, 'finished', { sprintId: 's1' })
    const open = await issue(call, 'unfinished', { sprintId: 's1' })
    ok(
      await call('flow.issue.move', {
        id: 'finished',
        columnId: 'c-done',
        expectedVersion: done.version,
        idempotencyKey: 'productization-move-done',
      }),
    )

    const closed = ok(
      await call<Row>('flow.sprint.close', {
        id: 's1',
        carryTo: 's2',
        idempotencyKey: 'productization-close-s1',
      }),
    )
    assert.equal(Number(closed.carried), 1, 'only the unfinished one moves')

    const sprints = (await call<Row[]>('flow.sprint.list', { projectId: 'p1' })) as Row[]
    const first = sprints.find((row) => row.id === 's1')!
    const second = sprints.find((row) => row.id === 's2')!
    assert.equal(String(first.state), 'closed')
    // The finished issue stays where the work was actually done, which is what
    // makes a closed sprint readable as a record afterwards.
    assert.equal(Number(first.total), 1)
    assert.equal(Number(first.done), 1)
    assert.equal(Number(second.total), 1)
    assert.equal(Number(second.unfinished), 1)

    const moved = (await call<Row>('flow.issue.get', { id: 'unfinished' })) as Row
    assert.equal(String(moved.sprintId), 's2')
    assert.equal(Number(moved.version), Number(open.version) + 1, 'the carry moves the version too')
  } finally {
    await e2e.close()
  }
})

test('the carry has three answers, and refuses the two that make no sense', async () => {
  const { e2e, call, ok, codes } = await boot()
  try {
    for (const [id, name] of [
      ['s1', 'Sprint 1'],
      ['s2', 'Sprint 2'],
    ] as const)
      ok(
        await call('flow.sprint.save', {
          id,
          projectId: 'p1',
          name,
          idempotencyKey: `productization-sprint-${id}`,
        }),
      )
    ok(
      await call('flow.project.save', {
        values: { id: 'p2', key: 'OTH', name: 'Other' },
        idempotencyKey: 'productization-project-2',
      }),
    )
    ok(
      await call('flow.sprint.save', {
        id: 'other',
        projectId: 'p2',
        name: 'Elsewhere',
        idempotencyKey: 'productization-sprint-other',
      }),
    )
    ok(await call('flow.sprint.start', { id: 's1', idempotencyKey: 'productization-start-s1' }))
    await issue(call, 'unfinished', { sprintId: 's1' })

    // A sprint in another project is not somewhere this work can go.
    const wrongProject = await call<Row>('flow.sprint.close', {
      id: 's1',
      carryTo: 'other',
      idempotencyKey: 'productization-close-wrong',
    })
    assert.equal(wrongProject.ok, false)
    assert.deepEqual(codes(wrongProject), ['flow.error.sprintProjectMismatch'])

    // Nor is the sprint being closed.
    const itself = await call<Row>('flow.sprint.close', {
      id: 's1',
      carryTo: 's1',
      idempotencyKey: 'productization-close-self',
    })
    assert.equal(itself.ok, false)
    assert.deepEqual(codes(itself), ['flow.error.invalidSprintState'])

    // Out of every sprint is a real answer, and the only one available when the
    // project has nowhere else open.
    const emptied = ok(
      await call<Row>('flow.sprint.close', {
        id: 's1',
        carry: true,
        idempotencyKey: 'productization-close-empty',
      }),
    )
    assert.equal(Number(emptied.carried), 1)
    assert.equal((await call<Row>('flow.issue.get', { id: 'unfinished' })).sprintId, null)
  } finally {
    await e2e.close()
  }
})

test('closing without a carry leaves the work exactly where it was', async () => {
  const { e2e, call, ok } = await boot()
  try {
    ok(
      await call('flow.sprint.save', {
        id: 's1',
        projectId: 'p1',
        name: 'Sprint 1',
        idempotencyKey: 'productization-sprint-s1',
      }),
    )
    ok(await call('flow.sprint.start', { id: 's1', idempotencyKey: 'productization-start-s1' }))
    await issue(call, 'unfinished', { sprintId: 's1' })

    // Every caller that closed a sprint before this change still gets that.
    const closed = ok(
      await call<Row>('flow.sprint.close', { id: 's1', idempotencyKey: 'productization-close-plain' }),
    )
    assert.equal(Number(closed.carried), 0)
    assert.equal(String((await call<Row>('flow.issue.get', { id: 'unfinished' })).sprintId), 's1')
  } finally {
    await e2e.close()
  }
})

test('the timeline records the column, the deadline and the sprint, not only the assignee', async () => {
  const { e2e, call, ok } = await boot()
  try {
    ok(
      await call('flow.sprint.save', {
        id: 's1',
        projectId: 'p1',
        name: 'Sprint 1',
        idempotencyKey: 'productization-sprint-s1',
      }),
    )
    const saved = await issue(call, 'work', { dueDate: '2026-09-30', priority: 'normal' })

    // Sorted, not in timeline order: two entries written inside the same
    // millisecond tie-break on id, and which of them the timeline shows first is
    // not what this test is about.
    const entries = async () =>
      ((await call<Row>('flow.issue.get', { id: 'work' })).comments as Row[])
        .filter((entry) => String(entry.kind) === 'system')
        .map((entry) => String(entry.body))
        .sort()

    // Creating it says nothing: an entry per creation is noise on a page that
    // already shows when the record was made.
    assert.deepEqual(await entries(), [])

    const moved = ok(
      await call<Row>('flow.issue.move', {
        id: 'work',
        columnId: 'c-done',
        expectedVersion: saved.version,
        idempotencyKey: 'productization-move',
      }),
    )
    // The question the cluster could not answer: who put this in Done.
    assert.deepEqual(await entries(), ['flow.timeline.moved'])

    ok(
      await call('flow.issue.assignSprint', {
        id: 'work',
        sprintId: 's1',
        expectedVersion: moved.version,
        idempotencyKey: 'productization-assign-sprint',
      }),
    )
    assert.deepEqual(await entries(), ['flow.timeline.moved', 'flow.timeline.sprint'])

    const held = (await call<Row>('flow.issue.get', { id: 'work' })) as Row
    ok(
      await call('flow.issue.save', {
        id: 'work',
        projectId: 'p1',
        columnId: 'c-done',
        title: 'work',
        dueDate: '2026-10-15',
        priority: 'high',
        expectedVersion: held.version,
        idempotencyKey: 'productization-reschedule',
      }),
    )
    assert.deepEqual(await entries(), [
      'flow.timeline.changed',
      'flow.timeline.moved',
      'flow.timeline.sprint',
    ])

    // Renaming leaves no entry: a line per keystroke is what makes a timeline
    // unreadable, and the title already has its own history in the document.
    const renamed = (await call<Row>('flow.issue.get', { id: 'work' })) as Row
    ok(
      await call('flow.issue.save', {
        id: 'work',
        projectId: 'p1',
        columnId: 'c-done',
        title: 'work, renamed',
        dueDate: '2026-10-15',
        priority: 'high',
        expectedVersion: renamed.version,
        idempotencyKey: 'productization-rename',
      }),
    )
    assert.equal((await entries()).length, 3)
  } finally {
    await e2e.close()
  }
})

test('sprints and epics add up the estimates their issues have always carried', async () => {
  const { e2e, call, ok } = await boot()
  try {
    ok(
      await call('flow.sprint.save', {
        id: 's1',
        projectId: 'p1',
        name: 'Sprint 1',
        idempotencyKey: 'productization-sprint-s1',
      }),
    )
    ok(
      await call('flow.epic.save', {
        values: { id: 'e1', projectId: 'p1', title: 'Platform' },
        idempotencyKey: 'productization-epic',
      }),
    )
    const first = await issue(call, 'a', { sprintId: 's1', epicId: 'e1', estimate: '3' })
    await issue(call, 'b', { sprintId: 's1', epicId: 'e1', estimate: '5' })
    // Outside both, so the totals are a reading of membership rather than of the
    // project.
    await issue(call, 'c', { estimate: '8' })

    const sprintOf = async () =>
      ((await call<Row[]>('flow.sprint.list', { projectId: 'p1' })) as Row[]).find((row) => row.id === 's1')!
    const epicOf = async () =>
      ((await call<Row[]>('flow.epic.list', { projectId: 'p1' })) as Row[]).find((row) => row.id === 'e1')!

    assert.equal(Number((await sprintOf()).estimate), 8)
    assert.equal(Number((await sprintOf()).estimateDone), 0)
    assert.equal(Number((await epicOf()).estimate), 8)
    assert.equal(Number((await epicOf()).total), 2)

    ok(
      await call('flow.issue.move', {
        id: 'a',
        columnId: 'c-done',
        expectedVersion: first.version,
        idempotencyKey: 'productization-move-a',
      }),
    )
    assert.equal(Number((await sprintOf()).estimateDone), 3)
    assert.equal(Number((await sprintOf()).done), 1)
    assert.equal(Number((await sprintOf()).unfinished), 1)
    assert.equal(Number((await epicOf()).estimateDone), 3)
  } finally {
    await e2e.close()
  }
})
