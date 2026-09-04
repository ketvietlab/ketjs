// The halves of Flow's lifecycle that were modelled but never reachable.
//
// `Issue.active` sat in the model and in four indexes with nothing able to write
// it; `page.restore` existed with no screen calling it; `project.save` took a
// name that only the create form ever sent. Each case here is the round trip —
// out and back — because a one-way door is what these were.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineDeployment } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, mail, partner, storage, user } from '@ketvietlab/ketsuite'
import flow from '../packages/ketsuite/src/modules/flow/index.ts'
import { emptyIssueListState } from '../packages/ketsuite/src/modules/flow/search.ts'

const app = defineDeployment({
  name: 'flow_lifecycle',
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
  return { e2e, call, ok, codes }
}

const project = async (call: <T = Row>(n: string, i?: Record<string, unknown>) => Promise<T>) => {
  await call('flow.project.save', {
    values: { id: 'p1', key: 'PRJ', name: 'Flagship' },
    idempotencyKey: 'lifecycle-project',
  })
  for (const [id, code, name, sequence, terminalState] of [
    ['c-todo', 'todo', 'To do', 10, false],
    ['c-done', 'done', 'Done', 20, true],
  ] as const)
    await call('flow.column.save', {
      values: { id, projectId: 'p1', code, name, sequence, terminalState },
      idempotencyKey: `lifecycle-column-${code}`,
    })
}

test('archiving an issue takes it out of every figure, and restoring puts it back', async () => {
  const { e2e, call, ok } = await boot()
  try {
    await project(call)
    const saved = ok(
      await call<Row>('flow.issue.save', {
        id: 'i1',
        projectId: 'p1',
        columnId: 'c-todo',
        title: 'Cancelled work',
        idempotencyKey: 'lifecycle-issue-1',
      }),
    )
    ok(
      await call('flow.issue.save', {
        id: 'i2',
        projectId: 'p1',
        columnId: 'c-todo',
        title: 'Real work',
        idempotencyKey: 'lifecycle-issue-2',
      }),
    )

    const buckets = async () =>
      await call<Row>('flow.issue.buckets', { projectId: 'p1', listState: emptyIssueListState() })
    const stats = async () => ((await call<Row[]>('flow.project.stats', { projectIds: ['p1'] })) as Row[])[0]!
    assert.equal(Number((await buckets()).total), 2)
    assert.equal(Number((await stats()).total), 2)

    const archived = ok(
      await call<Row>('flow.issue.archive', {
        id: 'i1',
        expectedVersion: saved.version,
        idempotencyKey: 'lifecycle-archive-1',
      }),
    )
    // Out of the counts, out of the list, out of the project's own figures.
    assert.equal(Number((await buckets()).total), 1)
    assert.equal(Number((await stats()).total), 1)
    const listed = await call<{ rows: Row[]; total: number }>('flow.issue.list', {
      projectId: 'p1',
      listState: emptyIssueListState(),
    })
    assert.deepEqual(
      listed.rows.map((row) => String(row.id)),
      ['i2'],
    )

    // But findable, which is the difference between archiving and deleting.
    const withArchived = await call<{ rows: Row[]; total: number }>('flow.issue.list', {
      projectId: 'p1',
      listState: { ...emptyIssueListState(), includeArchived: true },
    })
    assert.equal(withArchived.total, 2)

    ok(
      await call('flow.issue.restore', {
        id: 'i1',
        expectedVersion: archived.version,
        idempotencyKey: 'lifecycle-restore-1',
      }),
    )
    assert.equal(Number((await buckets()).total), 2)
    assert.equal(Number((await stats()).total), 2)
  } finally {
    await e2e.close()
  }
})

test('an archived issue still blocks the work it was blocking', async () => {
  // FLW-DEC-011. Archiving is not completing, and silently clearing a blocker is
  // the worst way for one to go away: the work behind it would start moving with
  // nobody having decided it could.
  const { e2e, call, ok, codes } = await boot()
  try {
    await project(call)
    const blocker = ok(
      await call<Row>('flow.issue.save', {
        id: 'blocker',
        projectId: 'p1',
        columnId: 'c-todo',
        title: 'Pick the database',
        idempotencyKey: 'lifecycle-blocker',
      }),
    )
    const blocked = ok(
      await call<Row>('flow.issue.save', {
        id: 'blocked',
        projectId: 'p1',
        columnId: 'c-todo',
        title: 'Write the migration',
        idempotencyKey: 'lifecycle-blocked',
      }),
    )
    ok(
      await call('flow.issue.dependency.add', {
        id: 'dep-1',
        issueId: 'blocked',
        dependsOnIssueId: 'blocker',
        relation: 'blocks',
        idempotencyKey: 'lifecycle-dependency',
      }),
    )
    ok(
      await call('flow.issue.archive', {
        id: 'blocker',
        expectedVersion: blocker.version,
        idempotencyKey: 'lifecycle-archive-blocker',
      }),
    )
    const refused = await call<Row>('flow.issue.move', {
      id: 'blocked',
      columnId: 'c-done',
      expectedVersion: blocked.version,
      idempotencyKey: 'lifecycle-move-blocked',
    })
    assert.equal(refused.ok, false)
    assert.deepEqual(codes(refused), ['flow.error.blocked'])
  } finally {
    await e2e.close()
  }
})

test('archiving is a write like any other: a stale screen is refused', async () => {
  const { e2e, call, ok, codes } = await boot()
  try {
    await project(call)
    const saved = ok(
      await call<Row>('flow.issue.save', {
        id: 'i1',
        projectId: 'p1',
        columnId: 'c-todo',
        title: 'Work',
        idempotencyKey: 'lifecycle-issue-cas',
      }),
    )
    ok(
      await call('flow.issue.move', {
        id: 'i1',
        columnId: 'c-done',
        expectedVersion: saved.version,
        idempotencyKey: 'lifecycle-move-cas',
      }),
    )
    const stale = await call<Row>('flow.issue.archive', {
      id: 'i1',
      expectedVersion: saved.version,
      idempotencyKey: 'lifecycle-archive-cas',
    })
    assert.equal(stale.ok, false)
    assert.deepEqual(codes(stale), ['flow.error.conflict'])

    // Archiving something already archived is not a conflict — it is done.
    const current = Number(saved.version) + 1
    const first = ok(
      await call<Row>('flow.issue.archive', {
        id: 'i1',
        expectedVersion: current,
        idempotencyKey: 'lifecycle-archive-cas-2',
      }),
    )
    const again = ok(
      await call<Row>('flow.issue.archive', {
        id: 'i1',
        expectedVersion: 0,
        idempotencyKey: 'lifecycle-archive-cas-3',
      }),
    )
    assert.equal(Number(again.version), Number(first.version))
  } finally {
    await e2e.close()
  }
})

test('a document comes back from the archive, and comes back somewhere visible', async () => {
  const { e2e, call, ok } = await boot()
  try {
    await project(call)
    for (const [id, title, parent] of [
      ['root', 'Handbook', null],
      ['child', 'Release process', 'root'],
    ] as const)
      ok(
        await call('flow.page.save', {
          id,
          projectId: 'p1',
          title,
          ...(parent ? { parentPageId: parent } : {}),
          idempotencyKey: `lifecycle-page-${id}`,
        }),
      )

    ok(await call('flow.page.archive', { id: 'child' }))
    const visible = async (includeArchived = false) =>
      ((await call<Row[]>('flow.page.list', { projectId: 'p1', includeArchived })) as Row[]).map((row) =>
        String(row.id),
      )
    assert.deepEqual(await visible(), ['root'])
    assert.deepEqual((await visible(true)).sort(), ['child', 'root'])

    ok(await call('flow.page.restore', { id: 'child' }))
    const back = (await call<{ value: Row | null }>('flow.page.get', { id: 'child' })).value!
    assert.equal(back.active, true)
    assert.equal(back.parentPageId, 'root', 'a live parent keeps its branch')

    // And when the parent is the archived one, the child comes back at the root
    // rather than under something no tree descends into.
    ok(await call('flow.page.archive', { id: 'root' }))
    ok(await call('flow.page.archive', { id: 'child' }))
    ok(await call('flow.page.restore', { id: 'child' }))
    const orphan = (await call<{ value: Row | null }>('flow.page.get', { id: 'child' })).value!
    assert.equal(orphan.active, true)
    assert.equal(orphan.parentPageId, null, 'it comes back visible rather than lost')
  } finally {
    await e2e.close()
  }
})

test('following an issue is something a person can choose, both ways', async () => {
  const { e2e, call, ok } = await boot()
  try {
    await project(call)
    ok(
      await call('flow.issue.save', {
        id: 'i1',
        projectId: 'p1',
        columnId: 'c-todo',
        title: 'Somebody else’s work',
        idempotencyKey: 'lifecycle-follow-issue',
      }),
    )
    // `issue.get` answers with the row itself, not with a `value` wrapper.
    const following = async () => Boolean((await call<Row>('flow.issue.get', { id: 'i1' })).following)
    // Writing an issue subscribes you to it, which is one of the three generous
    // ways somebody ends up following — and `unfollow` was the only way out.
    assert.equal(await following(), true)

    ok(await call('flow.issue.unfollow', { issueId: 'i1', idempotencyKey: 'lifecycle-unfollow-1' }))
    assert.equal(await following(), false)
    // Pressed twice, which is what a person does when a page is slow.
    ok(await call('flow.issue.unfollow', { issueId: 'i1', idempotencyKey: 'lifecycle-unfollow-2' }))
    assert.equal(await following(), false)

    // And back in, deliberately — the door that did not exist. Before this,
    // getting back to an issue you had left meant commenting on it.
    ok(await call('flow.issue.follow', { issueId: 'i1', idempotencyKey: 'lifecycle-follow-1' }))
    assert.equal(await following(), true)
    ok(await call('flow.issue.follow', { issueId: 'i1', idempotencyKey: 'lifecycle-follow-2' }))
    assert.equal(await following(), true)
  } finally {
    await e2e.close()
  }
})

test('a project can be renamed and archived after it exists', async () => {
  const { e2e, call, ok } = await boot()
  try {
    await project(call)
    ok(
      await call('flow.project.save', {
        values: { id: 'p1', key: 'PRJ', name: 'Flagship platform', description: 'What we build on.' },
        idempotencyKey: 'lifecycle-rename',
      }),
    )
    const read = async (includeArchived = false) =>
      (await call<Row[]>('flow.project.list', { includeArchived })) as Row[]
    assert.equal(String((await read())[0]!.name), 'Flagship platform')

    ok(
      await call('flow.project.save', {
        values: { id: 'p1', key: 'PRJ', name: 'Flagship platform', active: false },
        idempotencyKey: 'lifecycle-archive-project',
      }),
    )
    assert.deepEqual(await read(), [], 'an archived project leaves the ordinary list')
    assert.equal((await read(true)).length, 1, 'and is still there to be found')
  } finally {
    await e2e.close()
  }
})

test('a tag says how much work it is on before anyone archives it', async () => {
  // FLW-DEC-006 keeps tags company-scope; the block offering the button sits in
  // one project's settings, so the count is the only thing that says how far it
  // reaches. `tag.archive` deletes every IssueTag row there is.
  const { e2e, call, ok } = await boot()
  try {
    await project(call)
    ok(await call('flow.tag.save', { id: 't1', name: 'tech debt' }))
    for (const id of ['i1', 'i2', 'i3'])
      ok(
        await call('flow.issue.save', {
          id,
          projectId: 'p1',
          columnId: 'c-todo',
          title: id,
          tagIds: ['t1'],
          idempotencyKey: `lifecycle-tagged-${id}`,
        }),
      )
    const usage = async () =>
      Number(((await call<Row[]>('flow.tag.list', {})) as Row[]).find((row) => row.id === 't1')?.usage ?? -1)
    assert.equal(await usage(), 3)

    // Archiving an issue does not change what the tag would take with it: the
    // rows are still there, and archiving the tag would still delete them.
    const held = (
      (await call<{ rows: Row[] }>('flow.issue.list', {
        projectId: 'p1',
        listState: emptyIssueListState(),
      })) as { rows: Row[] }
    ).rows.find((row) => row.id === 'i1')!
    ok(
      await call('flow.issue.archive', {
        id: 'i1',
        expectedVersion: held.version,
        idempotencyKey: 'lifecycle-tag-archive-issue',
      }),
    )
    assert.equal(await usage(), 3)
  } finally {
    await e2e.close()
  }
})
