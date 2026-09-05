// Taking an issue to another project, and what it can and cannot bring.
//
// Almost everything an issue points at belongs to the project it is in —
// columns, types, epics, sprints and custom field definitions are all keyed by
// project — so a move is mostly a question of what survives the crossing. The
// answers are not arbitrary and each is asserted here rather than described:
// values whose field code exists on the other side travel, epics and sprints
// cannot, and tags are untouched because a tag is the company's.
//
// See FLW-020.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineDeployment } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, mail, partner, storage, user } from '@ketvietlab/ketsuite'
import flow from '../packages/ketsuite/src/modules/flow/index.ts'

const app = defineDeployment({
  name: 'flow_issue_transfer',
  modules: [address, partner, company, storage, user, mail, flow],
  headless: true,
  serve: { sessions: { anonymous: { company: 'acme' } } },
})

type Deployment = Awaited<ReturnType<typeof createTestDeployment>>

const signedIn = new WeakMap<Deployment, string>()

/** Sign in as somebody and answer as them, whatever happened in between. */
async function as(e2e: Deployment, login: string) {
  const enter = async () => {
    await e2e.client.login({ login, password: 'test-password' })
    signedIn.set(e2e, login)
  }
  await enter()
  return async <T = Row>(name: string, input: Record<string, unknown> = {}) => {
    if (signedIn.get(e2e) !== login) await enter()
    return (await e2e.client.call<T>(name, input)).value
  }
}

/**
 * Two projects that are alike in some ways and not others.
 *
 * `from` and `to` both have a `bug` type and a `severity` field, so those can
 * cross. `from` alone has `origin`, which cannot. That asymmetry is the whole
 * point of the fixture: a destination that matched everything would prove only
 * that nothing was dropped.
 */
async function boot(t: { after(fn: () => unknown): void }) {
  const e2e = await createTestDeployment(app, { worker: false })
  t.after(() => e2e.close?.())
  const fixture = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input)

  await fixture('partner.savePartner', { id: 'p-acme', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'p-acme', currency: 'VND' })
  for (const id of ['u1', 'u2'])
    await fixture('user.createUser', {
      id,
      login: id,
      password: 'test-password',
      name: id,
      defaultCompanyId: 'acme',
    })
  for (const id of ['u1', 'u2'])
    await fixture('user.grantCompany', { id: `${id}:acme`, userId: id, companyId: 'acme' })

  const call = await as(e2e, 'u1')
  for (const [id, key, name] of [
    ['from', 'FROM', 'Dự án nguồn'],
    ['to', 'TO', 'Dự án đích'],
  ] as const)
    await call('flow.project.save', { values: { id, key, name }, idempotencyKey: `project-${id}` })

  // Columns: the destination's first is terminal on purpose, so the default
  // landing has to skip it rather than report the issue finished on arrival.
  for (const [id, projectId, code, name, sequence, terminal] of [
    ['from-todo', 'from', 'todo', 'Cần làm', 10, false],
    ['to-done', 'to', 'done', 'Xong', 10, true],
    ['to-todo', 'to', 'todo', 'Cần làm', 20, false],
  ] as const)
    await call('flow.column.save', {
      values: { id, projectId, code, name, sequence, terminalState: terminal },
      idempotencyKey: `column-${id}`,
    })

  for (const [id, projectId, code, name] of [
    ['from-bug', 'from', 'bug', 'Lỗi'],
    ['to-bug', 'to', 'bug', 'Lỗi'],
  ] as const)
    await call('flow.issueType.save', {
      values: { id, projectId, code, name },
      idempotencyKey: `type-${id}`,
    })

  for (const [id, projectId, code, name] of [
    ['from-severity', 'from', 'severity', 'Mức độ'],
    ['from-origin', 'from', 'origin', 'Nguồn gốc'],
    ['to-severity', 'to', 'severity', 'Mức độ'],
  ] as const)
    await call('flow.field.save', {
      id,
      projectId,
      code,
      name,
      kind: 'text',
      idempotencyKey: `field-${id}`,
    })

  await call('flow.epic.save', {
    values: { id: 'from-epic', projectId: 'from', title: 'Chặng của nguồn' },
    idempotencyKey: 'epic-from',
  })
  await call('flow.sprint.save', {
    id: 'from-sprint',
    projectId: 'from',
    name: 'Chặng chạy',
    idempotencyKey: 'sprint-from',
  })
  await call('flow.tag.save', { id: 'urgent', name: 'Gấp' })

  const made = (await call<Row>('flow.issue.save', {
    id: 'issue-1',
    projectId: 'from',
    columnId: 'from-todo',
    typeId: 'from-bug',
    epicId: 'from-epic',
    title: 'Việc sẽ chuyển',
    tagIds: ['urgent'],
    fields: { severity: 'cao', origin: 'khách báo' },
    idempotencyKey: 'issue-one',
  })) as Row
  await call('flow.issue.assignSprint', {
    id: 'issue-1',
    sprintId: 'from-sprint',
    expectedVersion: Number(made.version),
    idempotencyKey: 'assign-sprint-one',
  })
  return { e2e, call }
}

test('an issue takes what the destination recognises and leaves the rest', async (t) => {
  const { e2e, call } = await boot(t)

  const before = (await call<Row>('flow.issue.get', { id: 'issue-1' })) as Row
  assert.equal(String(before.projectId), 'from')

  const moved = (await call<Row>('flow.issue.transfer', {
    id: 'issue-1',
    projectId: 'to',
    expectedVersion: Number(before.version),
    idempotencyKey: 'transfer-one',
  })) as Row
  assert.equal(moved.ok, true)

  // Landed in the first column work arrives in, not the terminal one that
  // happens to sort first.
  assert.equal(String(moved.columnId), 'to-todo')

  // `severity` exists on both sides and crossed; `origin` does not and was
  // dropped — and the command says so rather than losing it quietly.
  assert.equal(Number(moved.fieldsCarried), 1)
  assert.equal(Number(moved.fieldsDropped), 1)

  // The epic and the sprint belong to the project it left.
  assert.equal(moved.epicCleared, true)
  assert.equal(moved.sprintCleared, true)
  assert.equal(moved.typeCleared, false, 'but the type had a counterpart by code')

  const after = (await call<Row>('flow.issue.get', { id: 'issue-1' })) as Row
  assert.equal(String(after.projectId), 'to')
  assert.equal(String(after.columnId), 'to-todo')
  assert.equal(String(after.typeId), 'to-bug', 'mapped by code, not carried by id')
  assert.equal(after.epicId, null)
  assert.equal(after.sprintId, null)
  assert.equal(String(after.title), 'Việc sẽ chuyển', 'and it is the same issue, not a copy')

  // A tag belongs to the company rather than to the project that used it
  // (FLW-DEC-006), so nothing about it changes.
  const tagged = (await call<Row>('flow.issue.list', { projectId: 'to' })) as { rows: Row[] }
  assert.equal(tagged.rows.length, 1)

  // The values themselves, read from the store: the one that crossed points at
  // the destination's own definition, and the one that did not is gone.
  const values = await e2e.fixture.withTenant('acme', async ({ adapter }) => {
    const rows = await adapter.all(
      'SELECT "fieldId", "value" FROM flow_issue_field_value WHERE "issueId" = ?',
      ['issue-1'] as never[],
    )
    return rows.map((row) => [String(row.fieldId), String(row.value)] as const)
  })
  assert.deepEqual(values, [['to-severity', 'cao']])
})

test('a move refuses what it cannot do cleanly', async (t) => {
  const { call } = await boot(t)
  const held = (await call<Row>('flow.issue.get', { id: 'issue-1' })) as Row
  const version = Number(held.version)

  // Its own project is not a destination.
  assert.equal(
    (
      (await call<Row>('flow.issue.transfer', {
        id: 'issue-1',
        projectId: 'from',
        expectedVersion: version,
        idempotencyKey: 'transfer-same',
      })) as Row
    ).ok,
    false,
    'the project it is already in',
  )

  // A stale version loses, the same as every other issue command.
  assert.equal(
    (
      (await call<Row>('flow.issue.transfer', {
        id: 'issue-1',
        projectId: 'to',
        expectedVersion: version - 1,
        idempotencyKey: 'transfer-stale',
      })) as Row
    ).ok,
    false,
    'a version somebody read before the last edit',
  )

  // A named column that belongs to a different project is not a landing place.
  assert.equal(
    (
      (await call<Row>('flow.issue.transfer', {
        id: 'issue-1',
        projectId: 'to',
        columnId: 'from-todo',
        expectedVersion: version,
        idempotencyKey: 'transfer-wrong-col',
      })) as Row
    ).ok,
    false,
    "the source project's own column",
  )

  // Children would be left behind pointing at a parent in another project,
  // which is the orphan shape the purge job takes care to avoid.
  await call('flow.issue.save', {
    id: 'issue-child',
    projectId: 'from',
    columnId: 'from-todo',
    parentIssueId: 'issue-1',
    title: 'Việc con',
    idempotencyKey: 'issue-child',
  })
  assert.equal(
    (
      (await call<Row>('flow.issue.transfer', {
        id: 'issue-1',
        projectId: 'to',
        expectedVersion: version,
        idempotencyKey: 'transfer-parent',
      })) as Row
    ).ok,
    false,
    'an issue that has children',
  )

  // And nothing happened through any of that.
  const still = (await call<Row>('flow.issue.get', { id: 'issue-1' })) as Row
  assert.equal(String(still.projectId), 'from')
  assert.equal(Number(still.version), version)
})

test('a project you cannot see is not a destination, and not a source either', async (t) => {
  const { e2e, call } = await boot(t)
  const held = (await call<Row>('flow.issue.get', { id: 'issue-1' })) as Row

  // `u2` is on neither project. Moving *into* `to` is writing to a project
  // they cannot see; the issue in `from` is one they cannot read. Both answer
  // not found, which is the same answer an id that never existed gives.
  const stranger = await as(e2e, 'u2')
  assert.equal(
    (
      (await stranger<Row>('flow.issue.transfer', {
        id: 'issue-1',
        projectId: 'to',
        expectedVersion: Number(held.version),
        idempotencyKey: 'transfer-stranger',
      })) as Row
    ).ok,
    false,
  )

  // Put them on the source only: they can now read the issue, and still cannot
  // send it somewhere they have no standing.
  await e2e.fixture.call(
    'flow.project.member.add',
    { projectId: 'from', userId: 'u2', idempotencyKey: 'member-u2-from' },
    { actor: 'u1', scope: { company: 'acme', companies: ['acme'], branches: null } },
  )
  const half = (await stranger<Row>('flow.issue.transfer', {
    id: 'issue-1',
    projectId: 'to',
    expectedVersion: Number(held.version),
    idempotencyKey: 'transfer-half',
  })) as Row
  assert.equal(half.ok, false, 'reading the issue is not permission to place it')
  assert.equal(
    String((half.errors as Row[])?.[0]?.field),
    'projectId',
    'and the refusal names the end they lack',
  )

  const owner = await as(e2e, 'u1')
  assert.equal(String(((await owner<Row>('flow.issue.get', { id: 'issue-1' })) as Row).projectId), 'from')
})

/**
 * One action over many issues (FLW-037).
 *
 * The thing worth asserting is not that forty issues move — it is what happens
 * when one of them cannot. A bulk action that failed atomically would leave
 * somebody with forty ticked rows and no idea which one was the problem, and
 * one that swallowed the failure would leave them believing it worked.
 */
test('a bulk action applies what it can and names what it could not', async (t) => {
  const { e2e, call } = await boot(t)

  for (const id of ['issue-2', 'issue-3'])
    await call('flow.issue.save', {
      id,
      projectId: 'from',
      columnId: 'from-todo',
      title: `Việc ${id}`,
      idempotencyKey: `bulk-seed-${id}`,
    })

  // One id in the batch is an issue that does not exist. The rest are real.
  const done = (await call<Row>('flow.issue.bulk', {
    ids: ['issue-1', 'issue-2', 'issue-3', 'never-existed'],
    action: 'archive',
    idempotencyKey: 'bulk-archive-one',
  })) as Row
  assert.equal(done.ok, true, 'the request itself succeeded')
  assert.equal(Number(done.applied), 3)
  assert.deepEqual(done.refused, [{ id: 'never-existed', code: 'flow.error.notFound' }])

  // The three really are archived — the count is not the only evidence.
  const left = (await call<Row>('flow.issue.list', { projectId: 'from' })) as { rows: Row[] }
  assert.deepEqual(left.rows, [])

  // And back again, which is the same shape in the other direction.
  const restored = (await call<Row>('flow.issue.bulk', {
    ids: ['issue-1', 'issue-2'],
    action: 'restore',
    idempotencyKey: 'bulk-restore-one',
  })) as Row
  assert.equal(Number(restored.applied), 2)
  assert.equal(
    ((await call<Row>('flow.issue.list', { projectId: 'from' })) as { rows: Row[] }).rows.length,
    2,
  )
})

test('a bulk action refuses to be a way around membership, or to run unbounded', async (t) => {
  const { e2e, call } = await boot(t)

  await call('flow.issue.save', {
    id: 'issue-elsewhere',
    projectId: 'to',
    columnId: 'to-todo',
    title: 'Việc dự án khác',
    idempotencyKey: 'bulk-elsewhere',
  })

  // `u2` is on neither project. Naming ids in a batch is not a way to reach
  // issues a single call would refuse: each one goes through the same gate.
  const stranger = await as(e2e, 'u2')
  const denied = (await stranger<Row>('flow.issue.bulk', {
    ids: ['issue-1', 'issue-elsewhere'],
    action: 'archive',
    idempotencyKey: 'bulk-stranger',
  })) as Row
  assert.equal(Number(denied.applied), 0)
  assert.equal((denied.refused as Row[]).length, 2)
  assert.deepEqual(
    [...new Set((denied.refused as Row[]).map((row) => String(row.code)))],
    ['flow.error.notFound'],
    'not found, the same answer a single call gives',
  )

  const owner = await as(e2e, 'u1')
  const still = (await owner<Row>('flow.issue.list', { projectId: 'from' })) as { rows: Row[] }
  assert.equal(still.rows.length, 1, 'and nothing was archived')

  // Bounded on purpose: one request cannot be asked to walk a whole company.
  const tooMany = (await owner<Row>('flow.issue.bulk', {
    ids: Array.from({ length: 201 }, (_, index) => `id-${index}`),
    action: 'archive',
    idempotencyKey: 'bulk-too-many',
  })) as Row
  assert.equal(tooMany.ok, false)
  assert.equal(String((tooMany.errors as Row[])[0]?.code), 'flow.error.tooMany')

  // An action it does not have refuses rather than doing something adjacent.
  const unknown = (await owner<Row>('flow.issue.bulk', {
    ids: ['issue-1'],
    action: 'delete',
    idempotencyKey: 'bulk-unknown-action',
  })) as Row
  assert.equal(unknown.ok, false)
  assert.equal(String((unknown.errors as Row[])[0]?.code), 'flow.error.invalidAction')
})

/**
 * A copy crosses the same way a move does, and leaves the original alone.
 *
 * The mapping is shared on purpose: a type or a field with no counterpart on
 * the other side has none whether the issue is moving or being duplicated. What
 * differs is what a copy deliberately does not bring.
 */
test('a copy lands in the other project without taking the original with it', async (t) => {
  const { e2e, call } = await boot(t)

  const made = (await call<Row>('flow.issue.copyTo', {
    id: 'issue-1',
    projectId: 'to',
    idempotencyKey: 'copy-issue-one',
  })) as Row
  assert.equal(made.ok, true)
  assert.equal(String(made.columnId), 'to-todo', 'the same landing rule as a move')
  assert.equal(Number(made.fieldsCarried), 1)
  assert.equal(Number(made.fieldsDropped), 1)

  // The original is untouched — still in its project, still in its sprint.
  const original = (await call<Row>('flow.issue.get', { id: 'issue-1' })) as Row
  assert.equal(String(original.projectId), 'from')
  assert.equal(String(original.sprintId), 'from-sprint')
  assert.equal(String(original.epicId), 'from-epic')

  const copy = (await call<Row>('flow.issue.get', { id: String(made.id) })) as Row
  assert.equal(String(copy.projectId), 'to')
  assert.equal(String(copy.title), 'Việc sẽ chuyển')
  assert.equal(String(copy.typeId), 'to-bug')
  // Neither belongs to the destination, so neither came across.
  assert.equal(copy.epicId, null)
  assert.equal(copy.sprintId, null)

  // The history did not come with it. The comments and followers on the
  // original are a record of a conversation about that issue, and duplicating
  // them would put words in people's mouths on a record they never saw.
  assert.notEqual(String(copy.threadId), String(original.threadId), 'a thread of its own')

  // The same key again answers the same id rather than making a second copy.
  const again = (await call<Row>('flow.issue.copyTo', {
    id: 'issue-1',
    projectId: 'to',
    idempotencyKey: 'copy-issue-one',
  })) as Row
  assert.equal(String(again.id), String(made.id))
  assert.equal(((await call<Row>('flow.issue.list', { projectId: 'to' })) as { rows: Row[] }).rows.length, 1)

  // And a project the caller cannot see is not a destination for a copy either.
  const stranger = await as(e2e, 'u2')
  assert.equal(
    (
      (await stranger<Row>('flow.issue.copyTo', {
        id: 'issue-1',
        projectId: 'to',
        idempotencyKey: 'copy-stranger',
      })) as Row
    ).ok,
    false,
  )
})
