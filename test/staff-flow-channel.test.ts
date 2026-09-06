// The staff channel for project work.
//
// The thing worth testing here is not that the routes return JSON. It is that
// membership (FLW-DEC-012) reaches the phone without having been written a
// second time: every route calls a Flow function, so a caller who is not on a
// project sees nothing of it here for exactly the reason they see nothing of
// it on the web. A channel that had gone to the store directly would pass a
// shape test and fail this one.
//
// See FLW-DEC-019.

import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

type Envelope<T> = { data: T; error: { code: string } | null }

/** The Flow keys a staff client's routes reach through. */
const readerFunctions = [
  'flow.project.list',
  'flow.issue.list',
  'flow.issue.get',
  'flow.issue.buckets',
  'flow.issue.move',
  'flow.issue.save',
  'flow.issue.comment',
  'flow.column.list',
]

const boot = async (t: TestContext) => {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const fixture = <T = Row>(name: string, input: Record<string, unknown>, actor?: string) =>
    e2e.fixture.call<T>(name, input, { scope, actor }).then((result) => result.value)

  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'Kết Việt' })
  await fixture('company.saveCompany', {
    id: 'acme',
    code: 'ACME',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse battery',
    name: 'Administrator',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })

  // Two people who each carry work, and who are on different projects. One of
  // them is the point of the whole file.
  for (const [id, name] of [
    ['worker', 'Người làm việc'],
    ['outsider', 'Người dự án khác'],
  ] as const) {
    await fixture('user.createUser', {
      id,
      login: id,
      password: 'correct horse battery',
      name,
      defaultCompanyId: 'acme',
      superuser: false,
    })
    await fixture('user.grantCompany', { id: `${id}:acme`, userId: id, companyId: 'acme' })
  }

  // The same role for both, so nothing below can be explained by one of them
  // holding a permission the other does not. What separates them is membership.
  await fixture('user.saveRole', { id: 'flow-worker', name: 'Flow worker' })
  for (const fnKey of readerFunctions)
    await fixture('user.grantFunction', { id: `flow-worker:${fnKey}`, roleId: 'flow-worker', fnKey })
  for (const userId of ['worker', 'outsider'])
    await fixture('user.assignRole', {
      id: `${userId}:flow-worker`,
      userId,
      roleId: 'flow-worker',
    })

  // Each makes their own project, which puts them on it and nobody else.
  for (const [userId, projectId, key, name] of [
    ['worker', 'ours', 'OURS', 'Dự án của chúng tôi'],
    ['outsider', 'theirs', 'THRS', 'Dự án của họ'],
  ] as const) {
    await fixture(
      'flow.project.save',
      { values: { id: projectId, key, name }, idempotencyKey: `staff-flow-${projectId}` },
      userId,
    )
    await fixture(
      'flow.column.save',
      {
        values: { id: `${projectId}-todo`, projectId, code: 'todo', name: 'Cần làm' },
        idempotencyKey: `staff-flow-col-${projectId}`,
      },
      userId,
    )
  }
  await fixture(
    'flow.column.save',
    {
      values: { id: 'ours-done', projectId: 'ours', code: 'done', name: 'Xong', terminalState: true },
      idempotencyKey: 'staff-flow-col-ours-done',
    },
    'worker',
  )

  for (const [id, title, projectId, userId] of [
    ['ours-1', 'Việc thứ nhất', 'ours', 'worker'],
    ['ours-2', 'Việc thứ hai', 'ours', 'worker'],
    ['theirs-1', 'Việc của họ', 'theirs', 'outsider'],
  ] as const)
    await fixture(
      'flow.issue.save',
      {
        id,
        projectId,
        columnId: `${projectId}-todo`,
        title,
        assigneeUserId: userId,
        idempotencyKey: `staff-flow-issue-${id}`,
      },
      userId,
    )
  return e2e
}

type Deployment = Awaited<ReturnType<typeof boot>>

const asWorker = async (e2e: Deployment, login = 'worker') =>
  e2e.client.login({ login, password: 'correct horse battery' })

/** A cookie session travels on a cross-site POST, so a mutation carries a token. */
const csrfFor = async (e2e: Deployment) =>
  (await e2e.client.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')).data.csrfToken

const mutation = (csrf: string, key: string) => ({
  'content-type': 'application/json',
  'x-csrf-token': csrf,
  'idempotency-key': key,
})

test('staff Flow channel requires a session and lists only the caller’s projects', async (t) => {
  const e2e = await boot(t)
  assert.equal((await e2e.client.get('/api/staff/v1/flow/projects')).status, 401)

  await asWorker(e2e)
  const mine = (await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/flow/projects')).data
  assert.deepEqual(
    mine.items.map((item) => String(item.id)),
    ['ours'],
  )

  // The other person holds the same role and sees the other project. Same
  // permissions, different membership — which is the whole claim.
  await asWorker(e2e, 'outsider')
  const theirs = (await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/flow/projects')).data
  assert.deepEqual(
    theirs.items.map((item) => String(item.id)),
    ['theirs'],
  )
})

test('staff Flow channel pages issues and never crosses a project boundary', async (t) => {
  const e2e = await boot(t)
  await asWorker(e2e)

  const page = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      '/api/staff/v1/flow/issues?limit=1',
    )
  ).data
  assert.equal(page.items.length, 1)
  assert.ok(page.nextCursor)

  const rest = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      `/api/staff/v1/flow/issues?limit=1&cursor=${encodeURIComponent(page.nextCursor!)}`,
    )
  ).data
  assert.equal(rest.nextCursor, null)
  assert.deepEqual(
    [...page.items, ...rest.items].map((item) => String(item.id)).sort(),
    ['ours-1', 'ours-2'],
    'two issues, and not the third',
  )

  // Naming the other project explicitly does not open it. A filter is not a
  // permission, and asking for somebody else's project answers with nothing.
  const named = (
    await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/flow/issues?projectId=theirs')
  ).data
  assert.deepEqual(named.items, [])
})

test('staff Flow channel answers not found for an issue in another project', async (t) => {
  const e2e = await boot(t)
  await asWorker(e2e)

  const own = await e2e.client.json<Envelope<Row>>('/api/staff/v1/flow/issues/ours-1')
  assert.equal(String(own.data.id), 'ours-1')

  // Not 403. Telling the caller that `theirs-1` exists but is not theirs would
  // tell them a project is there, which is the half of the answer this rule
  // exists to withhold — and it arrives identically to an id that never was.
  const other = await e2e.client.get('/api/staff/v1/flow/issues/theirs-1')
  const missing = await e2e.client.get('/api/staff/v1/flow/issues/never-existed')
  assert.equal(other.status, 404)
  assert.equal(missing.status, 404)
})

test('staff Flow channel moves, assigns and comments on issues the caller can reach', async (t) => {
  const e2e = await boot(t)
  await asWorker(e2e)
  const csrf = await csrfFor(e2e)
  const post = (path: string, key: string, body: Row) =>
    e2e.client.request(path, {
      method: 'POST',
      headers: mutation(csrf, key),
      body: JSON.stringify(body),
    })

  // Without the token the same request is refused, because a cookie would have
  // carried it from any site that asked.
  assert.equal(
    (
      await e2e.client.request('/api/staff/v1/flow/issues/ours-1/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'staff-flow-move-0' },
        body: JSON.stringify({ columnId: 'ours-done', expectedVersion: 1 }),
      })
    ).status,
    403,
  )

  const moved = await post('/api/staff/v1/flow/issues/ours-1/move', 'staff-flow-move-1', {
    columnId: 'ours-done',
    expectedVersion: 1,
  })
  assert.equal(moved.status, 200)
  assert.equal(
    String(((await moved.json()) as Envelope<Row>).data.columnId),
    'ours-done',
    'and answers with the issue as it now is',
  )

  const assigned = await post('/api/staff/v1/flow/issues/ours-2/assign', 'staff-flow-assign-1', {
    assigneeUserId: null,
    expectedVersion: 1,
  })
  assert.equal(assigned.status, 200)
  assert.equal(((await assigned.json()) as Envelope<Row>).data.assigneeUserId, null)

  const said = await post('/api/staff/v1/flow/issues/ours-1/comment', 'staff-flow-comment-1', {
    body: 'Đã xong phần của tôi',
  })
  assert.equal(said.status, 200)
  const first = ((await said.json()) as Envelope<{ id: string }>).data.id

  // The same key again answers the same id rather than writing a second
  // comment: a retry from a phone that lost its connection has to be a replay,
  // not a duplicate.
  const again = await post('/api/staff/v1/flow/issues/ours-1/comment', 'staff-flow-comment-1', {
    body: 'Đã xong phần của tôi',
  })
  assert.equal(again.status, 200)
  assert.equal(((await again.json()) as Envelope<{ id: string }>).data.id, first)
})

test('staff Flow channel refuses every command against another project', async (t) => {
  const e2e = await boot(t)
  await asWorker(e2e)
  const csrf = await csrfFor(e2e)
  const post = (path: string, key: string, body: Row) =>
    e2e.client.request(path, {
      method: 'POST',
      headers: mutation(csrf, key),
      body: JSON.stringify(body),
    })

  // Reading is not the only door. Each command reaches the issue through the
  // same gate, so all three answer not found rather than doing the work.
  for (const [path, key, body] of [
    [
      '/api/staff/v1/flow/issues/theirs-1/move',
      'x-move-key',
      { columnId: 'theirs-todo', expectedVersion: 1 },
    ],
    [
      '/api/staff/v1/flow/issues/theirs-1/assign',
      'x-assign-key',
      { assigneeUserId: 'worker', expectedVersion: 1 },
    ],
    ['/api/staff/v1/flow/issues/theirs-1/comment', 'x-comment-key', { body: 'trộm' }],
  ] as const)
    assert.equal((await post(path, key, body as Row)).status, 404, path)

  // And nothing happened to it: the other person still sees their issue where
  // it was, unassigned by nobody and uncommented on.
  await asWorker(e2e, 'outsider')
  const held = await e2e.client.json<Envelope<Row>>('/api/staff/v1/flow/issues/theirs-1')
  assert.equal(String(held.data.columnId), 'theirs-todo')
  assert.equal(String(held.data.assigneeUserId), 'outsider')
})

test('staff Flow overview counts only what the caller carries', async (t) => {
  const e2e = await boot(t)
  await asWorker(e2e)

  assert.equal((await e2e.client.get('/api/staff/v1/flow/overview')).status, 422)
  const mine = (await e2e.client.json<Envelope<Row>>('/api/staff/v1/flow/overview?today=2026-09-05')).data
  assert.equal(mine.projectCount, 1)
  assert.equal(mine.total, 2)
  assert.equal(mine.asOf, '2026-09-05')

  await asWorker(e2e, 'outsider')
  const theirs = (await e2e.client.json<Envelope<Row>>('/api/staff/v1/flow/overview?today=2026-09-05')).data
  assert.equal(theirs.projectCount, 1)
  assert.equal(theirs.total, 1)
})

/**
 * Somebody taken off a project while their phone is still open.
 *
 * The gap this closes is a timing one, and timing is the shape of gap a test
 * that only checks "a stranger is refused" cannot see. A phone holds a screen
 * for as long as it is in a pocket: the reads that filled it happened when the
 * caller was still on the project, and the command they send afterwards
 * happens when they are not. Every command here reads the issue again before
 * it writes, so the answer arrives from the same gate the first read passed —
 * but nothing proved that until now.
 */
test('losing access mid-flight stops the next command, not just the next read', async (t) => {
  const e2e = await boot(t)
  const worker = await asWorker(e2e)
  const csrf = await csrfFor(e2e)
  const post = (path: string, key: string, body: Row) =>
    e2e.client.request(path, {
      method: 'POST',
      headers: mutation(csrf, key),
      body: JSON.stringify(body),
    })

  // The screen the phone is holding: read while still a member.
  const held = await e2e.client.json<Envelope<Row>>('/api/staff/v1/flow/issues/ours-1')
  assert.equal(String(held.data.id), 'ours-1')
  const version = Number(held.data.version)

  // Taken off the project in between, by somebody at a desk.
  await e2e.fixture.call(
    'flow.project.member.remove',
    { projectId: 'ours', userId: 'worker', idempotencyKey: 'remove-worker-mid' },
    { actor: 'admin', scope: { company: 'acme', branches: null } },
  )

  // The command was composed against a version that was real, and is refused
  // on the ground that matters: the issue is no longer theirs to reach. Not a
  // version conflict — the version is still current — and not a 403, which
  // would confirm the project is there.
  const moved = await post('/api/staff/v1/flow/issues/ours-1/move', 'lost-access-move', {
    columnId: 'ours-done',
    expectedVersion: version,
  })
  assert.equal(moved.status, 404)

  for (const [path, key, body] of [
    [
      '/api/staff/v1/flow/issues/ours-1/assign',
      'lost-assign',
      { assigneeUserId: null, expectedVersion: version },
    ],
    ['/api/staff/v1/flow/issues/ours-1/comment', 'lost-comment', { body: 'vẫn gửi được?' }],
  ] as const)
    assert.equal((await post(path, key, body as Row)).status, 404, path)

  // And the reads close behind them too, so the next refresh shows the truth
  // rather than a screen that still works until something is pressed.
  assert.equal((await e2e.client.get('/api/staff/v1/flow/issues/ours-1')).status, 404)
  assert.deepEqual(
    (await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/flow/projects')).data.items,
    [],
  )

  // Nothing happened to the issue: the person still on the project sees it
  // where it was.
  await asWorker(e2e, 'outsider')
  await e2e.fixture.call(
    'flow.project.member.add',
    { projectId: 'ours', userId: 'outsider', idempotencyKey: 'add-outsider-check' },
    { actor: 'admin', scope: { company: 'acme', branches: null } },
  )
  const after = await e2e.client.json<Envelope<Row>>('/api/staff/v1/flow/issues/ours-1')
  assert.equal(String(after.data.columnId), 'ours-todo')
  assert.equal(Number(after.data.version), version)
})
