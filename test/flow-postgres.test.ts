// What two people starting a sprint at the same time actually gets you.
//
// `startSprint` reads "is any sprint already active in this project" and then
// writes, both inside one transaction. On SQLite that is safe because writers
// are serialized; on PostgreSQL at READ COMMITTED two transactions can each
// read zero active sprints and each write one, and a project ends up with two
// current sprints — which makes "the current sprint" undefined for every board
// and figure that asks for it.
//
// The model DSL has no partial unique index (`IndexDef` is fields and unique,
// nothing else), so the invariant cannot be handed to the database directly.
// `flow.ProjectGuard` is the answer instead: both transactions update one row
// per project before they read, so the second waits and its next statement
// takes a fresh snapshot. This test is what says whether that works, and it
// only runs where there is a PostgreSQL to run it against — CI, or a developer
// with a role that may create a database. Everywhere else it skips, which is
// why the probe below checks for CREATEDB rather than only for a connection.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { address, company, mail, partner, storage, user } from '@ketvietlab/ketsuite'
import flow from '../packages/ketsuite/src/modules/flow/index.ts'

const configured =
  process.env.KET_TEST_PG ?? process.env.DATABASE_URL ?? 'postgres://dev:devpassword@127.0.0.1:5435/ketjs_dev'
const adminUrl = new URL(configured)
adminUrl.pathname = '/postgres'

/**
 * Reachable **and** able to make a database.
 *
 * The other PostgreSQL suites probe only the connection, so on a machine whose
 * role lacks CREATEDB they run, throw inside the test, and then hold the
 * process open until the runner gives up — several minutes of nothing, per
 * file. Probing the thing the test actually needs turns that into a skip.
 */
const reachable = await (async () => {
  const adapter = postgresAdapter(adminUrl.toString())
  const probe = `ket_probe_${process.pid}_${Date.now()}`
  try {
    await adapter.open()
    await adapter.exec(`CREATE DATABASE "${probe}"`)
    await adapter.exec(`DROP DATABASE IF EXISTS "${probe}" WITH (FORCE)`)
    return true
  } catch {
    return false
  } finally {
    await adapter.close().catch(() => {})
  }
})()

const live = {
  skip: reachable ? false : `no PostgreSQL that can create a database at ${adminUrl.toString()}`,
}
const modules = [address, partner, company, storage, user, mail, flow]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }

const call = (adapter: Adapter, name: string, input: Record<string, unknown>, actor?: string) =>
  callFn(name, input, { adapter, manifest, scope, ...(actor ? { actor } : {}) })

test('flow PostgreSQL: two people starting a sprint at once leave one current sprint', live, async () => {
  const database = `ket_flow_${process.pid}_${Date.now()}`
  const databaseUrl = new URL(adminUrl)
  databaseUrl.pathname = `/${database}`
  const admin = postgresAdapter(adminUrl.toString(), { max: 1 })
  const first = postgresAdapter(databaseUrl.toString(), { max: 2 })
  const second = postgresAdapter(databaseUrl.toString(), { max: 2 })
  await admin.open()
  await admin.exec(`CREATE DATABASE "${database}"`)
  try {
    await Promise.all([first.open(), second.open()])
    await migrateOne(first, manifest)
    registerFunctions(modules)

    const seed = (name: string, input: Record<string, unknown>, actor?: string) =>
      call(first, name, input, actor)
    await seed('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
    await seed('company.saveCompany', {
      id: 'acme',
      code: 'ACME',
      partnerId: 'acme-party',
      currency: 'VND',
    })
    await seed('user.createUser', {
      id: 'u1',
      login: 'u1',
      password: 'correct horse battery',
      name: 'Lê Minh',
      defaultCompanyId: 'acme',
    })
    await seed('user.grantCompany', { id: 'u1:acme', userId: 'u1', companyId: 'acme' })
    await seed(
      'flow.project.save',
      { values: { id: 'race', key: 'RACE', name: 'Dự án đua' }, idempotencyKey: 'project-race' },
      'u1',
    )
    for (const id of ['sprint-a', 'sprint-b'])
      await seed(
        'flow.sprint.save',
        { id, projectId: 'race', name: id, idempotencyKey: `sprint-save-${id}` },
        'u1',
      )

    // Two connections, two transactions, one project. Neither knows about
    // the other until one of them commits.
    const results = await Promise.all([
      call(first, 'flow.sprint.start', { id: 'sprint-a', idempotencyKey: 'race-start-a' }, 'u1'),
      call(second, 'flow.sprint.start', { id: 'sprint-b', idempotencyKey: 'race-start-b' }, 'u1'),
    ]).catch((error: unknown) => {
      // A serialization failure is a correct outcome: the database refused
      // the second writer rather than letting both through. Reported as one
      // winner and one loser, which is what the caller sees.
      assert.ok(error, 'a refusal is an answer, an undefined board is not')
      return [{ value: { ok: true } }, { value: { ok: false } }] as Array<{ value: Row }>
    })
    const answers = results.map((result) => (result.value as Row).ok === true)
    assert.equal(answers.filter(Boolean).length, 1, 'exactly one caller is told they started it')

    // And the store agrees with what the callers were told. This is the
    // assertion that matters: a project with two active sprints has no
    // current sprint at all, because every screen that asks for "the" one
    // gets whichever the query happened to order first.
    const active = (await call(second, 'flow.sprint.list', { projectId: 'race' })).value as Row[]
    assert.equal(
      active.filter((row) => String(row.state) === 'active').length,
      1,
      'and the project really does run one sprint, not two',
    )
  } finally {
    await first.close().catch(() => {})
    await second.close().catch(() => {})
    await admin.exec(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(() => {})
    await admin.close().catch(() => {})
  }
})
