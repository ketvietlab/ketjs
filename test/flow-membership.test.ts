// The five things project membership has to be true about, proven end to end.
//
// FLW-DEC-012 made Flow's projects private to their members. That is one rule
// with a large blast radius: it is enforced in one module, `membership.ts`, and
// every read of project data in Flow is supposed to pass through it. This file
// is what stops "supposed to" from being the whole guarantee.
//
// Two of the tests are about behaviour and three are about the shape of the
// code, because behaviour tests alone cannot prove a negative — that no read
// path skipped the gate. The static test at the bottom does that part.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineDeployment } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, mail, partner, storage, user } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'
import flow from '../packages/ketsuite/src/modules/flow/index.ts'
import { functions as flowFunctions } from '../packages/ketsuite/src/modules/flow/functions.ts'
import livedoc from '../packages/ketsuite/src/modules/livedoc/index.ts'

const app = defineDeployment({
  name: 'flow_membership',
  modules: [address, partner, company, storage, user, mail, backend, livedoc, flow],
  headless: true,
  serve: { sessions: { anonymous: { company: 'acme' } } },
})

type Deployment = Awaited<ReturnType<typeof createTestDeployment>>

/**
 * The company, spelled out for the fixture channel.
 *
 * A session resolves this from the login; a fixture call does not, and reads
 * use the readable set rather than the write company, so both have to be said.
 */
const acme = { company: 'acme', companies: ['acme'], branches: null }

/**
 * Three people and three projects.
 *
 * `u1` and `u2` each make their own project, so each is a member of exactly
 * one. `root` is a superuser who is a member of nothing. `orphan` is made by
 * the fixture — no actor, so nobody is seeded onto it — which is the project
 * that proves a project with no members belongs to no one.
 */
async function boot(t: { after(fn: () => unknown): void }): Promise<Deployment> {
  const e2e = await createTestDeployment(app, { worker: false })
  t.after(() => e2e.close?.())
  const fixture = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input)

  await fixture('partner.savePartner', { id: 'p-acme', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'p-acme', currency: 'VND' })
  for (const [id, name, superuser] of [
    ['u1', 'Người thứ nhất', false],
    ['u2', 'Người thứ hai', false],
    ['root', 'Quản trị', true],
  ] as const) {
    await fixture('user.createUser', {
      id,
      login: id,
      password: 'test-password',
      name,
      defaultCompanyId: 'acme',
      superuser,
    })
    await fixture('user.grantCompany', { id: `${id}:acme`, userId: id, companyId: 'acme' })
  }

  // A project nobody is on, made the way one really gets that way: somebody
  // makes it, and then the last member is taken off. There is no other way —
  // making a project takes a command, a command takes an actor, and whoever
  // makes a project is put on it. This is the case `project.member.remove`
  // says is allowed, so it is the case worth proving nobody can then read.
  //
  // The results are checked because a refused command answers `ok: false`
  // rather than throwing, and a project that was never made would make every
  // assertion below pass for the wrong reason.
  const made = await e2e.fixture.call<{ ok: boolean }>(
    'flow.project.save',
    { values: { id: 'orphan', key: 'ORP', name: 'Không ai' }, idempotencyKey: 'project-orphan' },
    { actor: 'root', scope: acme },
  )
  assert.equal(made.value.ok, true, 'the memberless project is really there')
  const emptied = await e2e.fixture.call<{ ok: boolean }>(
    'flow.project.member.remove',
    { projectId: 'orphan', userId: 'root', idempotencyKey: 'orphan-empty' },
    { actor: 'root', scope: acme },
  )
  assert.equal(emptied.value.ok, true, 'and it really has nobody on it')
  return e2e
}

/** A complete list state — the reads that take one refuse a partial shape. */
const listState = (groupBy: ReadonlyArray<{ key: string }> = []) => ({
  q: '',
  presets: [],
  filters: [],
  groupBy,
  sort: [{ key: 'updatedAt', dir: 'desc' as const }],
  openGroups: [],
  groupPages: {},
  page: 1,
  includeArchived: false,
})

/**
 * Every read that answers with project data, as one list.
 *
 * Named once so the member and the stranger are asked exactly the same
 * questions — a list that only the stranger is asked proves nothing, because
 * an empty answer might be empty for everybody. Each entry says how to count
 * what came back, since the envelopes differ: some answer an array, some a
 * page with a total.
 */
/** Rows belonging to `proj1`, whichever envelope they arrived in. */
const ofProj1 = (rows: readonly Row[], key: 'id' | 'projectId') =>
  rows.filter((row) => String(row[key]) === 'proj1').length

const projectReads: ReadonlyArray<readonly [string, Record<string, unknown>, (value: never) => number]> = [
  // Counted as "how much of proj1 came back", never as "how much came back":
  // the stranger is a member of their own project and rightly sees it, so an
  // assertion that they see nothing at all would be asserting the wrong thing
  // — and would pass only until somebody gave them a project of their own.
  ['flow.project.list', {}, (v: Row[]) => ofProj1(v, 'id')],
  ['flow.project.stats', { projectIds: ['proj1'] }, (v: Row[]) => ofProj1(v, 'id')],
  ['flow.issue.list', { projectId: 'proj1' }, (v: { rows: Row[] }) => v.rows.length],
  ['flow.issue.list', {}, (v: { rows: Row[] }) => ofProj1(v.rows, 'projectId')],
  ['flow.issue.options', { projectId: 'proj1' }, (v: Row[]) => v.length],
  ['flow.issue.buckets', { projectId: 'proj1', listState: listState() }, (v: { total: number }) => v.total],
  [
    'flow.issue.group',
    { projectId: 'proj1', listState: listState([{ key: 'columnId' }]) },
    (v: Row[]) => v.length,
  ],
  ['flow.epic.list', { projectId: 'proj1' }, (v: Row[]) => v.length],
  ['flow.epic.listAll', {}, (v: { rows: Row[] }) => ofProj1(v.rows, 'projectId')],
  ['flow.page.list', { projectId: 'proj1' }, (v: Row[]) => v.length],
  ['flow.page.list', {}, (v: Row[]) => ofProj1(v, 'projectId')],
  ['flow.page.listAll', {}, (v: { rows: Row[] }) => ofProj1(v.rows, 'projectId')],
  ['flow.sprint.list', { projectId: 'proj1' }, (v: Row[]) => v.length],
] as const

/**
 * Sign in as somebody and answer as them.
 *
 * The deployment has one client, so signing in replaces the last session — and
 * a closure made earlier would quietly start speaking as whoever signed in
 * since. Each call checks and signs back in if it has to, so the name a test
 * calls through is who the call is really from, wherever it sits in the file.
 */
const signedIn = new WeakMap<Deployment, string>()

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

test('a member of one project sees one project, and the other one is not there', async (t) => {
  const e2e = await boot(t)

  const one = await as(e2e, 'u1')
  await one('flow.project.save', {
    values: { id: 'proj1', key: 'ONE', name: 'Dự án một' },
    idempotencyKey: 'project-one',
  })
  await one('flow.column.save', {
    values: { id: 'c1', projectId: 'proj1', code: 'todo', name: 'Cần làm' },
    idempotencyKey: 'column-todo',
  })
  await one('flow.issue.save', {
    id: 'i1',
    projectId: 'proj1',
    columnId: 'c1',
    title: 'Việc của một',
    idempotencyKey: 'issue-one',
  })
  await one('flow.epic.save', {
    values: { id: 'e1', projectId: 'proj1', title: 'Chặng một' },
    idempotencyKey: 'epic-one',
  })
  await one('flow.page.save', {
    id: 'pg1',
    projectId: 'proj1',
    title: 'Ghi chép một',
    idempotencyKey: 'page-one',
  })

  const two = await as(e2e, 'u2')
  await two('flow.project.save', {
    values: { id: 'proj2', key: 'TWO', name: 'Dự án hai' },
    idempotencyKey: 'project-two',
  })
  // A sprint too, so every list in `projectReads` has something to answer with
  // for the member.
  const back = await as(e2e, 'u1')
  await back('flow.sprint.save', {
    id: 's1',
    projectId: 'proj1',
    name: 'Chặng chạy một',
    idempotencyKey: 'sprint-one',
  })

  // Gate 1 — every read that answers with project data, asked twice.
  //
  // The member's answer has to be non-empty before the stranger's empty one
  // means anything: an assertion that a stranger sees nothing passes just as
  // well when nobody sees anything, which is how a filter that is quietly
  // broken in the other direction goes unnoticed. Some of these are asked with
  // no project named, because a filter written on the argument rather than on
  // the rule answers across every project exactly there.
  const member = await as(e2e, 'u1')
  for (const [fnKey, input, count] of projectReads)
    assert.ok(count((await member(fnKey, input)) as never) > 0, `${fnKey} answers the member`)
  const stranger = await as(e2e, 'u2')
  for (const [fnKey, input, count] of projectReads)
    assert.equal(count((await stranger(fnKey, input)) as never), 0, `${fnKey} answers the stranger`)

  // And the project each of them does hold is the one they hold.
  assert.deepEqual(
    ((await two<Row[]>('flow.project.list')) ?? []).map((row) => String(row.id)),
    ['proj2'],
  )

  // Gate 2 — by id. Not a refusal: the same `null` a row that is not there
  // gives. A refusal would confirm that `proj1` and its issue exist, which for
  // a project built to stay unseen is the half of the answer to withhold.
  assert.equal(await two('flow.project.get', { id: 'proj1' }), null)
  assert.equal(await two('flow.issue.get', { id: 'i1' }), null)
  assert.equal((await two<{ value: Row | null }>('flow.epic.get', { id: 'e1' })).value, null)
  assert.equal((await two<{ value: Row | null }>('flow.page.get', { id: 'pg1' })).value, null)
  assert.equal(await two('flow.project.get', { id: 'no-such-project' }), null)

  // Gate 3 — a project with no members belongs to nobody. Not to the person who
  // happens to be looking, and not to whoever made it, because nobody did.
  assert.equal(await stranger('flow.project.get', { id: 'orphan' }), null)
  const again = await as(e2e, 'u1')
  assert.equal(await again('flow.project.get', { id: 'orphan' }), null)
  assert.deepEqual(
    ((await again<Row[]>('flow.project.list')) ?? []).map((row) => String(row.id)),
    ['proj1'],
  )

  // And a write is refused the same way a read is: not found, not forbidden.
  // As `u2` again — the caller who is not on the project. Run as `u1` this
  // would succeed, and succeed correctly, which is what makes the login here
  // the whole point of the check.
  await as(e2e, 'u2')
  const denied = await e2e.client.call('flow.issue.save', {
    id: 'i1',
    projectId: 'proj1',
    columnId: 'c1',
    title: 'Sửa trộm',
    idempotencyKey: 'steal-one',
  })
  assert.equal((denied.value as Row).ok, false)

  // The Live Doc handles, which are the other way into a project's writing.
  // Each answers the attachment id that lets a caller open the document, and
  // `issue.editDescription` is the authority the push route checks before it
  // lets somebody rewrite the text — a gap in any of the four would be a
  // stranger reading, or writing, a document they cannot see the record for.
  assert.equal(await two('flow.issue.editDescription', { id: 'i1' }), null)
  assert.equal(await two('flow.project.editContent', { id: 'proj1' }), null)
  assert.equal(await two('flow.epic.editContent', { id: 'e1' }), null)
  assert.equal(await two('flow.page.editContent', { id: 'pg1' }), null)

  // And the archive commands, which are how a project gets taken apart. Pages
  // are here too because every page path — save, move, reorder, archive,
  // restore — reaches its row through one function, so one of them standing
  // stands for all five.
  for (const [fnKey, id] of [
    ['flow.column.archive', 'c1'],
    ['flow.epic.archive', 'e1'],
    ['flow.page.archive', 'pg1'],
  ] as const)
    assert.equal((await two<Row>(fnKey, { id })).ok, false, fnKey)
})

test('the grant row is the door, and being a superuser is the documented exception', async (t) => {
  const e2e = await boot(t)

  const one = await as(e2e, 'u1')
  await one('flow.project.save', {
    values: { id: 'proj1', key: 'ONE', name: 'Dự án một' },
    idempotencyKey: 'project-one',
  })

  // Gate 4a — a superuser reads every project without being a member of any.
  // Deliberate, and the same answer `crm.caseAudience` gives: the technical
  // root account is not the thing this rule was written to hold back.
  const asRoot = async (name: string, input: Record<string, unknown> = {}) =>
    (await e2e.fixture.call<Row[]>(name, input, { actor: 'root', scope: acme })).value
  assert.deepEqual((await asRoot('flow.project.list')).map((row) => String(row.id)).sort(), [
    'orphan',
    'proj1',
  ])

  // Gate 4b — for everybody else the only way through is a row somebody wrote
  // on purpose. `u2` is a member of nothing and sees nothing; after the grant
  // the same call answers with everything, and revoking closes it again.
  const two = await as(e2e, 'u2')
  assert.deepEqual(await two<Row[]>('flow.project.list'), [])

  await e2e.fixture.call(
    'flow.project.access.grant',
    { userId: 'u2', idempotencyKey: 'grant-u2' },
    { actor: 'root', scope: acme },
  )
  assert.deepEqual(((await two<Row[]>('flow.project.list')) ?? []).map((row) => String(row.id)).sort(), [
    'orphan',
    'proj1',
  ])

  await e2e.fixture.call(
    'flow.project.access.revoke',
    { userId: 'u2', idempotencyKey: 'revoke-u2' },
    { actor: 'root', scope: acme },
  )
  assert.deepEqual(await two<Row[]>('flow.project.list'), [])

  // Gate 4c — and being added to one project opens one project, not the rest.
  await e2e.fixture.call(
    'flow.project.member.add',
    { projectId: 'proj1', userId: 'u2', idempotencyKey: 'member-add-u2' },
    { actor: 'root', scope: acme },
  )
  assert.deepEqual(
    ((await two<Row[]>('flow.project.list')) ?? []).map((row) => String(row.id)),
    ['proj1'],
  )
})

/**
 * Gate 5 — the part behaviour cannot prove.
 *
 * A test that reads project data as a stranger proves the paths it happens to
 * call are gated. It cannot prove that the path somebody adds next month is,
 * and that is the failure this rule actually dies of. So this asserts the
 * property that makes the gate unskippable rather than the behaviour of one
 * call: reading Flow's project content requires the membership tables, and the
 * effect system refuses at runtime to let a function touch a table it did not
 * declare. A new read path that forgets the gate cannot also remember to
 * declare it.
 */
test('every function that reads project content declares the membership tables', () => {
  const content = ['flow.Issue', 'flow.Epic', 'flow.Page', 'flow.Sprint', 'flow.Project']
  const gate = ['read:flow.ProjectMember', 'read:flow.ProjectAccessGrant']

  const ungated = Object.entries(flowFunctions)
    .filter(([, fn]) => {
      const effects = (fn as { effects?: readonly string[] }).effects ?? []
      return effects.some(
        (effect) => content.includes(effect.replace(/^read:/, '')) && effect.startsWith('read:'),
      )
    })
    .filter(([, fn]) => {
      const effects = (fn as { effects?: readonly string[] }).effects ?? []
      return !gate.every((needed) => effects.includes(needed))
    })
    .map(([key]) => key)

  assert.deepEqual(ungated, [])
})

/**
 * And the gate answers from data, never from a permission.
 *
 * `Ctx` has no allow-list — only `ServeContext` does — so a capability check
 * inside the filter is not merely discouraged, it is unavailable. Writing that
 * down here means the day somebody threads permissions into domain code, the
 * reason this file was built the way it was does not have to be rediscovered.
 */
test('the membership filter reads rows, not capabilities', async () => {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('packages/ketsuite/src/modules/flow/membership.ts', 'utf8')
  for (const forbidden of ['allows(', 'permission', 'bundle']) {
    assert.equal(source.includes(forbidden), false, `membership.ts must not consult ${forbidden}`)
  }
  assert.equal(source.includes("select('flow.ProjectMember'"), true)
})
